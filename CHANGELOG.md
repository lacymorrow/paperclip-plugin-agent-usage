# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Signed-in account email shown in the dashboard widget, usage page, settings page, and agent usage summary, so multi-account users can tell which account the quota belongs to (LAC-3028).
- `claudeOAuthTokenRef` config field — a Claude OAuth token stored as a Paperclip secret, resolved via `ctx.secrets`. Needed because Paperclip's plugin worker processes deliberately don't inherit the host's environment (a security boundary against leaking unrelated host secrets), so a `CLAUDE_CODE_OAUTH_TOKEN` set on the Paperclip host/container itself is invisible to the plugin. Checked before the environment variable and the local credentials file/Keychain.

- Centered README hero, logo (pink quota-bars on rounded square), 5 modern badges.
- `.github/` community files: FUNDING, dependabot, ISSUE_TEMPLATE, PR template, SECURITY, CONTRIBUTING.
- CI typecheck + build workflow on Node 18/20/22.
- Branded 1280×640 social preview banner.
- CodeQL security scanning + Dependabot auto-merge workflow.

### Changed

- Install code blocks switched from `bash` to `http` fence (matches the pseudo-HTTP REST shape).
- PR template + CONTRIBUTING aligned with actual `npm run typecheck` / `npm run build` workflow.
- npm keywords expanded (paperclip-plugin, ai, ai-agent, agent, quota, usage, tracking, oauth).
- Removed the plugin's custom settings page. It was display-only (status text, no editable fields), and declaring a custom `settingsPage` slot suppresses Paperclip's own auto-generated config form — the only thing that renders a working secret picker for `claudeOAuthTokenRef`. There was previously no way to edit any setting through this plugin's UI. Status/account/source remain visible on the main **Agent Usage** page and dashboard widget.

## [0.1.4] and earlier

For pre-0.1.4 history, see [`git log`](https://github.com/lacymorrow/paperclip-plugin-agent-usage/commits/main).

[Unreleased]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/compare/v0.1.4...HEAD
