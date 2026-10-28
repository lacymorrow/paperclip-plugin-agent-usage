// Reading operator config from the scheduled job.
//
// `ctx.config.get()` with no argument only resolves inside a host-issued
// invocation (a tool call, an action, an event), where the host already knows
// which company the call belongs to. A scheduled job has no such scope:
// `PluginJobContext` carries only `jobKey`, `runId`, `trigger` and
// `scheduledAt`, and the host's `runJob` dispatch registers no company, so an
// unscoped `config.get` from a job is refused with "company context is
// required" and the job silently runs on DEFAULT_CONFIG.
//
// The host does admit a proactive call that names a company the plugin is
// configured for, so the job can read config by passing the company id
// explicitly. `companies.list` is exempt from the scope check, which is how we
// find it. See GitHub #66.
//
// The company-scoped read goes first on every path, not just in the job. Both
// orders return the same config, but the host logs an ERROR for each refusal,
// and polling every 15 minutes with three config reads per cycle turns that
// into thousands of log lines that look like a live fault.
//
// Multi-company installs fall back to defaults in the job, on purpose. This
// plugin's state is `scopeKind: "instance"` — one shared snapshot for the whole
// install — so there is no principled way to say which company's config should
// govern it, and picking the first company would be wrong the moment a second
// one exists.

export interface PluginConfig {
  pollIntervalMinutes?: number;
  providers?: string[];
}

/** The slice of `PluginContext` this module needs. */
export interface ConfigReadContext {
  config: { get(companyId?: string): Promise<Record<string, unknown>> };
  companies: { list(input?: { limit?: number; offset?: number }): Promise<{ id: string }[]> };
  logger: {
    debug(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * The single company whose config governs this install, or `null` when the
 * instance has zero or more than one company.
 */
async function soleCompanyId(ctx: ConfigReadContext): Promise<string | null> {
  try {
    // limit 2 is enough to tell "exactly one" from "more than one".
    const companies = await ctx.companies.list({ limit: 2 });
    return companies.length === 1 ? companies[0].id : null;
  } catch (err) {
    ctx.logger.debug("companies.list unavailable", { error: String(err) });
    return null;
  }
}

/**
 * Read the plugin's operator config from any context, scheduled job included.
 *
 * Returns `{}` rather than throwing when config is genuinely unreachable, so
 * the caller falls back to `DEFAULT_CONFIG` and polling keeps running.
 */
export async function readPluginConfig(ctx: ConfigReadContext): Promise<PluginConfig> {
  const companyId = await soleCompanyId(ctx);

  if (companyId) {
    try {
      return ((await ctx.config.get(companyId)) as PluginConfig | null) ?? {};
    } catch (err) {
      // The company has no saved config, or the host declined the proactive
      // scope. Either way the unscoped read below is the remaining option.
      ctx.logger.debug("company-scoped config.get failed", { companyId, error: String(err) });
    }
  }

  try {
    return ((await ctx.config.get()) as PluginConfig | null) ?? {};
  } catch (err) {
    // No company in scope and none to name: a scheduled job on an instance
    // with zero or several companies. Defaults, as documented above.
    ctx.logger.warn("config unavailable, using defaults", { error: String(err) });
    return {};
  }
}
