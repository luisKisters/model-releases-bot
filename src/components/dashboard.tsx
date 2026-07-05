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

  return (
    <main className="page">
      <div className="shell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Operator dashboard</div>
            <h1>Model Release Radar</h1>
            <p className="subhead">
              Monitors selected labs for official model release articles. Telegram alerts fire
              only for verified release notes.
            </p>
          </div>
          <div className={overview.telegramConfigured ? "pill ok" : "pill warn"}>
            Telegram {overview.telegramConfigured ? "configured" : "missing"}
          </div>
        </header>

        {/* Secrets / config status */}
        <SecretsPanel secrets={overview.secrets} missingSecrets={overview.missingSecrets} />

        <section className="status-strip" aria-label="Radar status">
          <Stat label="Active sources" value={overview.activeSourceCount} />
          <Stat label="Sendable" value={overview.sendableSourceCount} />
          <Stat label="Discovery-only" value={overview.discoverySourceCount} />
          <Stat
            label="Disabled/stale"
            value={overview.disabledSourceCount}
            tone={overview.disabledSourceCount > 0 ? "warn" : "ok"}
          />
          <Stat
            label="Failed sources"
            value={overview.failedSources.length}
            tone={overview.failedSources.length ? "danger" : "ok"}
          />
          <Stat label="Verified releases" value={overview.evalScoreSummary.verifiedNoteCount} tone="ok" />
        </section>

        {/* Last successful send */}
        {overview.lastSentNotification ? (
          <div className="alert ok">
            Last Telegram send:{" "}
            <strong>{overview.lastSentNotification.channel}</strong>{" "}
            at {formatTime(overview.lastSentNotification.createdAt)}
          </div>
        ) : (
          <div className="alert warn">No successful Telegram sends recorded yet.</div>
        )}

        <div className="grid">
          {/* Sources panel — all sources including disabled */}
          <section className="panel wide">
            <h2>Sources</h2>
            <SourcesTable sources={overview.sources} />
          </section>
        </div>

        <div className="grid">
          <section className="panel">
            <h2>Latest Release Candidates</h2>
            <ReleaseCandidateList candidates={overview.releaseCandidates} />
          </section>

          <aside className="stack">
            <section className="panel">
              <h2>Verified Release Notes</h2>
              <VerifiedNoteList notes={overview.verifiedNotes} />
            </section>

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
                      {notification.error ? (
                        <div className="meta danger">{notification.error}</div>
                      ) : null}
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
              <h2>Failed Sources</h2>
              <div className="source-list">
                {overview.failedSources.length === 0 ? (
                  <div className="empty">All active sources are healthy.</div>
                ) : (
                  overview.failedSources.slice(0, 12).map((source) => (
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
          </aside>
        </div>
      </div>
    </main>
  );
}

type SecretsShape = {
  telegram: boolean;
  deepseek: boolean;
  openrouter: boolean;
  artificialAnalysis: boolean;
};

function SecretsPanel({ secrets, missingSecrets }: { secrets: SecretsShape; missingSecrets: string[] }) {
  const labels: Record<keyof SecretsShape, string> = {
    telegram: "Telegram",
    deepseek: "DeepSeek",
    openrouter: "OpenRouter",
    artificialAnalysis: "Artificial Analysis",
  };

  return (
    <section className="panel secrets-panel" aria-label="Secrets configuration">
      <h2>Secrets / Config</h2>
      <div className="secrets-grid">
        {(Object.keys(labels) as Array<keyof SecretsShape>).map((key) => (
          <div key={key} className="row">
            <span>{labels[key]}</span>
            <span className={secrets[key] ? "pill ok" : "pill warn"}>
              {secrets[key] ? "configured" : "missing"}
            </span>
          </div>
        ))}
      </div>
      {missingSecrets.length > 0 ? (
        <div className="meta warn">
          Missing: {missingSecrets.join(", ")} — add to .env.local to enable live runs.
        </div>
      ) : (
        <div className="meta ok">All secrets configured.</div>
      )}
    </section>
  );
}

type SourceRow = {
  _id: string;
  sourceId: string;
  provider: string;
  label: string;
  url: string;
  enabled: boolean;
  notify: boolean;
  failureCount: number;
  lastError?: string;
  lastPolledAt?: number;
};

function SourcesTable({ sources }: { sources: SourceRow[] }) {
  if (sources.length === 0) {
    return <div className="empty">No sources synced yet.</div>;
  }

  return (
    <div className="source-list">
      {sources.map((source) => (
        <div className={`row ${!source.enabled ? "row-disabled" : ""}`} key={source._id}>
          <div className="row-head">
            <strong>{source.label}</strong>
            <span className="pill">{source.provider}</span>
            {source.enabled ? (
              <span className={source.notify ? "pill ok" : "pill accent"}>
                {source.notify ? "sendable" : "discovery"}
              </span>
            ) : (
              <span className="pill warn">disabled</span>
            )}
            {source.failureCount > 0 ? (
              <span className="pill danger">failures: {source.failureCount}</span>
            ) : null}
          </div>
          <div className="meta">
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>
            {source.lastPolledAt ? <span>Polled {formatTime(source.lastPolledAt)}</span> : null}
            {!source.enabled && source.lastError ? (
              <span className="warn">{source.lastError}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

type ReleaseCandidateRow = {
  _id: string;
  lab: string;
  title: string;
  canonicalArticleUrl: string;
  status: string;
  modelNames: string[];
  releaseDate?: string;
  discoveredAt: number;
  gateResult: { shouldSend: boolean; reasons: string[] };
  totalCostUsd: number;
  evidenceDocUrls: string[];
};

function ReleaseCandidateList({ candidates }: { candidates: ReleaseCandidateRow[] }) {
  if (candidates.length === 0) {
    return <div className="empty">No release candidates yet.</div>;
  }

  return (
    <div className="signal-list">
      {candidates.slice(0, 20).map((candidate) => (
        <article className="signal" key={candidate._id}>
          <div className="signal-head">
            <div>
              <div className="signal-title">
                <a href={candidate.canonicalArticleUrl} target="_blank" rel="noreferrer">
                  {candidate.title}
                </a>
              </div>
              <div className="meta">
                <span>{candidate.lab}</span>
                {candidate.releaseDate ? <span>{candidate.releaseDate}</span> : null}
                <span>{formatTime(candidate.discoveredAt)}</span>
              </div>
            </div>
            <CandidateStatusPill status={candidate.status} />
          </div>
          {candidate.modelNames.length > 0 ? (
            <div className="meta">
              {candidate.modelNames.slice(0, 6).map((name) => (
                <span className="pill" key={name}>
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="meta">
            <span>Gate: {candidate.gateResult.shouldSend ? "pass" : "reject"}</span>
            <span>Cost: ${candidate.totalCostUsd.toFixed(4)}</span>
            {candidate.evidenceDocUrls.length > 0 ? (
              <span>Evidence: {candidate.evidenceDocUrls.length} doc(s)</span>
            ) : null}
          </div>
          {!candidate.gateResult.shouldSend ? (
            <div className="meta warn">
              Rejected: {candidate.gateResult.reasons.join("; ")}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CandidateStatusPill({ status }: { status: string }) {
  const tone =
    status === "verified"
      ? "ok"
      : status === "rejected" || status === "failed"
        ? "danger"
        : status === "processing"
          ? "accent"
          : undefined;
  return <div className={`pill ${tone ?? ""}`}>{status}</div>;
}

type VerifiedNoteRow = {
  _id: string;
  lab: string;
  title: string;
  canonicalArticleUrl: string;
  modelNames: string[];
  releaseDate?: string;
  verifierStatus: string;
  checkedClaims: number;
  unsupportedCount: number;
  totalCostUsd: number;
  notified: boolean;
  sentAt?: number;
  createdAt: number;
  findings: Array<{ claim: string; issue: string; severity: string }>;
};

function VerifiedNoteList({ notes }: { notes: VerifiedNoteRow[] }) {
  if (notes.length === 0) {
    return <div className="empty">No verified release notes yet.</div>;
  }

  return (
    <div className="signal-list">
      {notes.map((note) => (
        <article className="signal" key={note._id}>
          <div className="signal-head">
            <div>
              <div className="signal-title">
                <a href={note.canonicalArticleUrl} target="_blank" rel="noreferrer">
                  {note.title}
                </a>
              </div>
              <div className="meta">
                <span>{note.lab}</span>
                {note.releaseDate ? <span>{note.releaseDate}</span> : null}
                <span>{formatTime(note.createdAt)}</span>
              </div>
            </div>
            <div className={`pill ${note.verifierStatus === "verified" ? "ok" : "danger"}`}>
              {note.verifierStatus}
            </div>
          </div>
          <div className="meta">
            <span>Claims checked: {note.checkedClaims}</span>
            {note.unsupportedCount > 0 ? (
              <span className="warn">Unsupported: {note.unsupportedCount}</span>
            ) : null}
            <span>Cost: ${note.totalCostUsd.toFixed(4)}</span>
            {note.notified ? (
              <span className="pill ok">sent{note.sentAt ? ` ${formatTime(note.sentAt)}` : ""}</span>
            ) : (
              <span className="pill warn">not sent</span>
            )}
          </div>
          {note.modelNames.length > 0 ? (
            <div className="meta">
              {note.modelNames.slice(0, 6).map((name) => (
                <span className="pill" key={name}>
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          {note.findings.filter((f) => f.severity === "block").length > 0 ? (
            <div className="meta danger">
              Blocking findings:{" "}
              {note.findings
                .filter((f) => f.severity === "block")
                .map((f) => f.issue)
                .join(", ")}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "danger" | "warn";
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone === "danger" ? "danger" : tone === "warn" ? "warn" : undefined}>
        {value}
      </strong>
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
