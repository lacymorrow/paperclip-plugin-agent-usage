# Contributing to paperclip-plugin-agent-usage

Thanks for considering a contribution!

## Setup

```bash
git clone https://github.com/lacymorrow/paperclip-plugin-agent-usage.git
cd paperclip-plugin-agent-usage
npm install
```

## Develop

```bash
npm run dev          # esbuild watch
npm run build        # esbuild bundle → dist/
npm run typecheck    # tsc --noEmit
```

## Conventions

- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`).
- Keep PRs focused; one logical change per PR.
- The public surface is the Paperclip plugin manifest (`dist/manifest.js`) plus the `get-usage` / `get-usage-summary` agent tools. Renaming or removing a tool is a major version bump.

## Adding a new provider

This package currently supports Claude. To add another:

1. Implement the provider in `src/providers/<name>.ts` with the shared interface.
2. Wire it up in `src/manifest.ts`.
3. Update the `Supported Providers` section of the README.

## Releasing

This package uses [shipx](https://github.com/lacymorrow/shipx) for releases:

```bash
npm run release           # interactive
npm run release:beta      # pre-release
```

## Code of conduct

Be kind.
