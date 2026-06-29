"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type DashboardProps = {
  convexConfigured: boolean;
};

export function Dashboard({ convexConfigured }: DashboardProps) {
  if (!convexConfigured) {
    return (
      <main className="page">
        <div className="shell setup">
          <div className="eyebrow">Setup needed</div>
          <h1>Model Release Radar</h1>
          <p className="subhead">
            Add <code>NEXT_PUBLIC_CONVEX_URL</code> to <code>.env.local</code>, run{" "}
            <code>npm run convex:dev</code>, then refresh this page.
          </p>
        </div>
      </main>
    );
  }

  return <DashboardData />;
}

function DashboardData() {
  const overview = useQuery(api.dashboard.overview);

  if (!overview) {
    return (
      <main className="page">
        <div className="shell">
          <div className="empty">Loading release radar...</div>
        </div>
      </main>
    );
  }

  const failedSources = overview.sources.filter((source) => source.failureCount > 0);

  return (
    <main className="page">
      <div className="shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">No-key public monitor</div>
            <h1>Model Release Radar</h1>
            <p className="subhead">
              Public changelogs, RSS/Atom feeds, Hugging Face orgs, GitHub feeds,
              catalogs, and benchmark pages. Telegram alerts fire for high-confidence
              changes only.
            </p>
          </div>
          <div className={overview.telegramConfigured ? "pill ok" : "pill warn"}>
            Telegram {overview.telegramConfigured ? "configured" : "missing env"}
          </div>
        </header>

        <section className="status-strip" aria-label="Radar status">
          <Stat label="Sources" value={overview.sources.length} />
          <Stat label="Latest signals" value={overview.latestSignalCount} />
          <Stat label="Latest models" value={overview.latestModelCount} />
          <Stat label="Failed sources" value={failedSources.length} tone={failedSources.length ? "danger" : "ok"} />
        </section>

        <div className="grid">
          <section className="panel">
            <h2>Latest Signals</h2>
            <div className="signal-list">
              {overview.signals.length === 0 ? (
                <div className="empty">No signals yet. The first cron run will seed baselines.</div>
              ) : (
                overview.signals.map((signal) => (
                  <article className="signal" key={signal._id}>
                    <div className="signal-head">
                      <div>
                        <div className="signal-title">
                          {signal.url ? (
                            <a href={signal.url} target="_blank" rel="noreferrer">
                              {signal.title}
                            </a>
                          ) : (
                            signal.title
                          )}
                        </div>
                        <div className="meta">
                          <span>{signal.provider}</span>
                          <span>{signal.sourceLabel}</span>
                          <span>{formatTime(signal.firstSeenAt)}</span>
                        </div>
                      </div>
                      <div className="pill accent">{signal.confidence}</div>
                    </div>
                    {signal.modelNames.length > 0 ? (
                      <div className="meta">
                        {signal.modelNames.slice(0, 6).map((name) => (
                          <span className="pill" key={name}>
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <aside className="stack">
            <section className="panel">
              <h2>Failed Sources</h2>
              <div className="source-list">
                {failedSources.length === 0 ? (
                  <div className="empty">All known sources are healthy.</div>
                ) : (
                  failedSources.slice(0, 12).map((source) => (
                    <div className="row" key={source._id}>
                      <div className="row-head">
                        <strong>{source.label}</strong>
                        <span className="pill danger">{source.failureCount}</span>
                      </div>
                      <div className="meta">
                        <span>{source.provider}</span>
                        <span>{source.lastError || "unknown error"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel">
              <h2>Latest Models</h2>
              <div className="model-list">
                {overview.models.length === 0 ? (
                  <div className="empty">No extracted model names yet.</div>
                ) : (
                  overview.models.map((model) => (
                    <div className="row" key={model._id}>
                      <div className="row-head">
                        <strong>{model.name}</strong>
                        <span className="pill">{model.provider}</span>
                      </div>
                      <div className="meta">Last seen {formatTime(model.lastSeenAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel">
              <h2>Notifications</h2>
              <div className="notification-list">
                {overview.notifications.length === 0 ? (
                  <div className="empty">No Telegram sends yet.</div>
                ) : (
                  overview.notifications.map((notification) => (
                    <div className="row" key={notification._id}>
                      <div className="row-head">
                        <strong>{notification.channel}</strong>
                        <span className={notification.status === "sent" ? "pill ok" : "pill danger"}>
                          {notification.status}
                        </span>
                      </div>
                      <div className="meta">{formatTime(notification.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "danger" }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone === "danger" ? "danger" : undefined}>{value}</strong>
    </div>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
