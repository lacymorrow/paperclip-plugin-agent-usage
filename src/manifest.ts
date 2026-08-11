import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Agent Usage Tracker",
  description:
    "Monitors AI provider usage quotas (Claude, etc.) and exposes real-time usage data to agents and the dashboard so they can make smart decisions based on remaining capacity.",
  author: "Paperclip Company",
  categories: ["ui", "automation"],
  capabilities: [
    "companies.read",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "events.emit",
    "jobs.schedule",
    "http.outbound",
    "metrics.write",
    "agent.tools.register",
    "ui.dashboardWidget.register",
    "ui.page.register",
    "instance.settings.register",
    "secrets.read-ref",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      pollIntervalMinutes: {
        type: "number",
        title: "Poll Interval (minutes)",
        description: "How often to refresh usage data from providers.",
        default: DEFAULT_CONFIG.pollIntervalMinutes,
      },
      providers: {
        type: "array",
        title: "Providers to Track",
        items: {
          type: "string",
          enum: ["claude"],
        },
        default: DEFAULT_CONFIG.providers,
      },
      claudeOAuthTokenRef: {
        // A secret-ref field's saved value is either a raw string (typed or
        // pasted directly — the host converts it to a stored secret on
        // save) or a structured { type: "secret_ref", secretId, version }
        // object (bound to an existing/newly-created company secret via the
        // picker). Declaring only "string" here rejects the second shape
        // with "must be string" the moment an operator uses the picker
        // instead of the raw-paste fallback.
        type: ["string", "object"],
        format: "secret-ref",
        title: "Claude OAuth Token",
        description:
          "A Claude Code OAuth token (generate one with `claude setup-token`), stored as a Paperclip secret. Checked first, before any credentials file or CLAUDE_CODE_OAUTH_TOKEN environment variable — the only reliable option when Paperclip runs the plugin worker in its own sandboxed process without the host's environment.",
      },
    },
  },
  jobs: [
    {
      jobKey: JOB_KEYS.pollUsage,
      displayName: "Poll Provider Usage",
      description:
        "Periodically fetches usage quota data from configured AI providers and stores it for agent access.",
      schedule: `*/${DEFAULT_CONFIG.pollIntervalMinutes} * * * *`,
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.getUsage,
      displayName: "Get AI Provider Usage",
      description:
        "Returns current usage quota windows for configured AI providers (utilization percentages, reset times, limits). Use this to check how much capacity remains before starting expensive operations.",
      parametersSchema: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description: "Provider to query. Defaults to 'claude'.",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.getUsageSummary,
      displayName: "Get Usage Summary",
      description:
        "Returns a brief human-readable summary of current usage across all providers, including remaining capacity and reset times.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Agent Usage",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "AI Usage",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
    ],
  },
};

export default manifest;
