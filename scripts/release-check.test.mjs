import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "./release-check.mjs";

const base = { name: "pkg", version: "0.1.5" };
// Real stderr shape from npm 11.20.0 / 12.2.2 for a never-published name.
const e404 = "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/pkg - Not found\n";

test("E404 means unpublished", () => {
  assert.deepEqual(checkRelease({ ...base, exitCode: 1, stderr: e404 }), { unpublished: true });
});

test("other npm errors throw", () => {
  assert.throws(
    () => checkRelease({ ...base, exitCode: 1, stderr: "npm error code ETIMEDOUT\n" }),
    /refusing to guess/,
  );
});

test("version present means published", () => {
  const stdout = JSON.stringify(["0.1.3", "0.1.5"]);
  assert.deepEqual(checkRelease({ ...base, exitCode: 0, stdout }), { unpublished: false });
});

test("version absent means unpublished", () => {
  const stdout = JSON.stringify(["0.1.3"]);
  assert.deepEqual(checkRelease({ ...base, exitCode: 0, stdout }), { unpublished: true });
});

test("single published version arrives as a bare string", () => {
  assert.deepEqual(checkRelease({ ...base, exitCode: 0, stdout: '"0.1.5"' }), { unpublished: false });
  assert.deepEqual(checkRelease({ ...base, exitCode: 0, stdout: '"0.1.3"' }), { unpublished: true });
});

test("unparseable success output throws", () => {
  assert.throws(() => checkRelease({ ...base, exitCode: 0, stdout: "" }), /refusing to guess/);
});
