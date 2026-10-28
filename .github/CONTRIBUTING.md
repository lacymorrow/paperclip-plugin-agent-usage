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
3. Update the `Supported providers` section of the README.

## Releasing

Releasing is the version bump. CI publishes to npm whenever the `version` in
`package.json` lands on `main` and is not already on the registry, so there is
no publish command to run and no step to forget.

1. Open a PR that raises `version` in `package.json` and `PLUGIN_VERSION` in
   `src/constants.ts` to the same value, and move the `[Unreleased]` changelog
   entries under the new version heading.
2. Merge it.

`.github/workflows/release.yml` then runs typecheck, tests and the build,
publishes with npm provenance, tags `v<version>` and cuts a GitHub release. If
the version in `package.json` is already published the workflow exits as a
no-op, which is what every other merge does.

[shipx](https://github.com/lacymorrow/shipx) can do step 1 for you
(`npm run release`); it bumps both files and writes the commit, and its publish
and GitHub-release steps are off so it cannot race CI.

## Code of conduct

Be kind.
