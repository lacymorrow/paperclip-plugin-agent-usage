import type { ShipConfig } from "@lacymorrow/shipx";

export default {
  steps: {
    npm: true,
    githubRelease: true,
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
      pattern: /PLUGIN_VERSION = "[^"]+"/,
      replacement: (v: string) => `PLUGIN_VERSION = "${v}"`,
    },
  ],
} satisfies ShipConfig;
