// Resolution of the operator-configured Claude OAuth token secret ref.
//
// The host's `secrets.resolve` only accepts a structured
// `{ type: "secret_ref", secretId, version }` binding, which is what the config
// form's secret picker produces. A bare string is refused outright. So a string
// here means the operator pasted a token into the field instead of using the
// picker, and the old behaviour (swallow, fall through to an env var the
// sandboxed worker cannot see) left them with no token and no message.
//
// This module never returns, logs, or throws anything derived from the ref's
// contents or the resolved value: only a failure kind.

import type { EnvSecretRefBinding } from "@paperclipai/plugin-sdk";

export type TokenRefFailure = "raw-string" | "unbound" | "ambiguous" | "unresolvable";

export type TokenRefResult =
  | { status: "unset" }
  | { status: "ok"; token: string }
  | { status: "failed"; failure: TokenRefFailure };

export type TokenRefValue = string | EnvSecretRefBinding | null | undefined;

export const TOKEN_REF_FAILURE_MESSAGES: Record<TokenRefFailure, string> = {
  "raw-string":
    "Claude OAuth Token holds pasted text, not a secret. Re-select it with the secret picker; pasted tokens are not resolved.",
  unbound:
    "Claude OAuth Token secret is not bound to this plugin. Re-select it in the plugin settings.",
  ambiguous:
    "Claude OAuth Token secret binding is ambiguous. Re-select it in the plugin settings.",
  unresolvable:
    "Claude OAuth Token secret could not be resolved (deleted, revoked, or empty). Re-select it in the plugin settings.",
};

function classify(err: unknown): TokenRefFailure {
  const text =
    typeof err === "object" && err !== null
      ? `${String((err as { code?: unknown }).code ?? "")} ${String((err as { message?: unknown }).message ?? "")}`
      : String(err);
  if (text.includes("binding_missing")) return "unbound";
  if (text.includes("binding_ambiguous")) return "ambiguous";
  return "unresolvable";
}

/** Whether a config value is the raw-string shape (non-empty text). */
export function isRawStringRef(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function resolveTokenRef(
  secrets: { resolve(ref: string | EnvSecretRefBinding): Promise<string> },
  ref: TokenRefValue,
): Promise<TokenRefResult> {
  if (ref === null || ref === undefined) return { status: "unset" };
  if (typeof ref === "string") {
    // Empty text is an unset field. Non-empty text is a pasted token (or a
    // mistyped ref): the host would throw, so do not hand it over at all.
    return ref.trim().length === 0
      ? { status: "unset" }
      : { status: "failed", failure: "raw-string" };
  }
  try {
    const resolved = await secrets.resolve(ref);
    if (typeof resolved === "string" && resolved.trim().length > 0) {
      return { status: "ok", token: resolved.trim() };
    }
    return { status: "failed", failure: "unresolvable" };
  } catch (err) {
    return { status: "failed", failure: classify(err) };
  }
}
