import { loadLocalEnv } from "./shared-env.mjs";

loadLocalEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const payload = await response.json().catch(() => null);

if (!response.ok || payload?.ok === false) {
  console.error("Telegram getUpdates failed:", payload?.description ?? response.statusText);
  process.exit(1);
}

const chats = new Map();

for (const update of payload.result ?? []) {
  const message = update.message ?? update.channel_post;
  const chat = message?.chat;
  if (chat?.id) {
    chats.set(chat.id, {
      id: chat.id,
      type: chat.type,
      name: chat.title ?? chat.username ?? chat.first_name ?? "",
    });
  }
}

if (chats.size === 0) {
  console.log("No chats found yet. Send the bot a Telegram message, then run this again.");
  process.exit(0);
}

console.log(JSON.stringify([...chats.values()], null, 2));
