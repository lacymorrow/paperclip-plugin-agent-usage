import type { ShipConfig } from "@lacymorrow/shipx";

export default {
  // Bump only. `.github/workflows/release.yml` publishes to npm and cuts the
  // GitHub release when a version bump lands on main, so shipx must not also
  // do it from a laptop.
  steps: {
    npm: false,
    githubRelease: false,
    homebrew: false,
  },
  git: {
    releaseBranch: "main",
    tagPrefix: "v",
    commitMessage: "release: {tag}",
  },
  npm: {
    access: "public",
  },
  bumpFiles: [
    {
      path: "src/constants.ts",
      pattern: /PLUGIN_VERSION\s*=\s*["'][^"']+["']/,
      replacement: (v: string) => `PLUGIN_VERSION = "${v}"`,
    },
  ],
} satisfies ShipConfig;
