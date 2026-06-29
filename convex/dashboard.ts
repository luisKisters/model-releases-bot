import { query } from "./_generated/server";
import { telegramConfigured } from "../src/lib/radar/telegram";

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const [sources, signals, models, notifications] = await Promise.all([
      ctx.db.query("sources").take(200),
      ctx.db.query("signals").withIndex("by_first_seen").order("desc").take(40),
      ctx.db.query("models").withIndex("by_last_seen").order("desc").take(20),
      ctx.db.query("notifications").withIndex("by_created").order("desc").take(20),
    ]);

    return {
      telegramConfigured: telegramConfigured(),
      sources: sources.sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)),
      signals,
      models,
      notifications,
      latestSignalCount: signals.length,
      latestModelCount: models.length,
    };
  },
});
