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
} satisfies ShipConfig;
