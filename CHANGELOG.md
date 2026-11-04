# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-10-28

0.1.4 was tagged but never published to npm, so this release carries that tag's
changes too. Upgrading from 0.1.3 gets both.

### Added

- Signed-in account email shown in the dashboard widget, usage page, settings page, and agent usage summary, so multi-account users can tell which account the quota belongs to (LAC-3028).
- `claudeOAuthTokenRef` config field — a Claude OAuth token stored as a Paperclip secret, resolved via `ctx.secrets`. Needed because Paperclip's plugin worker processes deliberately don't inherit the host's environment (a security boundary against leaking unrelated host secrets), so a `CLAUDE_CODE_OAUTH_TOKEN` set on the Paperclip host/container itself is invisible to the plugin. Checked before the environment variable and the local credentials file/Keychain. A ref that cannot be used is no longer silent: the failure kind (pasted text, unbound, ambiguous, unresolvable) is logged and shown in the plugin's health panel, and `onValidateConfig` rejects pasted text at save. Originally proposed by @lsimpsonsfdc in [#54].

- Centered README hero, logo (pink quota-bars on rounded square), 5 modern badges.
- `.github/` community files: FUNDING, dependabot, ISSUE_TEMPLATE, PR template, SECURITY, CONTRIBUTING.
- CI typecheck + build workflow on Node 18/20/22.
- Branded 1280×640 social preview banner.
- CodeQL security scanning + Dependabot auto-merge workflow.

### Changed

- Install code blocks switched from `bash` to `http` fence (matches the pseudo-HTTP REST shape).
- PR template + CONTRIBUTING aligned with actual `npm run typecheck` / `npm run build` workflow.
- npm keywords expanded (paperclip-plugin, ai, ai-agent, agent, quota, usage, tracking, oauth).
- Removed the plugin's custom settings page. It was display-only, and declaring a `settingsPage` slot suppresses Paperclip's auto-generated config form, which is the only thing that renders the secret picker for `claudeOAuthTokenRef`. Status, account and token source remain on the **Agent Usage** page and dashboard widget.
- `worker.ts` now imports its parsing/formatting helpers from `parsing.ts` instead of maintaining a second, drifting copy of each.

### Fixed

- The scheduled poll job died on every cycle. Scheduled jobs run with no
  company and current Paperclip hosts refuse an unscoped `config.get` there, so
  every poll since July failed and the widget served a stale snapshot. The job
  now falls back to defaults instead of throwing ([#74]).
- The scheduled poll job ignored operator config. After [#74] it fell back to
  `DEFAULT_CONFIG` every cycle, so `pollIntervalMinutes` and `providers` were
  honored on tool-driven polls and silently dropped on scheduled ones. The job
  now resolves the company through `companies.list` and reads its real config.
  That also stops the host logging an ERROR per refused read; the local
  instance had 3954 of them ([#77]).
- `toPercent` was multiplying `utilization` by 100, assuming a 0..1 fraction. The Anthropic OAuth usage API actually returns it as a whole percentage already, so any real (non-zero) usage was clamping straight to 100%.

## [0.1.3] and earlier

For 0.1.3 and earlier, see [`git log`](https://github.com/lacymorrow/paperclip-plugin-agent-usage/commits/main).

[Unreleased]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/compare/v0.1.3...v0.1.5
[#74]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/pull/74
[#77]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/pull/77
[#54]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/pull/54
