import { useState, type CSSProperties } from "react";
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
// Shared styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    padding: "12px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "13px",
  } satisfies CSSProperties,
  heading: {
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "8px",
  } satisfies CSSProperties,
  barContainer: {
    marginBottom: "10px",
  } satisfies CSSProperties,
  barLabel: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "3px",
    fontSize: "12px",
  } satisfies CSSProperties,
  barTrack: {
    height: "8px",
    borderRadius: "4px",
    background: "var(--color-surface-2, #e5e7eb)",
    overflow: "hidden",
  } satisfies CSSProperties,
  barFill: (percent: number): CSSProperties => ({
    height: "100%",
    borderRadius: "4px",
    width: `${percent}%`,
    background:
      percent > 85
        ? "var(--color-danger, #ef4444)"
        : percent > 60
          ? "var(--color-warning, #f59e0b)"
          : "var(--color-success, #22c55e)",
    transition: "width 0.3s ease",
  }),
  meta: {
    fontSize: "11px",
    color: "var(--color-text-secondary, #6b7280)",
    marginTop: "2px",
  } satisfies CSSProperties,
  error: {
    color: "var(--color-danger, #ef4444)",
    fontSize: "12px",
    padding: "8px",
    background: "var(--color-surface-2, #fef2f2)",
    borderRadius: "6px",
  } satisfies CSSProperties,
  button: {
    padding: "6px 12px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid var(--color-border, #d1d5db)",
    background: "var(--color-surface-1, #fff)",
    cursor: "pointer",
    marginTop: "8px",
  } satisfies CSSProperties,
  empty: {
    color: "var(--color-text-secondary, #6b7280)",
    fontStyle: "italic" as const,
    padding: "12px",
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// UsageBar component
// ---------------------------------------------------------------------------

function UsageBar({ window: w }: { window: QuotaWindow }) {
  const percent = w.usedPercent;
  return (
    <div style={styles.barContainer}>
      <div style={styles.barLabel}>
        <span>{w.label}</span>
        <span>
          {percent != null ? `${percent}% used` : w.valueLabel ?? "—"}
        </span>
      </div>
      {percent != null && (
        <div style={styles.barTrack}>
          <div style={styles.barFill(percent)} />
        </div>
      )}
      <div style={styles.meta}>
        {w.resetsAt && formatTimeUntil(w.resetsAt)}
        {w.detail && (w.resetsAt ? ` · ${w.detail}` : w.detail)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Widget
// ---------------------------------------------------------------------------

export function AgentUsageDashboardWidget(_props: PluginWidgetProps) {
  const { data: snapshot, loading } = usePluginData<ProviderSnapshot | null>("latest-quota", {});
  const refresh = usePluginAction("refresh");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh({});
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <div style={styles.container}>Loading usage data…</div>;
  }

  if (!snapshot) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No usage data yet. Waiting for first poll…</div>
        <button style={styles.button} onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "Fetching…" : "Fetch Now"}
        </button>
      </div>
    );
  }

  if (!snapshot.ok) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{snapshot.error}</div>
        <button style={styles.button} onClick={handleRefresh} disabled={refreshing}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={{ ...styles.heading, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Claude Usage</span>
        <span style={styles.meta}>{formatAge(snapshot.fetchedAt)}</span>
      </div>
      {snapshot.windows.map((w, i) => (
        <UsageBar key={i} window={w} />
      ))}
      <button style={styles.button} onClick={handleRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Page
// ---------------------------------------------------------------------------

export function AgentUsagePage(_props: PluginPageProps) {
  const { data: snapshot, loading } = usePluginData<ProviderSnapshot | null>("latest-quota", {});
  const { data: history } = usePluginData<UsageHistoryEntry[]>("usage-history", {});
  const refresh = usePluginAction("refresh");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh({});
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ ...styles.container, maxWidth: "640px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px" }}>
        AI Provider Usage
      </h2>

      {loading && <div>Loading…</div>}

      {!loading && !snapshot && (
        <div style={styles.empty}>
          No usage data collected yet. Click "Fetch Now" or wait for the next scheduled poll.
        </div>
      )}

      {snapshot && !snapshot.ok && (
        <div style={styles.error}>
          <strong>Error:</strong> {snapshot.error}
        </div>
      )}

      {snapshot?.ok && (
        <div>
          <div style={{ marginBottom: "16px" }}>
            <div style={{ ...styles.heading, marginBottom: "12px" }}>
              Current Quota — {snapshot.provider}
              <span style={{ ...styles.meta, marginLeft: "8px" }}>
                via {snapshot.source} · {formatAge(snapshot.fetchedAt)}
              </span>
            </div>
            {snapshot.windows.map((w, i) => (
              <UsageBar key={i} window={w} />
            ))}
          </div>
        </div>
      )}

      <button style={styles.button} onClick={handleRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh Now"}
      </button>

      {history && history.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
            Recent History ({history.length} snapshots)
          </h3>
          <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px", borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                  Time
                </th>
                <th style={{ textAlign: "left", padding: "4px", borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                  Session
                </th>
                <th style={{ textAlign: "left", padding: "4px", borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                  Week
                </th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((entry, i) => {
                const session = entry.windows.find((w) => w.label.includes("session"));
                const week = entry.windows.find((w) => w.label.includes("all models"));
                return (
                  <tr key={i}>
                    <td style={{ padding: "4px" }}>{formatAge(entry.fetchedAt)}</td>
                    <td style={{ padding: "4px" }}>
                      {session?.usedPercent != null ? `${session.usedPercent}%` : "—"}
                    </td>
                    <td style={{ padding: "4px" }}>
                      {week?.usedPercent != null ? `${week.usedPercent}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export function AgentUsageSettingsPage(_props: PluginSettingsPageProps) {
  const { data: snapshot } = usePluginData<ProviderSnapshot | null>("latest-quota", {});

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Agent Usage Settings</h3>
      <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)", marginBottom: "12px" }}>
        Configure your AI provider credentials and polling interval in the plugin configuration above.
      </p>
      <div style={{ fontSize: "12px" }}>
        <strong>Status:</strong>{" "}
        {snapshot?.ok
          ? `Connected (last fetch: ${formatAge(snapshot.fetchedAt)})`
          : snapshot?.error ?? "Not yet polled"}
      </div>
      <div style={{ fontSize: "12px", marginTop: "4px" }}>
        <strong>Token source:</strong>{" "}
        {snapshot?.source ?? "unknown"}
      </div>
    </div>
  );
}
