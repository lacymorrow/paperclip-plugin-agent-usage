// Tests for the pure parsing helpers. Covers the bugs fixed in:
//   LAC-1878 — graceful network/CLI error messages
//   LAC-2003 — stripAnsi missing ESC byte (collapsed regex)
//   LAC-2004 — toPercent reported 1% for 100%-utilized windows
//   LAC-2005 — stripAnsi alternation order (CSI before single-char)
//   LAC-2023 — cleanTerminalText was stripping spaces, breaking guards
//   2026-08-03 — toPercent treated `utilization` as a 0..1 fraction and
//     multiplied by 100. The real API returns it as a whole percentage
//     already (confirmed against the same response's own `limits[].percent`
//     field), so any real usage >=1% was clamping straight to 100%. This
//     reverses LAC-2004's fix, which was chasing the opposite bug against
//     the wrong assumption about the API's units.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalQuotaLabel,
  cleanTerminalText,
  extractAccountEmail,
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
// toPercent
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

test("toPercent: passes whole percentages through, rounding fractional ones", () => {
  assert.equal(toPercent(0), 0);
  assert.equal(toPercent(50), 50);
  assert.equal(toPercent(75.6), 76);
});

test("toPercent: low utilization stays low (regression: 2026-08-03)", () => {
  // A real low-usage account returned utilization: 1.0 (1%) and 31.0 (31%),
  // corroborated by the same response's limits[].percent field. The
  // pre-fix code multiplied by 100, reporting 100% and clamping the 31%
  // case to 100% too — every non-trivial usage value read as "fully used."
  assert.equal(toPercent(1), 1);
  assert.equal(toPercent(31), 31);
});

test("toPercent: 100% utilization reports 100", () => {
  assert.equal(toPercent(100), 100);
});

test("toPercent: clamps over-100 values to 100", () => {
  assert.equal(toPercent(150), 100);
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
// parseAnthropicResponse
// ---------------------------------------------------------------------------

test("parseAnthropicResponse: empty body produces zero windows", () => {
  assert.deepEqual(parseAnthropicResponse({}), []);
});

test("parseAnthropicResponse: builds windows for every present field", () => {
  // utilization is a whole percentage already (50 means 50%), not a 0..1
  // fraction — see the 2026-08-03 regression note at the top of this file.
  const out = parseAnthropicResponse({
    five_hour: { utilization: 50, resets_at: "2026-05-21T12:00:00Z" },
    seven_day: { utilization: 25, resets_at: null },
    seven_day_sonnet: { utilization: 10, resets_at: null },
    seven_day_opus: { utilization: 90, resets_at: null },
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

test("parseAnthropicResponse: low utilization stays low (regression: 2026-08-03)", () => {
  const out = parseAnthropicResponse({
    five_hour: { utilization: 1, resets_at: null },
  });
  assert.equal(out[0].usedPercent, 1);
});

test("parseAnthropicResponse: 100% utilization round-trips to 100", () => {
  const out = parseAnthropicResponse({
    five_hour: { utilization: 100, resets_at: null },
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
      utilization: 24.68,
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

test("friendlyErrorMessage: catches ENOENT and EACCES (regression: LAC-2503)", () => {
  const expected = "Claude CLI not accessible — ensure Claude is installed and on your PATH.";
  assert.equal(friendlyErrorMessage(new Error("spawn sh ENOENT")), expected);
  assert.equal(friendlyErrorMessage(new Error("EACCES: permission denied, exec '/usr/bin/claude'")), expected);
});

test("friendlyErrorMessage: catches signal kills (regression: LAC-2503)", () => {
  const expected = "Claude CLI command failed — ensure Claude is installed and your network is available.";
  assert.equal(friendlyErrorMessage(new Error("process killed by SIGTERM")), expected);
  assert.equal(friendlyErrorMessage(new Error("child process killed")), expected);
});

test("friendlyErrorMessage: catches leaked shell commands without Command failed: prefix (regression: LAC-2503)", () => {
  const expected = "Claude CLI command failed — ensure Claude is installed and your network is available.";
  assert.equal(
    friendlyErrorMessage(new Error("sh -c (sleep 3; printf '/usage') failed")),
    expected,
  );
  assert.equal(
    friendlyErrorMessage(new Error("script -q /dev/null claude exited with code 1")),
    expected,
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

// ---------------------------------------------------------------------------
// extractAccountEmail (LAC-3028)
// ---------------------------------------------------------------------------

test("extractAccountEmail: reads oauthAccount.emailAddress", () => {
  assert.equal(
    extractAccountEmail({ oauthAccount: { emailAddress: "user@example.com" } }),
    "user@example.com",
  );
});

test("extractAccountEmail: trims surrounding whitespace", () => {
  assert.equal(
    extractAccountEmail({ oauthAccount: { emailAddress: "  user@example.com  " } }),
    "user@example.com",
  );
});

test("extractAccountEmail: null for missing, empty, or malformed shapes", () => {
  assert.equal(extractAccountEmail(null), null);
  assert.equal(extractAccountEmail(undefined), null);
  assert.equal(extractAccountEmail("string"), null);
  assert.equal(extractAccountEmail({}), null);
  assert.equal(extractAccountEmail({ oauthAccount: null }), null);
  assert.equal(extractAccountEmail({ oauthAccount: "not-an-object" }), null);
  assert.equal(extractAccountEmail({ oauthAccount: {} }), null);
  assert.equal(extractAccountEmail({ oauthAccount: { emailAddress: "" } }), null);
  assert.equal(extractAccountEmail({ oauthAccount: { emailAddress: "   " } }), null);
  assert.equal(extractAccountEmail({ oauthAccount: { emailAddress: 42 } }), null);
});
