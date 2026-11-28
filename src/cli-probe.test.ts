import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { killActiveProbes, runProbeShell } from "./cli-probe.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
const fake = path.join(dir, "fake-claude");
// Like a stuck CLI: shrugs off hangup, interrupt and terminate. A node script
// because macOS hides the environment of system binaries such as /bin/sh.
writeFileSync(fake, `#!${process.execPath}
for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {});
console.log("ready");
setInterval(() => {}, 1000);
`);
chmodSync(fake, 0o755);

// The same wrapper the worker uses: `script` puts its command in a new session.
const underScript = process.platform === "darwin"
  ? `sleep 20 | script -q /dev/null ${fake}`
  : `sleep 20 | script -q -e -f -c ${fake} /dev/null`;

const env = process.env as Record<string, string>;
const options = { env, timeoutMs: 1500, killGraceMs: 300 };

function survivors(): string[] {
  return execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(dir));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

describe("runProbeShell", () => {
  after(() => {
    for (const line of survivors()) {
      try {
        process.kill(Number.parseInt(line, 10), "SIGKILL");
      } catch {
        // already gone
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves nothing running after a timeout, including the retry", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await runProbeShell(underScript, options);
      assert.equal(result.ok, false);
      assert.match(result.stdout, /ready/);
      await settle();
      assert.deepEqual(survivors(), []);
    }
  });

  it("kills a detached process left behind when the shell exits", async () => {
    const spawnDetached = `require("child_process").spawn(${JSON.stringify(fake)},{detached:true,stdio:"ignore"}).unref()`;
    const result = await runProbeShell(`'${process.execPath}' -e '${spawnDetached}'; echo done`, {
      ...options,
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.match(result.stdout, /done/);
    await settle();
    assert.deepEqual(survivors(), []);
  });

  it("kills an in-flight probe on worker shutdown", async () => {
    const running = runProbeShell(underScript, { ...options, timeoutMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.notDeepEqual(survivors(), []);
    killActiveProbes();
    assert.equal((await running).ok, false);
    await settle();
    assert.deepEqual(survivors(), []);
  });
});
