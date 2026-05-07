export const PLUGIN_ID = "paperclip-plugin-agent-usage";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "agent-usage";

export const SLOT_IDS = {
  page: "agent-usage-page",
  dashboardWidget: "agent-usage-dashboard-widget",
  settingsPage: "agent-usage-settings-page",
} as const;

export const EXPORT_NAMES = {
  page: "AgentUsagePage",
  dashboardWidget: "AgentUsageDashboardWidget",
  settingsPage: "AgentUsageSettingsPage",
} as const;

export const JOB_KEYS = {
  pollUsage: "poll-usage",
} as const;

export const TOOL_NAMES = {
  getUsage: "get-usage",
  getUsageSummary: "get-usage-summary",
} as const;

export const STATE_KEYS = {
  latestQuota: "latest-quota",
  history: "usage-history",
  lastError: "last-error",
} as const;

export const DEFAULT_CONFIG = {
  claudeOauthToken: "",
  pollIntervalMinutes: 15,
  providers: ["claude"] as string[],
} as const;
