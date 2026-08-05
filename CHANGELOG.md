# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Signed-in account email shown in the dashboard widget, usage page, settings page, and agent usage summary, so multi-account users can tell which account the quota belongs to (LAC-3028).

- Centered README hero, logo (pink quota-bars on rounded square), 5 modern badges.
- `.github/` community files: FUNDING, dependabot, ISSUE_TEMPLATE, PR template, SECURITY, CONTRIBUTING.
- CI typecheck + build workflow on Node 18/20/22.
- Branded 1280×640 social preview banner.
- CodeQL security scanning + Dependabot auto-merge workflow.

### Changed

- Install code blocks switched from `bash` to `http` fence (matches the pseudo-HTTP REST shape).
- PR template + CONTRIBUTING aligned with actual `npm run typecheck` / `npm run build` workflow.
- npm keywords expanded (paperclip-plugin, ai, ai-agent, agent, quota, usage, tracking, oauth).
- `worker.ts` now imports its parsing/formatting helpers from `parsing.ts` instead of maintaining a second, drifting copy of each.

### Fixed

- `toPercent` was multiplying `utilization` by 100, assuming a 0..1 fraction. The Anthropic OAuth usage API actually returns it as a whole percentage already, so any real (non-zero) usage was clamping straight to 100%.

## [0.1.4] and earlier

For pre-0.1.4 history, see [`git log`](https://github.com/lacymorrow/paperclip-plugin-agent-usage/commits/main).

[Unreleased]: https://github.com/lacymorrow/paperclip-plugin-agent-usage/compare/v0.1.4...HEAD
