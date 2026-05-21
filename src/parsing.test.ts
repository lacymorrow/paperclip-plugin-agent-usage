// Tests for the pure parsing helpers. Covers the bugs fixed in:
//   LAC-1878 — graceful network/CLI error messages
//   LAC-2003 — stripAnsi missing ESC byte (collapsed regex)
//   LAC-2004 — toPercent reported 1% for 100%-utilized windows
//   LAC-2005 — stripAnsi alternation order (CSI before single-char)
//   LAC-2023 — cleanTerminalText was stripping spaces, breaking guards
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalQuotaLabel,
  cleanTerminalText,
  formatCurrency,
  formatTimeDelta,
  friendlyErrorMessage,
  isQuotaLabel,
  normalizeForLabelSearch,
  parseAnthropicResponse,
  parseClaudeCliUsageText,
  percentFromLine,
  stripAnsi,
  stripBackspaces,
  toPercent,
  trimToLatestUsagePanel,
} from "./parsing.ts";

// ---------------------------------------------------------------------------
// toPercent — LAC-2004
// ---------------------------------------------------------------------------

test("toPercent: returns null for nullish input", () => {
  assert.equal(toPercent(null), null);
  assert.equal(toPercent(undefined), null);
});

test("toPercent: returns null for non-finite input (NaN, Infinity)", () => {
  assert.equal(toPercent(Number.NaN), null);
  assert.equal(toPercent(Number.POSITIVE_INFINITY), null);
  assert.equal(toPercent(Number.NEGATIVE_INFINITY), null);
});

test("toPercent: scales 0..1 fractions to 0..100", () => {
  assert.equal(toPercent(0), 0);
  assert.equal(toPercent(0.5), 50);
  assert.equal(toPercent(0.755), 76);
});

test("toPercent: 100% utilization reports 100 (regression: LAC-2004)", () => {
  // The pre-fix code treated `utilization < 1` as a fraction and `>= 1` as
  // already-percent, so utilization === 1.0 fell into the "already-percent"
  // branch and became 1, not 100.
  assert.equal(toPercent(1), 100);
  assert.equal(toPercent(0.999), 100);
});

test("toPercent: clamps over-100 values to 100", () => {
  assert.equal(toPercent(1.5), 100);
  assert.equal(toPercent(99999), 100);
});

test("toPercent: clamps negative values to 0", () => {
  assert.equal(toPercent(-0.1), 0);
  assert.equal(toPercent(-1), 0);
});

// ---------------------------------------------------------------------------
// stripBackspaces
// ---------------------------------------------------------------------------

test("stripBackspaces: removes preceding char for each \\b", () => {
  assert.equal(stripBackspaces("abc\b"), "ab");
  assert.equal(stripBackspaces("hello\b\b\b\b\bworld"), "world");
  assert.equal(stripBackspaces("\b\b"), "");
  assert.equal(stripBackspaces("no backspaces"), "no backspaces");
});

// ---------------------------------------------------------------------------
// stripAnsi — LAC-2003 / LAC-2005
// ---------------------------------------------------------------------------

test("stripAnsi: removes CSI escape sequences", () => {
  // \x1b[31m  → red FG;  \x1b[0m  → reset
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
  assert.equal(stripAnsi("foo \x1b[1;32mgreen\x1b[0m bar"), "foo green bar");
});

test("stripAnsi: removes OSC escape sequences terminated by BEL", () => {
  // \x1b] ... \x07 → OSC ... BEL
  assert.equal(stripAnsi("\x1b]0;some title\x07rest"), "rest");
});

test("stripAnsi: removes OSC escape sequences terminated by ST", () => {
  // \x1b] ... \x1b\ → OSC ... ST
  assert.equal(stripAnsi("\x1b]0;title\x1b\\rest"), "rest");
});

test("stripAnsi: removes single-char ESC sequences (LAC-2005: CSI must match first)", () => {
  // The fixed regex has the CSI alternation first; the previous version
  // matched the single-char alternative greedily and ate the `[` of a
  // following CSI introducer.
  assert.equal(stripAnsi("\x1b[2Jhello"), "hello");
  // Pure single-char: \x1bM (reverse index)
  assert.equal(stripAnsi("a\x1bMb"), "ab");
});

test("stripAnsi: does NOT destroy plain content (regression: LAC-2003)", () => {
  // Pre-fix regex was missing the ESC byte and collapsed to /\][^]*(?:|\\)/,
  // which matched any `]` followed by anything to end-of-input. A line like
  // "Current session [stuff] used 50% remaining" was butchered down to
  // "urrent session tuff" because the broken patterns also deleted bare
  // uppercase letters and backslashes.
  const original = "Current session [stuff] used 50% remaining";
  assert.equal(stripAnsi(original), original);
});

test("stripAnsi: leaves bracketed plain text alone (no spurious deletions)", () => {
  assert.equal(stripAnsi("[INFO] worker started"), "[INFO] worker started");
  assert.equal(stripAnsi("path = C:\\Users\\me"), "path = C:\\Users\\me");
});

// ---------------------------------------------------------------------------
// cleanTerminalText — LAC-2023
// ---------------------------------------------------------------------------

test("cleanTerminalText: converts \\r to \\n", () => {
  assert.equal(cleanTerminalText("a\rb\rc"), "a\nb\nc");
});

test("cleanTerminalText: preserves spaces (regression: LAC-2023)", () => {
  // Previously this function called .replace(/ /g, "") which collapsed
  // "Current session" into "Currentsession", defeating the
  // "current session" guard inside parseClaudeCliUsageText.
  assert.equal(cleanTerminalText("Current session"), "Current session");
  assert.equal(cleanTerminalText("hello world"), "hello world");
});

test("cleanTerminalText: strips ANSI and backspaces together", () => {
  // \b deletes the preceding 'o' (leaving "fo"), then ANSI codes are stripped.
  assert.equal(cleanTerminalText("foo\b\x1b[31mbar\x1b[0m"), "fobar");
});

// ---------------------------------------------------------------------------
// normalizeForLabelSearch / isQuotaLabel / canonicalQuotaLabel
// ---------------------------------------------------------------------------

test("normalizeForLabelSearch: lowercases and strips non-alphanumerics", () => {
  assert.equal(normalizeForLabelSearch("Current Session (5h)"), "currentsession5h");
  assert.equal(normalizeForLabelSearch("Week — Sonnet"), "weeksonnet");
});

test("isQuotaLabel: recognises canonical CLI labels", () => {
  assert.equal(isQuotaLabel("Current session"), true);
  assert.equal(isQuotaLabel("Current week (all models)"), true);
  assert.equal(isQuotaLabel("Current week (Sonnet only)"), true);
  assert.equal(isQuotaLabel("Current week (Opus only)"), true);
  assert.equal(isQuotaLabel("Extra usage"), true);
  assert.equal(isQuotaLabel("Random other line"), false);
  assert.equal(isQuotaLabel(""), false);
});

test("canonicalQuotaLabel: maps CLI labels to display labels", () => {
  assert.equal(canonicalQuotaLabel("Current session"), "Current session (5h)");
  assert.equal(canonicalQuotaLabel("Current week (all models)"), "Week — all models");
  assert.equal(canonicalQuotaLabel("Current week (Sonnet only)"), "Week — Sonnet");
  assert.equal(canonicalQuotaLabel("Current week (Sonnet)"), "Week — Sonnet");
  assert.equal(canonicalQuotaLabel("Current week (Opus only)"), "Week — Opus");
  assert.equal(canonicalQuotaLabel("Extra usage"), "Extra usage");
  assert.equal(canonicalQuotaLabel("Unknown label"), "Unknown label");
});

// ---------------------------------------------------------------------------
// percentFromLine
// ---------------------------------------------------------------------------

test("percentFromLine: extracts a plain percentage", () => {
  assert.equal(percentFromLine("Used 42% so far"), 42);
  assert.equal(percentFromLine("0%"), 0);
  assert.equal(percentFromLine("100%"), 100);
});

test("percentFromLine: inverts when the line mentions 'remaining'/'left'/'available'", () => {
  // The Claude CLI prints "X% remaining" rather than "Y% used".
  assert.equal(percentFromLine("50% remaining"), 50);
  assert.equal(percentFromLine("75% remaining"), 25);
  assert.equal(percentFromLine("10% left"), 90);
  assert.equal(percentFromLine("0% available"), 100);
});

test("percentFromLine: clamps before inverting", () => {
  // A theoretical "150% remaining" should still produce a valid 0..100.
  assert.equal(percentFromLine("150% remaining"), 0);
});

test("percentFromLine: returns null when there is no percentage", () => {
  assert.equal(percentFromLine("no number here"), null);
  assert.equal(percentFromLine(""), null);
});

test("percentFromLine: handles fractional percents", () => {
  assert.equal(percentFromLine("12.7%"), 13);
  assert.equal(percentFromLine("99.4% remaining"), 1);
});

// ---------------------------------------------------------------------------
// trimToLatestUsagePanel
// ---------------------------------------------------------------------------

test("trimToLatestUsagePanel: returns null when no settings: marker", () => {
  assert.equal(trimToLatestUsagePanel("just some text"), null);
});

test("trimToLatestUsagePanel: returns null when tail has no usage data", () => {
  assert.equal(trimToLatestUsagePanel("settings: nothing useful here"), null);
});

test("trimToLatestUsagePanel: returns tail starting at the LAST settings: when it includes usage", () => {
  const text = [
    "settings: first panel (no usage)",
    "more stuff",
    "settings: second panel",
    "usage Current session 50% remaining",
  ].join("\n");
  const result = trimToLatestUsagePanel(text);
  assert.ok(result, "should find a tail");
  assert.ok(result!.startsWith("settings: second panel"));
  assert.ok(result!.includes("Current session"));
});

// ---------------------------------------------------------------------------
// parseClaudeCliUsageText — integration of the helpers above
// ---------------------------------------------------------------------------

test("parseClaudeCliUsageText: parses a minimal CLI panel with one session window", () => {
  // Note: cleanTerminalText converts \r → \n but otherwise preserves text.
  // The "remaining" wording is what the real Claude CLI prints.
  const text = [
    "settings: usage panel",
    "Current session",
    "50% remaining",
  ].join("\n");
  const windows = parseClaudeCliUsageText(text);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].label, "Current session (5h)");
  assert.equal(windows[0].usedPercent, 50);
});

test("parseClaudeCliUsageText: parses all four quota windows", () => {
  const text = [
    "settings: usage panel",
    "Current session",
    "30% remaining",
    "Current week (all models)",
    "20% remaining",
    "Current week (Sonnet only)",
    "70% remaining",
    "Current week (Opus only)",
    "0% remaining",
  ].join("\n");
  const windows = parseClaudeCliUsageText(text);
  assert.deepEqual(
    windows.map((w) => ({ label: w.label, usedPercent: w.usedPercent })),
    [
      { label: "Current session (5h)", usedPercent: 70 },
      { label: "Week — all models", usedPercent: 80 },
      { label: "Week — Sonnet", usedPercent: 30 },
      { label: "Week — Opus", usedPercent: 100 },
    ],
  );
});

test("parseClaudeCliUsageText: tolerates ANSI escapes in the input (regression: LAC-2003)", () => {
  // Real CLI output is wrapped in ANSI styling. The fixed stripAnsi must
  // remove the colors without destroying the surrounding labels/numbers.
  const text = [
    "\x1b[1msettings:\x1b[0m usage panel",
    "\x1b[36mCurrent session\x1b[0m",
    "\x1b[33m25% remaining\x1b[0m",
  ].join("\n");
  const windows = parseClaudeCliUsageText(text);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].label, "Current session (5h)");
  assert.equal(windows[0].usedPercent, 75);
});

test("parseClaudeCliUsageText: throws when no session window can be found", () => {
  assert.throws(
    () => parseClaudeCliUsageText("nothing useful"),
    /Could not parse Claude CLI usage output/,
  );
});

// ---------------------------------------------------------------------------
// parseAnthropicResponse — LAC-2004
// ---------------------------------------------------------------------------

test("parseAnthropicResponse: empty body produces zero windows", () => {
  assert.deepEqual(parseAnthropicResponse({}), []);
});

test("parseAnthropicResponse: builds windows for every present field", () => {
  const out = parseAnthropicResponse({
    five_hour: { utilization: 0.5, resets_at: "2026-05-21T12:00:00Z" },
    seven_day: { utilization: 0.25, resets_at: null },
    seven_day_sonnet: { utilization: 0.1, resets_at: null },
    seven_day_opus: { utilization: 0.9, resets_at: null },
  });
  assert.deepEqual(
    out.map((w) => ({ label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt })),
    [
      { label: "Current session (5h)", usedPercent: 50, resetsAt: "2026-05-21T12:00:00Z" },
      { label: "Week — all models", usedPercent: 25, resetsAt: null },
      { label: "Week — Sonnet", usedPercent: 10, resetsAt: null },
      { label: "Week — Opus", usedPercent: 90, resetsAt: null },
    ],
  );
});

test("parseAnthropicResponse: 100% utilization round-trips to 100 (regression: LAC-2004)", () => {
  const out = parseAnthropicResponse({
    five_hour: { utilization: 1, resets_at: null },
  });
  assert.equal(out[0].usedPercent, 100);
});

test("parseAnthropicResponse: extra_usage disabled flag shows 'Not enabled'", () => {
  const out = parseAnthropicResponse({
    extra_usage: { is_enabled: false },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Extra usage");
  assert.equal(out[0].usedPercent, null);
  assert.equal(out[0].valueLabel, "Not enabled");
  assert.equal(out[0].detail, "Extra usage not enabled");
});

test("parseAnthropicResponse: extra_usage enabled emits formatted currency label", () => {
  const out = parseAnthropicResponse({
    extra_usage: {
      is_enabled: true,
      monthly_limit: 5000, // cents → $50.00
      used_credits: 1234, // cents → $12.34
      utilization: 0.2468,
      currency: "USD",
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].usedPercent, 25);
  assert.equal(out[0].valueLabel, "$12.34 / $50.00");
  assert.equal(out[0].detail, "Monthly extra usage pool");
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

test("formatCurrency: defaults to USD when currency is missing/blank", () => {
  assert.equal(formatCurrency(12.5, null), "$12.50");
  assert.equal(formatCurrency(12.5, ""), "$12.50");
  assert.equal(formatCurrency(12.5, "   "), "$12.50");
});

test("formatCurrency: trims and upper-cases the currency code", () => {
  // We just check it contains the symbol/code; ICU output format varies.
  const eur = formatCurrency(10, " eur ");
  assert.ok(/€|EUR/.test(eur), `expected € or EUR in "${eur}"`);
});

// ---------------------------------------------------------------------------
// friendlyErrorMessage — LAC-1878
// ---------------------------------------------------------------------------

test("friendlyErrorMessage: maps network-y errors to a clean message", () => {
  const expected = "Network unavailable — check your internet connection and try again.";
  assert.equal(friendlyErrorMessage(new Error("ENOTFOUND api.anthropic.com")), expected);
  assert.equal(friendlyErrorMessage(new Error("ECONNREFUSED 127.0.0.1:443")), expected);
  assert.equal(friendlyErrorMessage(new Error("ENETUNREACH")), expected);
  assert.equal(friendlyErrorMessage(new Error("EAI_AGAIN")), expected);
  assert.equal(friendlyErrorMessage(new Error("EHOSTUNREACH")), expected);
  assert.equal(friendlyErrorMessage(new Error("ETIMEDOUT")), expected);
  assert.equal(friendlyErrorMessage(new Error("fetch failed")), expected);
  assert.equal(friendlyErrorMessage(new Error("some network issue")), expected);
});

test("friendlyErrorMessage: scrubs 'Command failed: ...' shell leakage (regression: LAC-1878)", () => {
  // The raw exec error message would otherwise leak the full sh -c command,
  // including the encoded `printf '\\033'` ESC bytes.
  const leaky = new Error(
    "Command failed: sh -c (sleep 2; printf '/usage\\r'; sleep 6; printf '\\033'; sleep 1; printf '\\003') | script -q /dev/null claude --tools \"\"",
  );
  assert.equal(
    friendlyErrorMessage(leaky),
    "Claude CLI command failed — ensure Claude is installed and your network is available.",
  );
});

test("friendlyErrorMessage: passes through unrelated errors unchanged", () => {
  assert.equal(friendlyErrorMessage(new Error("Something else broke")), "Something else broke");
  assert.equal(friendlyErrorMessage("plain string error"), "plain string error");
});

// ---------------------------------------------------------------------------
// formatTimeDelta
// ---------------------------------------------------------------------------

test("formatTimeDelta: returns 'now' for past or current time", () => {
  const now = Date.parse("2026-05-21T12:00:00Z");
  assert.equal(formatTimeDelta("2026-05-21T11:00:00Z", now), "now");
  assert.equal(formatTimeDelta("2026-05-21T12:00:00Z", now), "now");
});

test("formatTimeDelta: minute / hour / day buckets", () => {
  const now = Date.parse("2026-05-21T12:00:00Z");
  assert.equal(formatTimeDelta("2026-05-21T12:30:00Z", now), "30m");
  assert.equal(formatTimeDelta("2026-05-21T15:00:00Z", now), "3h");
  assert.equal(formatTimeDelta("2026-05-24T12:00:00Z", now), "3d");
});
