import type { ReleaseNote } from "./messages";
import { renderReleaseNoteForTelegram, canSendReleaseNote, renderSourceFailureAlert } from "./messages";
import type { SourceFailureAlert } from "./messages";

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
  modelNames?: string[];
  alertKind?: "model_release" | "major_incident";
}) {
  const prefix = signal.alertKind === "major_incident"
    ? "Major model incident signal"
    : "New model release signal";
  const lines = [
    `${prefix}: ${signal.provider}`,
    signal.title,
    `Source: ${signal.sourceLabel}`,
    `Confidence: ${signal.confidence}`,
  ];

  if (signal.modelNames && signal.modelNames.length > 0) {
    lines.push(`Models: ${signal.modelNames.slice(0, 6).join(", ")}`);
  }

  if (signal.url) {
    lines.push(signal.url);
  }

  return lines.join("\n");
}
