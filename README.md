<div align="center">
  <a href="https://github.com/lacymorrow/paperclip-plugin-agent-usage">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lacymorrow/paperclip-plugin-agent-usage/main/.github/assets/logo-horizontal-dark.svg">
      <img src="https://raw.githubusercontent.com/lacymorrow/paperclip-plugin-agent-usage/main/.github/assets/logo-horizontal.svg" alt="paperclip-plugin-agent-usage" width="480">
    </picture>
  </a>

  <p><strong>Track AI provider usage quotas in <a href="https://docs.paperclip.ing">Paperclip</a></strong> ➔ dashboard widget, usage page, and agent tools.</p>

  <p>
    <a href="https://www.npmjs.com/package/paperclip-plugin-agent-usage"><img alt="npm version" src="https://img.shields.io/npm/v/paperclip-plugin-agent-usage?style=flat"></a>
    <a href="https://www.npmjs.com/package/paperclip-plugin-agent-usage"><img alt="npm downloads" src="https://img.shields.io/npm/dm/paperclip-plugin-agent-usage?style=flat"></a>
    <a href="https://github.com/lacymorrow/paperclip-plugin-agent-usage/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/lacymorrow/paperclip-plugin-agent-usage/ci.yml?style=flat&label=CI"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/paperclip-plugin-agent-usage?style=flat"></a>
    <a href="https://docs.paperclip.ing"><img alt="Paperclip" src="https://img.shields.io/badge/Paperclip-plugin-db2777?style=flat"></a>
  </p>

  <img src="screenshots/dashboard-widget.png" alt="Dashboard widget showing Claude usage bars" width="700">
</div>

---

A [Paperclip](https://docs.paperclip.ing) plugin that tracks AI provider usage quotas and exposes real-time data to your agents and the dashboard. Agents can check remaining capacity *before* committing to an expensive call.

## Features

- **Dashboard widget** — current Claude usage (session, weekly, per-model) with color-coded bars
- **Full usage page** — detailed view with usage history
- **Agent tools** — `get-usage` and `get-usage-summary` so agents can self-throttle
- **Scheduled polling** — fetches usage every 15 minutes (configurable)
- **Auto-detection** — reads Claude OAuth tokens from `~/.claude` or the macOS Keychain
- **Reset times** — see when each quota window rolls over

## Supported providers

| Provider | Method |
|---|---|
| **Claude** (Anthropic) | OAuth usage API · CLI fallback |

More providers planned. Adding one? See [CONTRIBUTING](.github/CONTRIBUTING.md).

## Install

Install through your Paperclip instance's Plugin Manager UI, or via the REST API:

```http
# From npm
POST /api/plugins/install
Content-Type: application/json

{ "packageName": "paperclip-plugin-agent-usage" }
```

```http
# From a local path (development)
POST /api/plugins/install
Content-Type: application/json

{ "packageName": "/path/to/paperclip-plugin-agent-usage", "isLocalPath": true }
```

## Screenshots

### Detailed usage page

Per-model quota bars, reset times, and historical usage.

![Usage page](screenshots/agent-usage-page-loaded.png)

### Color-coded bars

Bars shift green → purple → red as usage approaches limits, so you spot trouble at a glance.

![Color-coded quota bars](screenshots/usage-colors.png)

### Plugin settings

Auto-detects your Claude OAuth credentials and shows current connection status.

![Plugin settings](screenshots/agent-usage-settings-connected.png)

## Configuration

| Field | Description | Default |
|---|---|---|
| `pollIntervalMinutes` | How often to refresh usage data | `15` |
| `providers` | Which providers to track | `["claude"]` |

OAuth credentials are auto-detected from your local Claude install (`~/.claude` or macOS Keychain). Token lifecycle is managed by Paperclip.

## Agent tools

### `get-usage`

Returns raw quota data (JSON) for a provider. Use this when an agent needs to decide whether to proceed with an expensive operation — call it first, branch on the result.

### `get-usage-summary`

Returns a human-readable summary of remaining capacity across all configured providers, including reset times. Good for narrative responses ("you have 47% of your weekly quota left, resetting in 2 days").

## Development

```bash
npm install
npm run dev          # esbuild watch
npm run build        # bundle to dist/
npm run typecheck
```

Releases are managed by [shipx](https://github.com/lacymorrow/shipx):

```bash
npm run release           # interactive
npm run release:beta      # pre-release with --tag beta
```

## Related

- [Paperclip](https://docs.paperclip.ing) — the AI agent platform this plugin extends.
- Other projects by the author: [shipx](https://github.com/lacymorrow/shipx).

## License

[MIT](./LICENSE) © [Lacy Morrow](https://lacymorrow.com)

<div align="center">
  <sub>If this saved your agent some quota, consider <a href="https://github.com/sponsors/lacymorrow">sponsoring on GitHub</a>, <a href="https://patreon.com/lacymorrow">supporting on Patreon</a>, or <a href="https://buymeacoffee.com/lm">buying a coffee</a>.</sub>
</div>
