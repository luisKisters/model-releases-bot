import { query } from "./_generated/server";
import { telegramConfigured } from "../src/lib/radar/telegram";

function secretsStatus() {
  return {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    artificialAnalysis: Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),
  };
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const [
      allSources,
      signals,
      models,
      notifications,
      releaseCandidates,
      verifiedNotes,
    ] = await Promise.all([
      // All sources — including disabled/stale so they appear as greyed rows
      ctx.db.query("sources").take(500),
      ctx.db.query("signals").withIndex("by_first_seen").order("desc").take(40),
      ctx.db.query("models").withIndex("by_last_seen").order("desc").take(20),
      ctx.db.query("notifications").withIndex("by_created").order("desc").take(30),
      ctx.db.query("releaseCandidates").withIndex("by_status").take(100),
      ctx.db.query("verifiedReleaseNotes").withIndex("by_created").order("desc").take(20),
    ]);

    // Cost totals per release candidate
    const candidatesWithCost = await Promise.all(
      releaseCandidates.slice(0, 50).map(async (candidate) => {
        const usageRows = await ctx.db
          .query("llmUsageRecords")
          .withIndex("by_candidate", (q) => q.eq("releaseCandidateId", candidate._id))
          .collect();
        const totalCostUsd = usageRows.reduce((sum, r) => sum + r.estimatedCostUsd, 0);

        const evidenceDocs = await ctx.db
          .query("evidenceDocuments")
          .withIndex("by_candidate", (q) => q.eq("releaseCandidateId", candidate._id))
          .take(10);

        return {
          ...candidate,
          totalCostUsd,
          evidenceDocUrls: evidenceDocs.map((d) => d.url),
        };
      }),
    );

    // Verifier findings for each verified note
    const verifiedNotesWithFindings = await Promise.all(
      verifiedNotes.map(async (note) => {
        const findings = await ctx.db
          .query("verifierFindings")
          .withIndex("by_release_note", (q) => q.eq("verifiedReleaseNoteId", note._id))
          .take(20);
        return { ...note, findings };
      }),
    );

    // Last successful Telegram send
    const lastSentNotification = notifications.find((n) => n.status === "sent") ?? null;

    // Eval score summary — derive from verifiedReleaseNotes stats
    const verifiedCount = verifiedNotes.filter((n) => n.verifierStatus === "verified").length;
    const rejectedCount = verifiedNotes.filter((n) => n.verifierStatus === "rejected").length;
    const totalUnsupported = verifiedNotes.reduce((s, n) => s + n.unsupportedCount, 0);
    const evalScoreSummary = {
      verifiedNoteCount: verifiedCount,
      rejectedNoteCount: rejectedCount,
      totalUnsupportedClaims: totalUnsupported,
    };

    const secrets = secretsStatus();
    const missingSecrets = (
      Object.entries(secrets) as Array<[keyof typeof secrets, boolean]>
    )
      .filter(([, configured]) => !configured)
      .map(([key]) => key);

    const activeSources = allSources.filter((s) => s.enabled);
    const disabledSources = allSources.filter((s) => !s.enabled);
    const failedSources = activeSources.filter((s) => s.failureCount > 0);

    return {
      // Secrets status (no values, only presence)
      telegramConfigured: telegramConfigured(),
      secrets,
      missingSecrets,

      // Sources: active (enabled) and disabled/stale
      sources: allSources.sort(
        (a, b) =>
          // enabled first, then alpha
          Number(b.enabled) - Number(a.enabled) ||
          a.provider.localeCompare(b.provider) ||
          a.label.localeCompare(b.label),
      ),
      activeSourceCount: activeSources.length,
      disabledSourceCount: disabledSources.length,
      sendableSourceCount: activeSources.filter((s) => s.notify).length,
      discoverySourceCount: activeSources.filter((s) => !s.notify).length,

      signals,
      models,
      notifications,
      lastSentNotification,

      // Release candidates with evidence and costs
      releaseCandidates: candidatesWithCost,

      // Verified release notes with verifier findings
      verifiedNotes: verifiedNotesWithFindings,

      // Summary counts
      latestSignalCount: signals.length,
      latestModelCount: models.length,
      evalScoreSummary,

      failedSources,
    };
  },
});
