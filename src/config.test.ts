// Tests for reading operator config outside a company invocation scope.
//   GH #66 / LAC-3997 — the scheduled poll-usage job has no company in scope,
//     so an unscoped `ctx.config.get()` is refused with "company context is
//     required". Before this fix the job swallowed that error and silently ran
//     on DEFAULT_CONFIG, so a configured `pollIntervalMinutes` or `providers`
//     was honored on tool-driven polls and ignored on every scheduled one.
//     The company-scoped read goes first so the host's denial path is not hit
//     three times per poll cycle on an install that has a company to name.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readPluginConfig, type ConfigReadContext } from "./config.ts";

const SCOPE_REFUSED =
  'Plugin "p" is not allowed to perform "config.get": company context is required';

interface StubOptions {
  /** Config keyed by company id. The `"unscoped"` key is the no-argument read. */
  config?: Record<string, Record<string, unknown> | null>;
  companies?: { id: string }[];
  companiesThrows?: boolean;
}

function stubContext(options: StubOptions) {
  const calls: { config: (string | undefined)[]; companiesListed: number } = {
    config: [],
    companiesListed: 0,
  };
  const logs: { level: string; message: string }[] = [];
  const config = options.config ?? {};

  const ctx: ConfigReadContext = {
    config: {
      async get(companyId?: string) {
        calls.config.push(companyId);
        const key = companyId ?? "unscoped";
        if (!(key in config)) throw new Error(SCOPE_REFUSED);
        return config[key] as Record<string, unknown>;
      },
    },
    companies: {
      async list(input?: { limit?: number; offset?: number }) {
        calls.companiesListed += 1;
        if (options.companiesThrows) throw new Error("companies.read denied");
        const all = options.companies ?? [];
        return input?.limit === undefined ? all : all.slice(0, input.limit);
      },
    },
    logger: {
      debug(message: string) {
        logs.push({ level: "debug", message });
      },
      warn(message: string) {
        logs.push({ level: "warn", message });
      },
    },
  };

  return { ctx, calls, logs };
}

describe("readPluginConfig", () => {
  it("reads the sole company's config in a scheduled job", async () => {
    const { ctx, calls } = stubContext({
      config: { "co-1": { pollIntervalMinutes: 45, providers: ["claude"] } },
      companies: [{ id: "co-1" }],
    });

    assert.deepEqual(await readPluginConfig(ctx), {
      pollIntervalMinutes: 45,
      providers: ["claude"],
    });
    assert.deepEqual(calls.config, ["co-1"], "names the company instead of probing unscoped");
  });

  it("never trips the host's denial path when a company can be named", async () => {
    // The host logs an ERROR for every refused config.get. Three reads per
    // poll cycle, every 15 minutes, is what made this look like a live fault.
    const { ctx, calls } = stubContext({
      config: { "co-1": { pollIntervalMinutes: 30 }, unscoped: { pollIntervalMinutes: 15 } },
      companies: [{ id: "co-1" }],
    });

    assert.deepEqual(await readPluginConfig(ctx), { pollIntervalMinutes: 30 });
    assert.equal(calls.config.length, 1, "exactly one config read, and it is scoped");
  });

  it("falls back to the unscoped read on a multi-company instance", async () => {
    // Inside a tool call the host derives the company itself, so the unscoped
    // read still works where naming one would be a guess.
    const { ctx, calls } = stubContext({
      config: {
        "co-1": { pollIntervalMinutes: 45 },
        "co-2": { pollIntervalMinutes: 5 },
        unscoped: { pollIntervalMinutes: 20 },
      },
      companies: [{ id: "co-1" }, { id: "co-2" }],
    });

    assert.deepEqual(await readPluginConfig(ctx), { pollIntervalMinutes: 20 });
    assert.deepEqual(calls.config, [undefined], "never guesses which company governs");
  });

  it("uses defaults in a scheduled job on a multi-company instance", async () => {
    const { ctx, logs } = stubContext({
      config: { "co-1": { pollIntervalMinutes: 45 }, "co-2": { pollIntervalMinutes: 5 } },
      companies: [{ id: "co-1" }, { id: "co-2" }],
    });

    assert.deepEqual(await readPluginConfig(ctx), {});
    assert.ok(logs.some((entry) => entry.level === "warn"), "says why it used defaults");
  });

  it("falls back to the unscoped read when the instance has no companies", async () => {
    const { ctx, calls } = stubContext({
      config: { unscoped: { providers: [] } },
      companies: [],
    });

    assert.deepEqual(await readPluginConfig(ctx), { providers: [] });
    assert.deepEqual(calls.config, [undefined]);
  });

  it("falls back to the unscoped read when companies.list is unavailable", async () => {
    const { ctx, calls } = stubContext({
      config: { unscoped: { pollIntervalMinutes: 15 } },
      companiesThrows: true,
    });

    assert.deepEqual(await readPluginConfig(ctx), { pollIntervalMinutes: 15 });
    assert.deepEqual(calls.config, [undefined]);
  });

  it("falls back to the unscoped read when the company has no saved config", async () => {
    // A company with no config row is not in the host's proactive scope set,
    // so the scoped read is refused even though the company exists.
    const { ctx, calls } = stubContext({
      config: { unscoped: { pollIntervalMinutes: 15 } },
      companies: [{ id: "co-1" }],
    });

    assert.deepEqual(await readPluginConfig(ctx), { pollIntervalMinutes: 15 });
    assert.deepEqual(calls.config, ["co-1", undefined]);
  });

  it("uses defaults when every read is refused", async () => {
    const { ctx, calls, logs } = stubContext({ companies: [{ id: "co-1" }] });

    assert.deepEqual(await readPluginConfig(ctx), {});
    assert.deepEqual(calls.config, ["co-1", undefined]);
    assert.ok(logs.some((entry) => entry.level === "warn"));
  });

  it("treats a null config row as empty rather than throwing", async () => {
    const { ctx } = stubContext({ config: { "co-1": null }, companies: [{ id: "co-1" }] });
    assert.deepEqual(await readPluginConfig(ctx), {});
  });
});
