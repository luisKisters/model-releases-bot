import { renderSourceFailureAlert } from "./messages";
import type { SourceFailureAlert } from "./messages";
import { decodeEntities, filterModelNamesForLab, normalizeWhitespace } from "./text";

export type TelegramResult = {
  ok: boolean;
  status: number;
  error?: string;
  messageId?: number;
};

export type TelegramMessageOptions = {
  parseMode?: "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  maxRetries?: number;
};

export type TelegramSendOptions = {
  dryRun?: boolean;
  sendTelegramFlag?: boolean;
};

export type ReleasePairResult = {
  ok: boolean;
  message1: TelegramResult;
  message2: TelegramResult | null;
  message1PlainTextFallback: boolean;
  message2PlainTextFallback: boolean;
};

export type TelegramSendDecision = {
  willSend: boolean;
  reason: "dry_run" | "send_flag_not_set" | "gate_rejected" | "not_verified" | "approved";
};

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
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

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4096),
    link_preview_options: { is_disabled: true },
  };
  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options.replyToMessageId !== undefined) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
      result?: { message_id?: number };
    } | null;

    const ok = response.ok && payload?.ok !== false;
    if (ok) {
      return { ok: true, status: response.status, messageId: payload?.result?.message_id };
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

export async function sendTelegramMarkdownMessage(
  markdown: string,
  fetchImpl: typeof fetch = fetch,
  options: TelegramMessageOptions = {},
): Promise<TelegramResult> {
  return await sendTelegramMessage(markdown, fetchImpl, {
    ...options,
    parseMode: "MarkdownV2",
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telegram HTML whitelist (<b> <i> <a> <code> <blockquote expandable>) rejects
// unescaped &, <, > inside interpolated text — see rule 11 in
// docs/telegram-message-format-v2.md.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Sends the Message 1 (alert card) + Message 2 (reply deep dive) pair from the
// v2.2 writer contract. Message 2 is sent as a threaded reply to Message 1. A
// release must never be dropped because Telegram rejected the writer's HTML —
// a 400 on either message triggers a tag-stripped plain-text resend.
export async function sendReleasePair(
  message1: string,
  message2: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleasePairResult> {
  let result1 = await sendTelegramMessage(message1, fetchImpl, { parseMode: "HTML" });
  let message1PlainTextFallback = false;
  if (!result1.ok && result1.status === 400) {
    result1 = await sendTelegramMessage(stripHtmlToPlainText(message1), fetchImpl);
    message1PlainTextFallback = true;
  }

  if (!result1.ok) {
    return {
      ok: false,
      message1: result1,
      message2: null,
      message1PlainTextFallback,
      message2PlainTextFallback: false,
    };
  }

  let result2 = await sendTelegramMessage(message2, fetchImpl, {
    parseMode: "HTML",
    replyToMessageId: result1.messageId,
  });
  let message2PlainTextFallback = false;
  if (!result2.ok && result2.status === 400) {
    result2 = await sendTelegramMessage(stripHtmlToPlainText(message2), fetchImpl, {
      replyToMessageId: result1.messageId,
    });
    message2PlainTextFallback = true;
  }

  return {
    ok: result1.ok && result2.ok,
    message1: result1,
    message2: result2,
    message1PlainTextFallback,
    message2PlainTextFallback,
  };
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
  systemCard?: {
    status: "linked" | "not_linked" | "unavailable";
    url?: string;
    label?: string;
  };
}) {
  const isIncident = signal.alertKind === "major_incident";
  const title = cleanAlertText(signal.title);
  const summary = makeSignalSummary({ ...signal, title, isIncident });
  const modelNames = displayModelNames(
    signal.provider,
    signal.modelNames ?? [],
    `${title} ${signal.summary ?? ""}`,
  );
  const prefix = signal.isTest
    ? `TEST: ${isIncident ? "Major model incident" : "Model release"}`
    : isIncident
      ? "Major model incident"
      : "Model release";
  const lines = [
    `*${prefix}*`,
    `*Lab:* ${escapeTelegramMarkdownV2(signal.provider)}`,
    `*${isIncident ? "Incident" : "Release"}:* ${escapeTelegramMarkdownV2(title)}`,
    `*Summary:* ${escapeTelegramMarkdownV2(summary)}`,
  ];

  if (modelNames.length > 0) {
    lines.push(`*Models:* ${escapeTelegramMarkdownV2(modelNames.slice(0, 5).join(", "))}`);
  }

  lines.push(formatSystemCardLine(signal.systemCard));
  lines.push(`*Source:* ${escapeTelegramMarkdownV2(signal.sourceLabel)}`);

  if (signal.url) {
    lines.push(telegramMarkdownLink("Official announcement", signal.url));
  }

  return lines.join("\n").slice(0, 4096);
}

function formatSystemCardLine(systemCard: {
  status: "linked" | "not_linked" | "unavailable";
  url?: string;
  label?: string;
} | undefined): string {
  if (!systemCard || systemCard.status === "unavailable") {
    return "*System card:* Check unavailable";
  }
  if (systemCard.status === "not_linked" || !systemCard.url) {
    return "*System card:* Not linked in the announcement";
  }

  return `*System card:* ${telegramMarkdownLink(systemCard.label ?? "Linked evidence", systemCard.url)}`;
}

export function escapeTelegramMarkdownV2(value: string): string {
  return value.replace(/([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g, "\\$1");
}

function telegramMarkdownLink(label: string, url: string): string {
  const escapedUrl = url.replace(/([\\)])/g, "\\$1");
  return `[${escapeTelegramMarkdownV2(label)}](${escapedUrl})`;
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

  const modelNames = displayModelNames(
    signal.provider,
    signal.modelNames ?? [],
    `${signal.title} ${signal.summary ?? ""}`,
  );
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

function displayModelNames(provider: string, names: string[], context?: string): string[] {
  const mentionedNames = context
    ? names.filter((name) => isExactMention(name, context))
    : names;
  const candidates = removeTruncatedModelPrefixes(mentionedNames.length > 0 ? mentionedNames : names);
  const filtered = filterModelNamesForLab(provider, candidates);
  const numberedNames = candidates.filter((name) => {
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

function isExactMention(name: string, context: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedName}(?![a-z0-9])`, "i").test(context);
}

function removeTruncatedModelPrefixes(names: string[]): string[] {
  return names.filter((name) => {
    const normalized = name.toLowerCase();
    return !names.some((other) => {
      const otherNormalized = other.toLowerCase();
      return otherNormalized !== normalized &&
        otherNormalized.startsWith(normalized) &&
        !otherNormalized.startsWith(`${normalized}-`);
    });
  });
}
