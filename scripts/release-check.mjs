// Decides whether package.json's version still needs publishing, from the
// result of `npm view <name> versions --json`. Kept out of the workflow YAML so
// it can be tested with `node --test`.
//
// CLI: node scripts/release-check.mjs <name> <version> <npm-exit-code> <stdout-file> <stderr-file>
// Prints `unpublished=true|false` on success. Exits 1 when the registry answer
// cannot be trusted, so a registry blip never sends a released version back to
// `npm publish`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function checkRelease({ name, version, exitCode, stdout = "", stderr = "" }) {
  let versions;
  if (exitCode === 0) {
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`Could not parse npm view output for ${name}; refusing to guess.`);
    }
    // npm prints a bare string when exactly one version is published.
    versions = typeof parsed === "string" ? [parsed] : parsed;
    if (!Array.isArray(versions)) {
      throw new Error(`Unexpected npm view output for ${name}; refusing to guess.`);
    }
  } else if (/E404/.test(stderr)) {
    // Only a real 404 means "never published".
    versions = [];
  } else {
    throw new Error(`Could not read ${name} from the registry; refusing to guess.\n${stderr}`);
  }
  return { unpublished: !versions.includes(version) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, version, exitCode, stdoutFile, stderrFile] = process.argv.slice(2);
  try {
    const { unpublished } = checkRelease({
      name,
      version,
      exitCode: Number(exitCode),
      stdout: readFileSync(stdoutFile, "utf8"),
      stderr: readFileSync(stderrFile, "utf8"),
    });
    console.log(`unpublished=${unpublished}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
