import { useEffect, useState, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginPageProps,
  type PluginSettingsPageProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuotaWindow {
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  valueLabel: string | null;
  detail: string | null;
}

interface ProviderSnapshot {
  provider: string;
  source: string | null;
  ok: boolean;
  error: string | null;
  windows: QuotaWindow[];
  fetchedAt: string;
}

interface UsageHistoryEntry {
  fetchedAt: string;
  windows: QuotaWindow[];
}

// ---------------------------------------------------------------------------
// Design tokens — all resolve from Paperclip's host CSS variables
// ---------------------------------------------------------------------------

const t = {
  bg: "var(--background)",
  fg: "var(--foreground)",
  card: "var(--card)",
  cardFg: "var(--card-foreground)",
  muted: "var(--muted)",
  mutedFg: "var(--muted-foreground)",
  border: "var(--border)",
  primary: "var(--primary)",
  primaryFg: "var(--primary-foreground)",
  secondary: "var(--secondary)",
  secondaryFg: "var(--secondary-foreground)",
  destructive: "var(--destructive)",
  destructiveFg: "var(--destructive-foreground)",
  // Chart tokens used for the usage bar color ramp
  ok: "var(--chart-2)",       // teal  < 50%
  caution: "var(--chart-4)",  // yellow 50–75%
  warning: "var(--chart-5)",  // orange 75–90%
  // critical: destructive     //  red  ≥ 90%
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function barColor(percent: number): string {
  if (percent >= 90) return t.destructive;
  if (percent >= 75) return t.warning;
  if (percent >= 50) return t.caution;
  return t.ok;
}

function formatTimeUntil(isoDate: string): string {
  const delta = new Date(isoDate).getTime() - Date.now();
  if (delta <= 0) return "resetting now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `resets in ${hours}h`;
  return `resets in ${Math.round(hours / 24)}d`;
}

function formatAge(isoDate: string): string {
  const delta = Date.now() - new Date(isoDate).getTime();
  if (delta < 60_000) return "just now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

// Inject spin keyframe once at module load for the refresh icon animation
if (typeof document !== "undefined" && !document.getElementById("__au_kf")) {
  const s = document.createElement("style");
  s.id = "__au_kf";
  s.textContent = "@keyframes au_spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }";
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Shared base styles
// ---------------------------------------------------------------------------

const base: Record<string, CSSProperties> = {
  container: {
    padding: "12px",
    fontFamily: "inherit",
    fontSize: "13px",
    color: t.fg,
    lineHeight: 1.4,
  },
  pagePadding: {
    padding: "20px",
    maxWidth: "640px",
    fontFamily: "inherit",
    fontSize: "13px",
    color: t.fg,
    lineHeight: 1.4,
  },
  heading: {
    fontSize: "14px",
    fontWeight: 600,
    color: t.fg,
    margin: 0,
    marginBottom: "8px",
  },
  pageHeading: {
    fontSize: "18px",
    fontWeight: 600,
    color: t.fg,
    margin: 0,
    marginBottom: "16px",
  },
  subheading: {
    fontSize: "13px",
    fontWeight: 600,
    color: t.fg,
    margin: 0,
    marginBottom: "12px",
  },
  meta: {
    fontSize: "11px",
    color: t.mutedFg,
    marginTop: "2px",
  },
  metaInline: {
    fontSize: "11px",
    color: t.mutedFg,
    marginLeft: "6px",
  },
  divider: {
    height: "1px",
    background: t.border,
    margin: "16px 0",
    border: "none",
  },
};

// ---------------------------------------------------------------------------
// Button variants
// ---------------------------------------------------------------------------

function btnPrimary(extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: "var(--radius, 0)",
    border: "1px solid transparent",
    background: t.primary,
    color: t.primaryFg,
    cursor: "pointer",
    lineHeight: 1,
    ...extra,
  };
}

function btnSecondary(extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 500,
    fontFamily: "inherit",
    borderRadius: "var(--radius, 0)",
    border: `1px solid ${t.border}`,
    background: t.secondary,
    color: t.secondaryFg,
    cursor: "pointer",
    lineHeight: 1,
    ...extra,
  };
}

function btnIcon(extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "3px",
    fontFamily: "inherit",
    borderRadius: "var(--radius, 0)",
    border: "1px solid transparent",
    background: "transparent",
    color: t.mutedFg,
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
    ...extra,
  };
}

function RefreshIcon({ size = 13, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spin ? { animation: "au_spin 0.7s linear infinite" } : undefined}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------

function ErrorCard({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius, 0)",
        border: `1px solid ${t.destructive}`,
        background: t.card,
        marginBottom: "8px",
      }}
    >
      <div
        style={{
          fontSize: "12px",
          color: t.destructive,
          fontWeight: 500,
          marginBottom: "8px",
        }}
      >
        {message}
      </div>
      <button style={btnSecondary()} onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRect({ w, h }: { w: string | number; h: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: "3px",
        background: t.muted,
        opacity: 0.8,
      }}
    />
  );
}

function SkeletonBar() {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <SkeletonRect w={90} h={11} />
        <SkeletonRect w={48} h={11} />
      </div>
      <SkeletonRect w="100%" h={8} />
    </div>
  );
}

function LoadingSkeleton({ bars = 2 }: { bars?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading usage data">
      {Array.from({ length: bars }).map((_, i) => (
        <SkeletonBar key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsageBar component — ARIA progressbar
// ---------------------------------------------------------------------------

function UsageBar({ window: w }: { window: QuotaWindow }) {
  const percent = w.usedPercent;
  const clampedPct = percent != null ? Math.min(100, Math.max(0, percent)) : null;

  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "3px",
          fontSize: "12px",
        }}
      >
        <span style={{ color: t.fg }}>{w.label}</span>
        <span style={{ color: t.mutedFg }}>
          {percent != null ? `${percent}%` : w.valueLabel ?? "—"}
        </span>
      </div>
      {clampedPct != null && (
        <div
          role="progressbar"
          aria-valuenow={clampedPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${w.label}: ${clampedPct}% used`}
          style={{
            height: "8px",
            borderRadius: "4px",
            background: t.muted,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: "4px",
              width: `${clampedPct}%`,
              background: barColor(clampedPct),
              transition: "width 0.35s ease",
            }}
          />
        </div>
      )}
      {(w.resetsAt || w.detail) && (
        <div style={base.meta}>
          {w.resetsAt && formatTimeUntil(w.resetsAt)}
          {w.detail && (w.resetsAt ? ` · ${w.detail}` : w.detail)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refresh hook — shared across widget + page
// ---------------------------------------------------------------------------

function useRefresh(...dataRefreshers: Array<() => void>) {
  const refresh = usePluginAction("refresh");
  const [refreshing, setRefreshing] = useState(false);
  const [didRefresh, setDidRefresh] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    setDidRefresh(false);
    try {
      await refresh({});
      for (const r of dataRefreshers) r();
      setDidRefresh(true);
      setTimeout(() => setDidRefresh(false), 2500);
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, didRefresh, handleRefresh };
}

// ---------------------------------------------------------------------------
// Dashboard Widget
// ---------------------------------------------------------------------------

export function AgentUsageDashboardWidget(_props: PluginWidgetProps) {
  const { data: snapshot, loading, refresh: refreshSnapshot } = usePluginData<ProviderSnapshot | null>(
    "latest-quota",
    {}
  );
  const { refreshing, didRefresh, handleRefresh } = useRefresh(refreshSnapshot);

  if (loading) {
    return (
      <div style={base.container}>
        <LoadingSkeleton bars={2} />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={base.container}>
        <div
          style={{
            padding: "12px",
            textAlign: "center",
            color: t.mutedFg,
            fontSize: "12px",
            marginBottom: "8px",
          }}
        >
          No usage data yet. Waiting for first poll.
        </div>
        <button
          style={btnSecondary({ width: "100%" })}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Fetching…" : "Fetch Now"}
        </button>
      </div>
    );
  }

  if (!snapshot.ok) {
    return (
      <div style={base.container}>
        <ErrorCard
          message={snapshot.error ?? "Unknown error"}
          onRetry={handleRefresh}
          retrying={refreshing}
        />
      </div>
    );
  }

  return (
    <div style={base.container}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <span style={{ ...base.heading, marginBottom: 0 }}>Claude Usage</span>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "11px", color: didRefresh ? t.ok : t.mutedFg }}>
            {didRefresh ? "Just updated" : formatAge(snapshot.fetchedAt)}
          </span>
          <button
            style={btnIcon({ color: didRefresh ? t.ok : t.mutedFg })}
            onClick={handleRefresh}
            disabled={refreshing}
            title={refreshing ? "Refreshing…" : didRefresh ? "Just updated" : "Refresh"}
            aria-label="Refresh usage data"
          >
            <RefreshIcon spin={refreshing} size={13} />
          </button>
        </div>
      </div>
      {snapshot.windows.map((w, i) => (
        <UsageBar key={i} window={w} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Page
// ---------------------------------------------------------------------------

export function AgentUsagePage(_props: PluginPageProps) {
  const { data: snapshot, loading, refresh: refreshSnapshot } = usePluginData<ProviderSnapshot | null>(
    "latest-quota",
    {}
  );
  const { data: history, refresh: refreshHistory } = usePluginData<UsageHistoryEntry[]>(
    "usage-history",
    {}
  );
  const { refreshing, didRefresh, handleRefresh } = useRefresh(refreshSnapshot, refreshHistory);

  return (
    <div style={base.pagePadding}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <h2 style={{ ...base.pageHeading, marginBottom: 0 }}>AI Provider Usage</h2>
        <button
          style={btnIcon({ color: didRefresh ? t.ok : t.mutedFg })}
          onClick={handleRefresh}
          disabled={refreshing}
          title={refreshing ? "Refreshing…" : didRefresh ? "Just updated" : "Refresh"}
          aria-label="Refresh usage data"
        >
          <RefreshIcon spin={refreshing} size={15} />
        </button>
      </div>

      {loading && <LoadingSkeleton bars={3} />}

      {!loading && !snapshot && (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            color: t.mutedFg,
            fontSize: "13px",
            border: `1px dashed ${t.border}`,
            borderRadius: "var(--radius, 0)",
            marginBottom: "16px",
          }}
        >
          No usage data collected yet.
          <br />
          <span style={{ fontSize: "12px" }}>
            Use the refresh button or wait for the next scheduled poll.
          </span>
        </div>
      )}

      {!loading && snapshot && !snapshot.ok && (
        <ErrorCard
          message={snapshot.error ?? "Unknown error fetching usage data"}
          onRetry={handleRefresh}
          retrying={refreshing}
        />
      )}

      {snapshot?.ok && (
        <section style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "6px",
              marginBottom: "12px",
            }}
          >
            <h3 style={base.subheading}>
              Current Quota — {snapshot.provider}
            </h3>
            <span style={base.metaInline}>
              via {snapshot.source} ·{" "}
              {didRefresh ? (
                <span style={{ color: t.ok }}>just updated</span>
              ) : (
                formatAge(snapshot.fetchedAt)
              )}
            </span>
          </div>
          {snapshot.windows.map((w, i) => (
            <UsageBar key={i} window={w} />
          ))}
        </section>
      )}

      {history && history.length > 0 && (
        <section style={{ marginTop: "28px" }}>
          <hr style={base.divider} />
          <h3 style={{ ...base.subheading, marginBottom: "8px" }}>
            Recent History
            <span style={{ ...base.metaInline, fontWeight: 400 }}>
              {history.length} snapshot{history.length !== 1 ? "s" : ""}
            </span>
          </h3>
          <HistoryTable history={history} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History table — striped rows
// ---------------------------------------------------------------------------

function HistoryTable({ history }: { history: UsageHistoryEntry[] }) {
  const thStyle: CSSProperties = {
    textAlign: "left",
    padding: "6px 8px",
    fontSize: "11px",
    fontWeight: 600,
    color: t.mutedFg,
    borderBottom: `1px solid ${t.border}`,
    background: t.muted,
    whiteSpace: "nowrap",
  };

  return (
    <table
      style={{
        width: "100%",
        fontSize: "12px",
        borderCollapse: "collapse",
        borderRadius: "var(--radius, 0)",
        overflow: "hidden",
        border: `1px solid ${t.border}`,
      }}
    >
      <thead>
        <tr>
          <th style={thStyle}>Time</th>
          <th style={thStyle}>Session</th>
          <th style={thStyle}>Week</th>
        </tr>
      </thead>
      <tbody>
        {history.slice(0, 20).map((entry, i) => {
          const session = entry.windows.find((w) =>
            w.label.toLowerCase().includes("session")
          );
          const week = entry.windows.find((w) =>
            w.label.toLowerCase().includes("all models")
          );
          const sessionPct = session?.usedPercent;
          const weekPct = week?.usedPercent;

          const rowStyle: CSSProperties = {
            background: i % 2 === 0 ? t.card : t.muted,
          };

          const cellStyle: CSSProperties = {
            padding: "6px 8px",
            borderBottom: `1px solid ${t.border}`,
            color: t.fg,
          };

          return (
            <tr key={i} style={rowStyle}>
              <td style={cellStyle}>{formatAge(entry.fetchedAt)}</td>
              <td style={cellStyle}>
                {sessionPct != null ? (
                  <UsagePill percent={sessionPct} />
                ) : (
                  <span style={{ color: t.mutedFg }}>—</span>
                )}
              </td>
              <td style={cellStyle}>
                {weekPct != null ? (
                  <UsagePill percent={weekPct} />
                ) : (
                  <span style={{ color: t.mutedFg }}>—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function UsagePill({ percent }: { percent: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "11px",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: barColor(percent),
          flexShrink: 0,
        }}
      />
      {percent}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export function AgentUsageSettingsPage(_props: PluginSettingsPageProps) {
  const { data: snapshot } = usePluginData<ProviderSnapshot | null>(
    "latest-quota",
    {}
  );

  const statusColor = snapshot?.ok
    ? t.ok
    : snapshot?.error
      ? t.destructive
      : t.mutedFg;

  const statusText = snapshot?.ok
    ? `Connected — last fetch ${formatAge(snapshot.fetchedAt)}`
    : snapshot?.error
      ? snapshot.error
      : "Not yet polled";

  return (
    <div style={base.container}>
      <h3 style={base.heading}>Agent Usage Status</h3>
      <p style={{ fontSize: "12px", color: t.mutedFg, marginBottom: "12px", marginTop: 0 }}>
        OAuth credentials are auto-detected from your local Claude installation.
      </p>

      <div
        style={{
          padding: "10px 12px",
          background: t.card,
          border: `1px solid ${t.border}`,
          borderRadius: "var(--radius, 0)",
          fontSize: "12px",
          display: "grid",
          gap: "6px",
        }}
      >
        <Row label="Status">
          <span style={{ color: statusColor, fontWeight: 500 }}>{statusText}</span>
        </Row>
        <Row label="Provider">
          <span style={{ color: t.fg }}>{snapshot?.provider ?? "—"}</span>
        </Row>
        <Row label="Token source">
          <span style={{ color: t.fg }}>{snapshot?.source ?? "—"}</span>
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
      <span style={{ color: t.mutedFg, minWidth: "96px", flexShrink: 0 }}>
        {label}
      </span>
      {children}
    </div>
  );
}
