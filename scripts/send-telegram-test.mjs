import { loadLocalEnv } from "./shared-env.mjs";

loadLocalEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: `Model Release Radar test message\n${new Date().toISOString()}`,
    link_preview_options: { is_disabled: true },
  }),
});

const payload = await response.json().catch(() => null);

if (!response.ok || payload?.ok === false) {
  console.error("Telegram test failed:", payload ?? response.statusText);
  process.exit(1);
}

console.log("Telegram test message sent.");
