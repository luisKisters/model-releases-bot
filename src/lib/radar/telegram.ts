export type TelegramResult = {
  ok: boolean;
  status: number;
  error?: string;
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
