import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenRef, isRawStringRef } from "./token-ref.ts";

const binding = { type: "secret_ref", secretId: "s1", version: "latest" } as never;
const failing = (message: string) => ({
  resolve: async () => {
    throw new Error(message);
  },
});

describe("resolveTokenRef", () => {
  it("is unset for null, undefined and blank text", async () => {
    const s = failing("must not be called");
    for (const v of [null, undefined, "", "   "]) {
      assert.deepEqual(await resolveTokenRef(s, v), { status: "unset" });
    }
  });

  it("reports raw text without calling the host or echoing it", async () => {
    let called = false;
    const s = { resolve: async () => { called = true; return "x"; } };
    const r = await resolveTokenRef(s, "sk-ant-oat01-SECRET");
    assert.deepEqual(r, { status: "failed", failure: "raw-string" });
    assert.equal(called, false);
    assert.ok(!JSON.stringify(r).includes("SECRET"));
  });

  it("resolves a binding and trims the value", async () => {
    const r = await resolveTokenRef({ resolve: async () => "  tok \n" }, binding);
    assert.deepEqual(r, { status: "ok", token: "tok" });
  });

  it("names unbound, ambiguous and unresolvable", async () => {
    assert.deepEqual(await resolveTokenRef(failing("binding_missing: x"), binding), { status: "failed", failure: "unbound" });
    assert.deepEqual(await resolveTokenRef(failing("binding_ambiguous"), binding), { status: "failed", failure: "ambiguous" });
    assert.deepEqual(await resolveTokenRef(failing("secret not found"), binding), { status: "failed", failure: "unresolvable" });
  });

  it("treats an empty resolved value as unresolvable", async () => {
    assert.deepEqual(await resolveTokenRef({ resolve: async () => "  " }, binding), { status: "failed", failure: "unresolvable" });
  });

  it("never carries the error text into the result", async () => {
    const r = await resolveTokenRef(failing("boom sk-ant-LEAK"), binding);
    assert.ok(!JSON.stringify(r).includes("LEAK"));
  });
});

describe("isRawStringRef", () => {
  it("flags non-blank strings only", () => {
    assert.equal(isRawStringRef("abc"), true);
    assert.equal(isRawStringRef(" "), false);
    assert.equal(isRawStringRef(binding), false);
    assert.equal(isRawStringRef(null), false);
  });
});
