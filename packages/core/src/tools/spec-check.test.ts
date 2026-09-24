import { describe, expect, it } from "vitest"
import { resolveProfile } from "../model/profiles.js"
import { fakeDecisionsFetch } from "../testkit/fake-model.js"
import { useTempDirs } from "../testkit/tmp.js"
import { createContext } from "./context.js"
import { runSpecCheck } from "./spec-check.js"

const temp = useTempDirs()
const CONSENT = "egress:\n  consent: { granted: true }\n"

const SPEC = `description: Does the text handle authentication?
questions:
  relevant: { type: noul, instructions: The text handles authentication. }
  kind:
    type: choice
    instructions: What the text mostly is.
    criteria: { auth: Authentication code., other: Anything else. }
  risk:
    type: score
    instructions: How risky a mistake here is.
    criteria: [Harmless., Annoying., Dangerous.]
examples:
  - { id: login, state: "auth login flow", expect: { relevant: true, kind: auth, risk: 2 } }
  - { id: helper, state: "string helper", expect: { relevant: false, risk: [0, 1] } }
  - { id: filter, state: "auth token", expect: { relevant: ">=0.9" } }
  - { id: borderline, state: "maybe", expect: { relevant: undecided } }
  - { id: wrong, state: "string helper", expect: { kind: auth } }
  - { id: flat, state: "maybe", expect: { kind: other } }
  - { id: look, state: "auth" }
  - { id: file, file: src/auth.ts, expect: { relevant: true } }
`

function rig(spec = SPEC, { consent = true, key = true } = {}) {
  const cwd = temp({
    ...(consent ? { ".system1/config.yaml": CONSENT } : {}),
    ".system1/specs/authy.yaml": spec,
    "src/auth.ts": "export const auth = () => {}",
  })
  const model = fakeDecisionsFetch()
  const make = (withKey: boolean) =>
    createContext({
      cwd,
      home: temp(),
      env: withKey ? { OPENROUTER_API_KEY: "k" } : {},
      fetch: model.fetch,
    })
  return { cwd, model, ctx: make(key), offline: () => make(false) }
}

describe("spec check", () => {
  it("records live, then replays offline with identical verdicts", async () => {
    const { ctx, model, offline } = rig()
    const live = await runSpecCheck(ctx, { spec: "authy", mode: "record" })
    expect(model.calls).toBe(8)
    expect(live.source).toBe("live")
    const status = Object.fromEntries(live.examples.map((e) => [e.id, e.status]))
    expect(status).toEqual({
      login: "pass",
      helper: "pass",
      filter: "pass",
      borderline: "pass",
      wrong: "fail",
      flat: "undecided",
      look: "captured",
      file: "pass",
    })
    expect(live.passed).toBe(false)
    expect(live.counts).toMatchObject({ examples: 8, pass: 5, fail: 1, undecided: 1, captured: 1 })
    expect(live.examples.find((e) => e.id === "wrong")?.failures).toEqual([
      { question: "kind", expected: "auth" },
    ])
    // Full answers ride along, distributions included.
    expect(live.examples[0]?.answers?.kind).toMatchObject({ type: "choice", probabilities: {} })

    const replay = await runSpecCheck(offline(), { spec: "authy" })
    expect(model.calls).toBe(8)
    expect(replay.source).toBe("replay")
    expect(replay.examples.map((e) => e.status)).toEqual(live.examples.map((e) => e.status))
    expect(replay.usage.cost).toBe(0)
  })

  it("passes when every expectation is met", async () => {
    const spec = SPEC.split("  - { id: wrong")[0] as string
    const { ctx } = rig(spec)
    const r = await runSpecCheck(ctx, { spec: "authy", mode: "record" })
    expect(r.passed).toBe(true)
  })

  it("a replay miss is a typed error that names the fix", async () => {
    const { offline } = rig()
    await expect(runSpecCheck(offline(), { spec: "authy" })).rejects.toMatchObject({
      code: "replay-miss",
      message: expect.stringContaining("decide spec check authy --live"),
    })
  })

  it("refuses a spec with no examples", async () => {
    const { ctx } = rig("description: x\nquestions:\n  a: { type: noul, instructions: A. }\n")
    await expect(runSpecCheck(ctx, { spec: "authy" })).rejects.toMatchObject({
      code: "invalid-request",
      message: expect.stringContaining("no examples"),
    })
  })

  it("needs consent before a live run, and makes no call without it", async () => {
    const { ctx, model } = rig(SPEC, { consent: false })
    await expect(runSpecCheck(ctx, { spec: "authy", mode: "record" })).rejects.toMatchObject({
      code: "egress-refused",
    })
    expect(model.calls).toBe(0)
  })

  it("projects a live check with the per-call overhead counted once per example", async () => {
    const cwd = temp({
      ".system1/config.yaml": `${CONSENT}budget:\n  maxCalls: 1\n`,
      ".system1/specs/authy.yaml": SPEC,
      "src/auth.ts": "export const auth = () => {}",
    })
    const model = fakeDecisionsFetch()
    const ctx = createContext({
      cwd,
      home: temp(),
      env: { OPENROUTER_API_KEY: "k" },
      fetch: model.fetch,
    })
    const error = await runSpecCheck(ctx, { spec: "authy", mode: "record" }).catch((e) => e)
    expect(error).toMatchObject({ code: "budget-exceeded" })
    expect(model.calls).toBe(0)
    const { projection } = error.details
    const overhead = resolveProfile("typesafe/jev-1.13").callOverheadTokens
    expect(projection.calls).toBe(8)
    // Each example is a short state plus this spec's questions, well under one
    // overhead's worth of tokens. Counting the overhead twice would pass 2×.
    expect(projection.estimatedInputTokens / projection.calls).toBeGreaterThan(overhead)
    expect(projection.estimatedInputTokens / projection.calls).toBeLessThan(2 * overhead)
  })

  it("reports an excluded example file as withheld, never sent", async () => {
    const spec = `description: x
questions:
  a: { type: noul, instructions: A. }
examples:
  - { id: env, file: .env, expect: { a: true } }
`
    const { ctx, model, cwd } = rig(spec)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(`${cwd}/.env`, "SECRET=x")
    const r = await runSpecCheck(ctx, { spec: "authy", mode: "record" })
    expect(model.calls).toBe(0)
    expect(r.examples[0]).toMatchObject({ id: "env", status: "withheld" })
    expect(r.passed).toBe(false)
  })

  it("withholds an example whose file is outside the repo or too large, and still checks the rest", async () => {
    const spec = `description: x
questions:
  a: { type: noul, instructions: A. }
examples:
  - { id: outside, file: "../../../../etc/hostname", expect: { a: true } }
  - { id: huge, file: big.txt, expect: { a: true } }
  - { id: fine, state: "auth", expect: { a: true } }
  - { id: row, state: { text: "auth row" }, expect: { a: true } }
`
    const { ctx, model, cwd } = rig(spec)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(`${cwd}/big.txt`, "x ".repeat(80_000))
    const r = await runSpecCheck(ctx, { spec: "authy", mode: "record" })
    expect(model.calls).toBe(2)
    expect(Object.fromEntries(r.examples.map((e) => [e.id, e.status]))).toEqual({
      outside: "withheld",
      huge: "withheld",
      fine: "pass",
      row: "pass",
    })
    expect(r.examples[0]?.reason).toContain("outside the repo")
    expect(r.examples[1]?.reason).toMatch(/tokens/)
  })

  it("reports a filter expectation as written", async () => {
    const spec = `description: x
questions:
  a: { type: noul, instructions: A. }
examples:
  - { id: e, state: "plain", expect: { a: ">=0.9" } }
`
    const { ctx } = rig(spec)
    const r = await runSpecCheck(ctx, { spec: "authy", mode: "record" })
    expect(r.examples[0]?.failures).toEqual([{ question: "a", expected: ">=0.9" }])
  })
})
