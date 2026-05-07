import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const watch = process.argv.includes("--watch");

const commonNodeOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  sourcemap: true,
  external: [],
};

// Bundle worker
await esbuild.build({
  ...commonNodeOptions,
  entryPoints: [path.join(packageRoot, "src/worker.ts")],
  outfile: path.join(packageRoot, "dist/worker.js"),
  banner: { js: "// paperclip-plugin-agent-usage worker (bundled)" },
  logLevel: "info",
});

// Bundle manifest
await esbuild.build({
  ...commonNodeOptions,
  entryPoints: [path.join(packageRoot, "src/manifest.ts")],
  outfile: path.join(packageRoot, "dist/manifest.js"),
  logLevel: "info",
});

// Bundle UI
const uiBuildOptions = {
  entryPoints: [path.join(packageRoot, "src/ui/index.tsx")],
  outfile: path.join(packageRoot, "dist/ui/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@paperclipai/plugin-sdk/ui",
  ],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(uiBuildOptions);
  await ctx.watch();
  console.log("Watching for UI changes...");
} else {
  await esbuild.build(uiBuildOptions);
}
