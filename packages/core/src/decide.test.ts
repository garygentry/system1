import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createDecider } from "./decide.js"
import { FixtureStore } from "./fixtures/store.js"
import { resolveProfile } from "./model/profiles.js"
import { parseDecisionResponse } from "./model/validate.js"
import { SpendLedger } from "./run/spend.js"
import { guardrailQuestions, guardrailResponse } from "./testdata/index.js"
import type { Transport } from "./transport/openrouter.js"
import { createDeciderFromEnv } from "./wiring.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "decisions-decide-"))
  dirs.push(dir)
  return dir
}

const profile = resolveProfile("typesafe/jev-1.13")
const questions = guardrailQuestions()
const state = { command: "ls -la src/" }

/** A transport that answers with the real recorded response and counts calls. */
function fakeTransport() {
  const calls: unknown[] = []
  const transport: Transport = {
    async decide(request) {
      calls.push(request)
      return {
        response: parseDecisionResponse(guardrailResponse(), request.questions, request.model),
        latencyMs: 250,
        attempts: 1,
      }
    },
  }
  return { transport, calls }
}

function rig(mode?: "auto" | "live" | "record" | "replay", withKey = true, consent = true) {
  const dir = tempDir()
  const fixtures = new FixtureStore(join(dir, "fixtures"))
  const ledger = new SpendLedger(join(dir, "usage.jsonl"))
  const fake = fakeTransport()
  const decider = createDecider({
    profile,
    egressConsent: consent,
    ...(withKey ? { transport: fake.transport } : {}),
    fixtures,
    ledger,
    ...(mode ? { mode } : {}),
    session: "s1",
  })
  return { decider, fixtures, ledger, ...fake }
}

describe("createDecider", () => {
  it("auto goes live with a key and replays without one", () => {
    expect(rig("auto", true).decider.mode).toBe("live")
    expect(rig("auto", false).decider.mode).toBe("replay")
  })

  it("refuses live and record without a key, as no-key", () => {
    expect(() => rig("live", false)).toThrow(expect.objectContaining({ code: "no-key" }))
    expect(() => rig("record", false)).toThrow(expect.objectContaining({ code: "no-key" }))
  })

  it("live: returns measured usage, flags undecided, and logs spend", async () => {
    const { decider, ledger, calls } = rig("live")
    const result = await decider.decide({ state, questions })
    expect(result).toMatchObject({
      source: "live",
      servedBy: "typesafe/jev-1.13-20260917",
      latencyMs: 250,
    })
    expect(result.usage.cost).toBeCloseTo(2.877e-5)
    expect(result.undecided).toEqual([])
    expect(calls).toHaveLength(1)
    expect(ledger.summary({ session: "s1" })).toMatchObject({ liveCalls: 1, input_tokens: 685 })
  })

  it("record then replay returns the same answers, labelled replay, at zero cost", async () => {
    const recorder = rig("record")
    const live = await recorder.decider.decide({ state, questions, namespace: "guardrail" })
    expect(live.recordedAt).toBeDefined()

    const replayer = createDecider({
      profile,
      egressConsent: false,
      fixtures: recorder.fixtures,
      ledger: recorder.ledger,
      mode: "replay",
    })
    const replayed = await replayer.decide({ state, questions, namespace: "guardrail" })
    expect(replayed.source).toBe("replay")
    expect(replayed.answers).toEqual(live.answers)
    expect(replayed.usage.cost).toBe(0)
    expect(replayed.fixtureKey).toBe(live.fixtureKey)
    expect(recorder.ledger.summary()).toMatchObject({ liveCalls: 1, replayCalls: 1 })
  })

  it("refuses a live call without egress consent, before any network call", async () => {
    const { decider, calls } = rig("live", true, false)
    await expect(decider.decide({ state, questions })).rejects.toMatchObject({
      code: "egress-refused",
    })
    expect(calls).toHaveLength(0)
  })

  it("replays without consent: nothing leaves the machine", async () => {
    const recorder = rig("record")
    await recorder.decider.decide({ state, questions })
    const replayer = createDecider({
      profile,
      egressConsent: false,
      fixtures: recorder.fixtures,
      mode: "replay",
    })
    await expect(replayer.decide({ state, questions })).resolves.toMatchObject({ source: "replay" })
  })

  it("replay miss is a typed error, never an invented answer", async () => {
    const { decider, calls } = rig("replay")
    await expect(decider.decide({ state, questions })).rejects.toMatchObject({
      code: "replay-miss",
      message: expect.stringMatching(/^No recorded answer .*without --replay/),
    })
    expect(calls).toHaveLength(0)
  })

  it("leads a replay miss with the missing key when there is none", async () => {
    const { decider } = rig("auto", false)
    await expect(decider.decide({ state, questions })).rejects.toMatchObject({
      code: "replay-miss",
      message: expect.stringMatching(/^No API key is set.*Set OPENROUTER_API_KEY/),
    })
  })

  it("validates the question set before spending anything", async () => {
    const { decider, calls } = rig("live")
    await expect(
      decider.decide({
        state,
        questions: { q: { type: "choice", instructions: "x", criteria: {} } },
      }),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(calls).toHaveLength(0)
  })
})

describe("createDeciderFromEnv", () => {
  it("replays when SYSTEM1_REPLAY is set even with a key", () => {
    const decider = createDeciderFromEnv({
      cwd: tempDir(),
      home: tempDir(),
      env: { OPENROUTER_API_KEY: "k", SYSTEM1_REPLAY: "1" },
    })
    expect(decider.mode).toBe("replay")
  })

  it("goes live with a key and replays without one", () => {
    expect(
      createDeciderFromEnv({ cwd: tempDir(), home: tempDir(), env: { OPENROUTER_API_KEY: "k" } })
        .mode,
    ).toBe("live")
    expect(createDeciderFromEnv({ cwd: tempDir(), home: tempDir(), env: {} }).mode).toBe("replay")
  })

  it("refuses an unknown model", () => {
    expect(() =>
      createDeciderFromEnv({
        cwd: tempDir(),
        home: tempDir(),
        env: { SYSTEM1_MODEL: "nope/nope" },
      }),
    ).toThrow(expect.objectContaining({ code: "unknown-model" }))
  })

  it("scrubs the question set and the state at the boundary, whoever calls it", async () => {
    const sent: unknown[] = []
    const decider = createDecider({
      profile: resolveProfile("typesafe/jev-1.13"),
      egressConsent: true,
      mode: "live",
      transport: {
        async decide(request) {
          sent.push(request)
          return {
            response: {
              model: "typesafe/jev-1.13",
              answers: { q: { type: "noul", noul: 0.9 } },
              usage: { input_tokens: 1, output_tokens: 0, cost: 0 },
            },
            latencyMs: 1,
            attempts: 1,
          }
        },
      },
    })
    await decider.decide({
      state: "token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      questions: {
        q: {
          type: "noul",
          instructions: "Does it mention ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB?",
        },
      },
    })
    const request = sent[0] as { state: string; questions: { q: { instructions: string } } }
    expect(request.state).toContain("[REDACTED:github-token]")
    expect(request.questions.q.instructions).toContain("[REDACTED:github-token]")
  })
})
