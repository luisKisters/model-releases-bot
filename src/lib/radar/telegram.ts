import type { ReleaseNote } from "./messages";
import { renderReleaseNoteForTelegram, canSendReleaseNote, renderSourceFailureAlert } from "./messages";
import type { SourceFailureAlert } from "./messages";

export type TelegramResult = {
  ok: boolean;
  status: number;
  error?: string;
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

export async function sendTelegramMessage(text: string, fetchImpl: typeof fetch = fetch): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, status: 0, error: "Telegram env vars are missing" };
  }

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      link_preview_options: { is_disabled: true },
    }),
  });

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;

  return {
    ok: response.ok && payload?.ok !== false,
    status: response.status,
    error: response.ok && payload?.ok !== false ? undefined : payload?.description ?? response.statusText,
  };
}

export function formatTelegramSignal(signal: {
  provider: string;
  title: string;
  url?: string;
  sourceLabel: string;
  confidence: string;
  modelNames?: string[];
}) {
  const lines = [
    `New model release signal: ${signal.provider}`,
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
