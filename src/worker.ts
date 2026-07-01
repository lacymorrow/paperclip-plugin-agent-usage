import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import { DEFAULT_CONFIG, JOB_KEYS, STATE_KEYS, TOOL_NAMES } from "./constants.js";

const execFileAsync = promisify(execFile);

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

interface PluginConfig {
  pollIntervalMinutes?: number;
  providers?: string[];
}

// ---------------------------------------------------------------------------
// Anthropic OAuth Usage API
// ---------------------------------------------------------------------------

interface AnthropicUsageWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface AnthropicExtraUsage {
  is_enabled?: boolean | null;
  monthly_limit?: number | null;
  used_credits?: number | null;
  utilization?: number | null;
  currency?: string | null;
}

interface AnthropicUsageResponse {
  five_hour?: AnthropicUsageWindow | null;
  seven_day?: AnthropicUsageWindow | null;
  seven_day_sonnet?: AnthropicUsageWindow | null;
  seven_day_opus?: AnthropicUsageWindow | null;
  extra_usage?: AnthropicExtraUsage | null;
}

function toPercent(utilization: number | null | undefined): number | null {
  if (utilization == null || !Number.isFinite(utilization)) return null;
  return Math.max(0, Math.min(100, Math.round(utilization * 100)));
}

function formatCurrency(value: number, currency: string | null | undefined): string {
  const code =
    typeof currency === "string" && currency.trim().length > 0
      ? currency.trim().toUpperCase()
      : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseAnthropicResponse(body: AnthropicUsageResponse): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  if (body.five_hour != null) {
    windows.push({
      label: "Current session (5h)",
      usedPercent: toPercent(body.five_hour.utilization),
      resetsAt: body.five_hour.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }
  if (body.seven_day != null) {
    windows.push({
      label: "Week — all models",
      usedPercent: toPercent(body.seven_day.utilization),
      resetsAt: body.seven_day.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }
  if (body.seven_day_sonnet != null) {
    windows.push({
      label: "Week — Sonnet",
      usedPercent: toPercent(body.seven_day_sonnet.utilization),
      resetsAt: body.seven_day_sonnet.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }
  if (body.seven_day_opus != null) {
    windows.push({
      label: "Week — Opus",
      usedPercent: toPercent(body.seven_day_opus.utilization),
      resetsAt: body.seven_day_opus.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }
  if (body.extra_usage != null) {
    const eu = body.extra_usage;
    let valueLabel: string | null = null;
    if (
      eu.is_enabled !== false &&
      typeof eu.monthly_limit === "number" &&
      typeof eu.used_credits === "number"
    ) {
      valueLabel = `${formatCurrency(eu.used_credits / 100, eu.currency)} / ${formatCurrency(eu.monthly_limit / 100, eu.currency)}`;
    }
    windows.push({
      label: "Extra usage",
      usedPercent: eu.is_enabled === false ? null : toPercent(eu.utilization),
      resetsAt: null,
      valueLabel: eu.is_enabled === false ? "Not enabled" : valueLabel,
      detail: eu.is_enabled === false ? "Extra usage not enabled" : "Monthly extra usage pool",
    });
  }

  return windows;
}

async function fetchAnthropicUsage(token: string): Promise<QuotaWindow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Anthropic usage API returned ${resp.status}`);
    const body = (await resp.json()) as AnthropicUsageResponse;
    return parseAnthropicResponse(body);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Token resolution (auto-detect from local ~/.claude credentials)
// ---------------------------------------------------------------------------

function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(os.homedir(), ".claude");
}

async function readLocalClaudeToken(): Promise<string | null> {
  const configDir = claudeConfigDir();
  for (const filename of [".credentials.json", "credentials.json"]) {
    try {
      const raw = await fs.readFile(path.join(configDir, filename), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const oauth = parsed["claudeAiOauth"] as Record<string, unknown> | undefined;
      const token = oauth?.["accessToken"];
      if (typeof token === "string" && token.length > 0) return token;
    } catch {
      // continue
    }
  }

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ], { timeout: 3000 });
      const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
      const oauth = parsed["claudeAiOauth"] as Record<string, unknown> | undefined;
      const token = oauth?.["accessToken"];
      if (typeof token === "string" && token.length > 0) return token;
    } catch {
      // continue
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// CLI fallback — spawns `claude /usage` and parses the terminal output
// ---------------------------------------------------------------------------

function stripBackspaces(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\b") {
      out = out.slice(0, -1);
    } else {
      out += char;
    }
  }
  return out;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g, "");
}

function cleanTerminalText(text: string): string {
  return stripAnsi(stripBackspaces(text)).replace(/\r/g, "\n");
}

function normalizeForLabelSearch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function trimToLatestUsagePanel(text: string): string | null {
  const lower = text.toLowerCase();
  const settingsIndex = lower.lastIndexOf("settings:");
  if (settingsIndex < 0) return null;
  const tail = text.slice(settingsIndex);
  const tailLower = tail.toLowerCase();
  if (!tailLower.includes("usage")) return null;
  if (!tailLower.includes("current session") && !tailLower.includes("loading usage")) return null;
  return tail;
}

function isQuotaLabel(line: string): boolean {
  const n = normalizeForLabelSearch(line);
  return n === "currentsession"
    || n === "currentweekallmodels"
    || n === "currentweeksonnetonly"
    || n === "currentweeksonnet"
    || n === "currentweekopusonly"
    || n === "currentweekopus"
    || n === "extrausage";
}

function canonicalQuotaLabel(line: string): string {
  switch (normalizeForLabelSearch(line)) {
    case "currentsession": return "Current session (5h)";
    case "currentweekallmodels": return "Week — all models";
    case "currentweeksonnetonly":
    case "currentweeksonnet": return "Week — Sonnet";
    case "currentweekopusonly":
    case "currentweekopus": return "Week — Opus";
    case "extrausage": return "Extra usage";
    default: return line;
  }
}

function percentFromLine(line: string): number | null {
  const match = line.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%/i);
  if (!match) return null;
  const rawValue = Number(match[1]);
  if (!Number.isFinite(rawValue)) return null;
  const clamped = Math.min(100, Math.max(0, rawValue));
  const lower = line.toLowerCase();
  if (lower.includes("remaining") || lower.includes("left") || lower.includes("available")) {
    return Math.max(0, Math.min(100, Math.round(100 - clamped)));
  }
  return Math.round(clamped);
}

function parseClaudeCliUsageText(text: string): QuotaWindow[] {
  const cleaned = trimToLatestUsagePanel(cleanTerminalText(text)) ?? cleanTerminalText(text);
  const lines = cleaned.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  const sections: Array<{ label: string; lines: string[] }> = [];
  let current: { label: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (isQuotaLabel(line)) {
      if (current) sections.push(current);
      current = { label: canonicalQuotaLabel(line), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  const windows = sections.map<QuotaWindow>((section) => {
    const usedPercent = section.lines.map(percentFromLine).find((v) => v != null) ?? null;
    return {
      label: section.label,
      usedPercent,
      resetsAt: null,
      valueLabel: null,
      detail: null,
    };
  });

  if (!windows.some((w) => normalizeForLabelSearch(w.label).includes("session"))) {
    throw new Error("Could not parse Claude CLI usage output.");
  }
  return windows;
}

function createClaudeQuotaEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("ANTHROPIC_")) continue;
    env[key] = value;
  }
  return env;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runClaudeCliCommand(timeoutMs: number): Promise<QuotaWindow[]> {
  const feed = "(sleep 3; printf '/usage\\r'; sleep 8; printf '\\033'; sleep 1; printf '\\003')";
  const claudeCommand = "claude --tools \"\"";
  const command = process.platform === "darwin"
    ? `${feed} | script -q /dev/null ${claudeCommand}`
    : `${feed} | script -q -e -f -c ${quoteForShell(claudeCommand)} /dev/null`;

  try {
    let output = "";
    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
        env: createClaudeQuotaEnv(),
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
      output = `${stdout}${stderr}`;
    } catch (error) {
      const stdout = typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      output = `${stdout}${stderr}`;
      const cleaned = cleanTerminalText(output);
      if (!cleaned.toLowerCase().includes("current session")) {
        throw error;
      }
    }

    return parseClaudeCliUsageText(output);
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

async function fetchClaudeCliQuota(timeoutMs = 20_000): Promise<QuotaWindow[]> {
  try {
    return await runClaudeCliCommand(timeoutMs);
  } catch (firstError) {
    const msg = firstError instanceof Error ? firstError.message : String(firstError);
    console.warn(`CLI quota fetch failed on first attempt, retrying: ${msg}`);
    return await runClaudeCliCommand(timeoutMs);
  }
}

// ---------------------------------------------------------------------------
// Error normalisation — strip leaked commands & detect network failures
// ---------------------------------------------------------------------------

function friendlyErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (/ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return "Network unavailable — check your internet connection and try again.";
  }

  if (/ENOENT|EACCES|permission denied/i.test(msg)) {
    return "Claude CLI not accessible — ensure Claude is installed and on your PATH.";
  }

  if (/Command failed:|SIGTERM|SIGKILL|killed/i.test(msg)) {
    return "Claude CLI command failed — ensure Claude is installed and your network is available.";
  }

  if (/sh\s+-c|script\s+-q|printf\b/i.test(msg)) {
    return "Claude CLI command failed — ensure Claude is installed and your network is available.";
  }

  return msg;
}

// ---------------------------------------------------------------------------
// Core fetch logic
// ---------------------------------------------------------------------------

// Serialize pollAndStore so the scheduled job, the `refresh` action, and the
// tool-driven stale-snapshot fallback never read-modify-write `usage-history`
// concurrently. Each caller queues onto a shared promise chain and runs its
// own poll + append after the previous call finishes, so no history entries
// are lost. Failures don't poison the chain.
let pollChain: Promise<unknown> = Promise.resolve();

function pollAndStore(ctx: PluginContext): Promise<ProviderSnapshot> {
  const next = pollChain.then(() => runPollAndStore(ctx));
  pollChain = next.catch(() => undefined);
  return next;
}

async function runPollAndStore(ctx: PluginContext): Promise<ProviderSnapshot> {
  const config = (await ctx.config.get()) as PluginConfig;
  const enabledProviders = config.providers ?? DEFAULT_CONFIG.providers;

  if (!enabledProviders.includes("claude")) {
    const snapshot: ProviderSnapshot = {
      provider: "claude",
      source: null,
      ok: false,
      error: "Provider 'claude' is not enabled in config",
      windows: [],
      fetchedAt: new Date().toISOString(),
    };
    await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.latestQuota }, snapshot);
    return snapshot;
  }

  let snapshot: ProviderSnapshot;
  try {
    const token = await readLocalClaudeToken();
    let windows: QuotaWindow[];
    let source: string;

    if (token) {
      try {
        windows = await fetchAnthropicUsage(token);
        source = "anthropic-oauth";
      } catch {
        windows = await fetchClaudeCliQuota();
        source = "claude-cli";
      }
    } else {
      windows = await fetchClaudeCliQuota();
      source = "claude-cli";
    }
    snapshot = {
      provider: "claude",
      source,
      ok: true,
      error: null,
      windows,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = friendlyErrorMessage(err);
    snapshot = {
      provider: "claude",
      source: null,
      ok: false,
      error: message,
      windows: [],
      fetchedAt: new Date().toISOString(),
    };
    await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.lastError }, message);
    ctx.logger.warn("Usage poll failed", { error: message });
  }

  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.latestQuota }, snapshot);

  if (snapshot.ok && snapshot.windows.length > 0) {
    const existing =
      ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.history })) as
        | UsageHistoryEntry[]
        | null) ?? [];
    existing.unshift({ fetchedAt: snapshot.fetchedAt, windows: snapshot.windows });
    if (existing.length > 96) existing.length = 96;
    await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.history }, existing);

    for (const w of snapshot.windows) {
      if (w.usedPercent != null) {
        await ctx.metrics.write("usage.percent", w.usedPercent, {
          provider: "claude",
          window: w.label,
        });
      }
    }
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// Human-readable summary for agent tool
// ---------------------------------------------------------------------------

function formatTimeDelta(isoDate: string): string {
  const delta = new Date(isoDate).getTime() - Date.now();
  if (delta <= 0) return "now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// Tool handlers treat a snapshot as stale when it's older than the configured
// poll interval. Floored at 5 minutes so an aggressive `pollIntervalMinutes: 1`
// doesn't burn CLI invocations on every tool call.
async function staleThresholdMs(ctx: PluginContext): Promise<number> {
  const config = (await ctx.config.get()) as PluginConfig;
  const intervalMinutes = config.pollIntervalMinutes ?? DEFAULT_CONFIG.pollIntervalMinutes;
  return Math.max(intervalMinutes, 5) * 60_000;
}

function buildSummary(snapshot: ProviderSnapshot): string {
  if (!snapshot.ok) return `Claude usage unavailable: ${snapshot.error}`;
  if (snapshot.windows.length === 0) return "No usage data available.";

  const lines: string[] = [`Claude usage (as of ${snapshot.fetchedAt}):`];
  for (const w of snapshot.windows) {
    let line = `  ${w.label}: `;
    if (w.usedPercent != null) {
      const remaining = 100 - w.usedPercent;
      line += `${remaining}% remaining`;
    } else if (w.valueLabel) {
      line += w.valueLabel;
    } else {
      line += "unknown";
    }
    if (w.resetsAt) {
      line += ` (resets in ${formatTimeDelta(w.resetsAt)})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.data.register("latest-quota", async () => {
      const snapshot = (await ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEYS.latestQuota,
      })) as ProviderSnapshot | null;
      return snapshot;
    });

    ctx.data.register("usage-history", async () => {
      const history = (await ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEYS.history,
      })) as UsageHistoryEntry[] | null;
      return history ?? [];
    });

    ctx.actions.register("refresh", async () => {
      const snapshot = await pollAndStore(ctx);
      return snapshot;
    });

    ctx.jobs.register(JOB_KEYS.pollUsage, async () => {
      const jobConfig = (await ctx.config.get()) as PluginConfig;
      const intervalMinutes = jobConfig.pollIntervalMinutes ?? DEFAULT_CONFIG.pollIntervalMinutes;

      const lastSnapshot = (await ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEYS.latestQuota,
      })) as ProviderSnapshot | null;

      if (lastSnapshot) {
        const elapsedMs = Date.now() - new Date(lastSnapshot.fetchedAt).getTime();
        if (elapsedMs < intervalMinutes * 60_000 * 0.9) {
          ctx.logger.info("Skipping poll — configured interval not yet elapsed", { intervalMinutes });
          return;
        }
      }

      ctx.logger.info("Running scheduled usage poll");
      await pollAndStore(ctx);
    });

    ctx.tools.register(
      TOOL_NAMES.getUsage,
      {
        displayName: "Get AI Provider Usage",
        description:
          "Returns current usage quota windows for configured AI providers.",
        parametersSchema: {
          type: "object",
          properties: {
            provider: { type: "string" },
          },
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const { provider } = (params ?? {}) as { provider?: string };
        const requestedProvider = provider?.trim().toLowerCase() || "claude";

        if (requestedProvider !== "claude") {
          return {
            content: JSON.stringify({
              ok: false,
              error: `Provider '${requestedProvider}' is not supported. Currently only 'claude' is available.`,
            }),
          };
        }

        let snapshot = (await ctx.state.get({
          scopeKind: "instance",
          stateKey: STATE_KEYS.latestQuota,
        })) as ProviderSnapshot | null;

        const thresholdMs = await staleThresholdMs(ctx);
        if (
          !snapshot ||
          Date.now() - new Date(snapshot.fetchedAt).getTime() > thresholdMs
        ) {
          snapshot = await pollAndStore(ctx);
        }

        return { content: JSON.stringify(snapshot, null, 2) };
      },
    );

    ctx.tools.register(
      TOOL_NAMES.getUsageSummary,
      {
        displayName: "Get Usage Summary",
        description:
          "Returns a brief human-readable summary of current usage across all providers.",
        parametersSchema: {
          type: "object",
          properties: {},
        },
      },
      async (_params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        let snapshot = (await ctx.state.get({
          scopeKind: "instance",
          stateKey: STATE_KEYS.latestQuota,
        })) as ProviderSnapshot | null;

        const thresholdMs = await staleThresholdMs(ctx);
        if (
          !snapshot ||
          Date.now() - new Date(snapshot.fetchedAt).getTime() > thresholdMs
        ) {
          snapshot = await pollAndStore(ctx);
        }

        return { content: buildSummary(snapshot) };
      },
    );

    ctx.logger.info("Agent Usage plugin initialized");
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    return { status: "ok", message: "Agent Usage plugin running" };
  },
});

runWorker(plugin, import.meta.url);
