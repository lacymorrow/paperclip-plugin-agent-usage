# Security Policy

## Reporting a vulnerability

This plugin reads OAuth credentials (from `~/.claude` and macOS Keychain) and exposes usage data to agents. The security-relevant surfaces are:

- Credential handling (token reads, refresh, lifecycle)
- The `get-usage` / `get-usage-summary` agent tool boundaries
- Network egress to Anthropic's usage API

If you've found a security issue, please report it privately:

➔ https://github.com/lacymorrow/paperclip-plugin-agent-usage/security/advisories/new

Or email **lacy@lacymorrow.com** with `[paperclip-plugin-agent-usage security]` in the subject.

Expect an acknowledgement within 72 hours.

## Supported versions

Only the latest published version on npm receives security updates.

## Scope

In scope:
- The published `paperclip-plugin-agent-usage` npm package

Out of scope:
- Vulnerabilities in [Paperclip](https://docs.paperclip.ing) itself
- Vulnerabilities in Anthropic's API
