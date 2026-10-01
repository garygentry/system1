import { describe, expect, expectTypeOf, it } from "vitest"
import type { PolicyRequest, PolicyResult, PolicyRuntime, PolicyRuntimeOptions } from "./index.js"
import * as runtime from "./index.js"

/**
 * The `./runtime` surface is committed under semver (0020): adopted code
 * imports it by an exact version. A change to this list is a change to that
 * promise. Adding an export is a minor change; removing or renaming one needs
 * a decision record.
 */
describe("@garygentry/system1-core/runtime", () => {
  it("exports exactly the committed surface", () => {
    expect(Object.keys(runtime).sort()).toEqual([
      "REASON_CODES",
      "RUNTIME_TAG",
      "createPolicyRuntime",
      "prepareState",
    ])
  })

  it("keeps the committed type shapes (checked by the typecheck)", () => {
    expectTypeOf<keyof PolicyRuntimeOptions>().toEqualTypeOf<
      | "egress"
      | "module"
      | "maxUsdPerDay"
      | "root"
      | "model"
      | "mode"
      | "apiKey"
      | "timeoutMs"
      | "endpoint"
      | "fetch"
      | "now"
    >()
    expectTypeOf<PolicyRuntimeOptions["egress"]>().toEqualTypeOf<"on" | "off">()
    expectTypeOf<keyof PolicyRequest>().toEqualTypeOf<"questions" | "state" | "namespace">()
    expectTypeOf<keyof Extract<PolicyResult, { ok: true }>>().toEqualTypeOf<
      "ok" | "source" | "answers" | "usage" | "latencyMs" | "ledger"
    >()
    expectTypeOf<keyof Extract<PolicyResult, { ok: false }>>().toEqualTypeOf<
      "ok" | "reason" | "detail" | "answers" | "undecided" | "ledger"
    >()
    expectTypeOf<keyof PolicyRuntime>().toEqualTypeOf<"decide" | "spentToday">()
  })

  it("keeps the reason codes apps count", () => {
    expect(runtime.REASON_CODES).toEqual([
      "egress-off",
      "undecided",
      "provider-error",
      "refused",
      "budget",
      "timeout",
      "no-key",
      "engine-unavailable",
      "internal",
    ])
  })

  it("is published at ./runtime", async () => {
    const { readFileSync } = await import("node:fs")
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    expect(pkg.exports["./runtime"]).toEqual({
      types: "./dist/runtime/index.d.ts",
      default: "./dist/runtime/index.js",
    })
  })
})
