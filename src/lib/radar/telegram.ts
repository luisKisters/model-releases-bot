import type { ReleaseNote } from "./messages";
import { renderReleaseNoteForTelegram, canSendReleaseNote, renderSourceFailureAlert } from "./messages";
import type { SourceFailureAlert } from "./messages";
import { decodeEntities, filterModelNamesForLab, normalizeWhitespace } from "./text";

export type TelegramResult = {
  ok: boolean;
  status: number;
  error?: string;
};

export type TelegramMessageOptions = {
  maxRetries?: number;
};

export type TelegramSendOptions = {
  dryRun?: boolean;
  sendTelegramFlag?: boolean;
};

export type TelegramSendDecision = {
  willSend: boolean;
  reason: "dry_run" | "send_flag_not_set" | "gate_rejected" | "not_verified" | "approved";
};

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendReleaseNote(
  note: ReleaseNote,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; blocked: boolean; reason?: string; telegramResult?: TelegramResult }> {
  if (!canSendReleaseNote(note)) {
    return {
      ok: false,
      blocked: true,
      reason: `Verifier rejected: ${note.verifierFindings.length} finding(s). Message not sent.`,
    };
  }
  const text = renderReleaseNoteForTelegram(note);
  const telegramResult = await sendTelegramMessage(text, fetchImpl);
  return { ok: telegramResult.ok, blocked: false, telegramResult };
}

export async function sendSourceFailureAlert(
  alert: SourceFailureAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult> {
  const text = renderSourceFailureAlert(alert);
  return sendTelegramMessage(text, fetchImpl);
}

export async function sendTelegramMessage(
  text: string,
  fetchImpl: typeof fetch = fetch,
  options: TelegramMessageOptions = {},
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const maxRetries = options.maxRetries ?? 1;

  if (!token || !chatId) {
    return { ok: false, status: 0, error: "Telegram env vars are missing" };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        link_preview_options: { is_disabled: true },
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;

    const ok = response.ok && payload?.ok !== false;
    if (ok) {
      return { ok: true, status: response.status };
    }

    const retryAfter = payload?.parameters?.retry_after;
    if (response.status === 429 && retryAfter && attempt < maxRetries) {
      await sleep((retryAfter + 1) * 1000);
      continue;
    }

    return {
      ok: false,
      status: response.status,
      error: payload?.description ?? response.statusText,
    };
  }

  return { ok: false, status: 0, error: "Telegram retry loop exhausted" };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldSendToTelegram(
  note: { gate: { shouldSend: boolean }; verificationStatus: string },
  options: TelegramSendOptions,
): TelegramSendDecision {
  if (options.dryRun) {
    return { willSend: false, reason: "dry_run" };
  }
  if (!options.sendTelegramFlag) {
    return { willSend: false, reason: "send_flag_not_set" };
  }
  if (!note.gate.shouldSend) {
    return { willSend: false, reason: "gate_rejected" };
  }
  if (note.verificationStatus !== "verified") {
    return { willSend: false, reason: "not_verified" };
  }
  return { willSend: true, reason: "approved" };
}

export function formatSourceFailureAlert(alert: {
  sourceId: string;
  sourceLabel: string;
  error: string;
  url?: string;
}): string {
  const lines = [
    `Operational alert: source polling failure`,
    `Source: ${alert.sourceLabel} (${alert.sourceId})`,
    `Error: ${alert.error}`,
  ];
  if (alert.url) {
    lines.push(`URL: ${alert.url}`);
  }
  return lines.join("\n");
}

export function formatTelegramSignal(signal: {
  provider: string;
  title: string;
  url?: string;
  sourceLabel: string;
  confidence: string;
  summary?: string;
  modelNames?: string[];
  alertKind?: "model_release" | "major_incident";
  isTest?: boolean;
}) {
  const isIncident = signal.alertKind === "major_incident";
  const title = cleanAlertText(signal.title);
  const summary = makeSignalSummary({ ...signal, title, isIncident });
  const modelNames = displayModelNames(signal.provider, signal.modelNames ?? []);
  const prefix = signal.isTest
    ? `TEST - ${isIncident ? "major model incident" : "model release"}`
    : isIncident
      ? "Major model incident"
      : "Model release";
  const lines = [
    `${prefix}`,
    `Lab: ${signal.provider}`,
    `${isIncident ? "Incident" : "Release"}: ${title}`,
    `Summary: ${summary}`,
  ];

  if (modelNames.length > 0) {
    lines.push(`Models: ${modelNames.slice(0, 5).join(", ")}`);
  }

  lines.push(`Source: ${signal.sourceLabel}`);

  if (signal.url) {
    lines.push(`Link: ${signal.url}`);
  }

  return lines.join("\n").slice(0, 4096);
}

function cleanAlertText(value: string): string {
  return normalizeWhitespace(decodeEntities(value)).replace(/\s+/g, " ").trim();
}

function makeSignalSummary(signal: {
  provider: string;
  title: string;
  summary?: string;
  modelNames?: string[];
  isIncident: boolean;
}): string {
  const cleanedSummary = signal.summary ? cleanFeedSummary(signal.summary) : "";
  if (cleanedSummary && !sameText(cleanedSummary, signal.title)) {
    return truncateSentence(cleanedSummary, 320);
  }

  const modelNames = displayModelNames(signal.provider, signal.modelNames ?? []);
  if (signal.isIncident) {
    return `Official ${signal.provider} post about a model or API reliability issue that may affect users.`;
  }

  if (modelNames.length > 0) {
    return `Official ${signal.provider} source announcing ${modelNames.slice(0, 3).join(", ")}.`;
  }

  return `Official ${signal.provider} source announcing a model-related release.`;
}

function sameText(left: string, right: string): boolean {
  return left.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
    right.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function truncateSentence(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function cleanFeedSummary(value: string): string {
  return cleanAlertText(value)
    .replace(/^(?:(?:github|hugging face|modelscope|discord|twitter|x)\s*)+/i, "")
    .trim();
}

function displayModelNames(provider: string, names: string[]): string[] {
  const filtered = filterModelNamesForLab(provider, names);
  const numberedNames = names.filter((name) => {
    return /\d/.test(name) && filterModelNamesForLab(provider, [name]).length > 0;
  });
  const seen = new Set<string>();

  return [...numberedNames, ...filtered].filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
