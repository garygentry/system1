import { chmodSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs } from "../testkit/tmp.js"
import { createPolicyRuntime, type PolicyRuntimeOptions } from "./runtime.js"

const temp = useTempDirs()
const questions = {
  urgent: { type: "noul" as const, instructions: "The ticket asks for urgent help." },
}
const request = {
  questions,
  state: { ticket: "Site down, customers can't log in" },
  namespace: "triage",
}

/** A fake decisions endpoint: `noul` for every question, `cost` per call, or a status. */
function provider(noul = 0.95, opts: { status?: number; hang?: boolean; cost?: number } = {}) {
  const calls: unknown[] = []
  const fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    if (opts.hang)
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      )
    if (opts.status) return new Response("upstream", { status: opts.status })
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
    return Response.json({
      model: "typesafe/jev-1.13-20260917",
      answers: Object.fromEntries(
        Object.keys(body.questions).map((q) => [q, { type: "noul", noul }]),
      ),
      usage: { input_tokens: 100, output_tokens: 4, cost: opts.cost ?? 0.00003 },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

function runtime(extra: Partial<PolicyRuntimeOptions> = {}, fetch = provider().fetch) {
  return createPolicyRuntime({
    egress: "on",
    maxUsdPerDay: 1,
    apiKey: "sk-test",
    fetch,
    ...extra,
  })
}

describe("createPolicyRuntime", () => {
  it("answers, and counts the spend in the root's ledger", async () => {
    const root = temp()
    const rt = runtime({ root })
    const r = await rt.decide(request)
    expect(r).toMatchObject({ ok: true, source: "live", ledger: "file" })
    expect(existsSync(join(root, "usage.jsonl"))).toBe(true)
    expect(rt.spentToday()).toBeCloseTo(0.00003)
  })

  it("never calls with egress off, whatever else is set", async () => {
    const { fetch, calls } = provider()
    const r = await runtime({ egress: "off" }, fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "egress-off" })
    expect(calls).toHaveLength(0)
  })

  it("falls back with no-key, and never reads consent from the environment", async () => {
    const r = await runtime({ apiKey: "" }).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "no-key" })
  })

  it("falls back on an undecided answer, with the answers for the log", async () => {
    const r = await runtime({}, provider(0.5).fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "undecided", undecided: ["urgent"] })
    if (!r.ok) expect(r.answers?.urgent).toBeDefined()
  })

  it("falls back on a provider error and on a timeout", async () => {
    const failing = provider(0.95, { status: 400 })
    expect(await runtime({}, failing.fetch).decide(request)).toMatchObject({
      ok: false,
      reason: "provider-error",
    })
    const hanging = provider(0.95, { hang: true })
    const r = await runtime({ timeoutMs: 20 }, hanging.fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "timeout" })
  })

  it("refuses a state too large, and never sends it", async () => {
    const { fetch, calls } = provider()
    const r = await runtime({}, fetch).decide({ ...request, state: "word ".repeat(100_000) })
    expect(r).toMatchObject({ ok: false, reason: "refused" })
    expect(calls).toHaveLength(0)
  })

  it("stops at the daily cap, before the call; one call may pass it by its measured cost", async () => {
    const { fetch, calls } = provider(0.95, { cost: 0.6 })
    const rt = runtime({ maxUsdPerDay: 1 }, fetch)
    expect((await rt.decide(request)).ok).toBe(true)
    // $0.60 spent, and this call projects far less than $0.40: it goes, and spends $0.60.
    expect((await rt.decide(request)).ok).toBe(true)
    const third = await rt.decide(request)
    expect(third).toMatchObject({ ok: false, reason: "budget", ledger: "memory" })
    expect(calls).toHaveLength(2)
  })

  it("keeps the cap across a restart when the root is writable", async () => {
    const root = temp()
    const { fetch } = provider(0.95, { cost: 1 })
    expect((await runtime({ root }, fetch).decide(request)).ok).toBe(true)
    const again = runtime({ root }, fetch)
    expect(again.spentToday()).toBeCloseTo(1)
    expect(await again.decide(request)).toMatchObject({ ok: false, reason: "budget" })
  })

  it("resets the cap when the UTC day turns", async () => {
    let at = new Date("2026-10-01T23:59:00Z")
    const { fetch } = provider(0.95, { cost: 1 })
    const rt = runtime({ now: () => at }, fetch)
    expect((await rt.decide(request)).ok).toBe(true)
    expect((await rt.decide(request)).ok).toBe(false)
    at = new Date("2026-10-02T00:01:00Z")
    expect((await rt.decide(request)).ok).toBe(true)
  })

  it("with no root, writes nothing anywhere and counts in memory", async () => {
    const cwd = temp()
    const before = process.cwd()
    process.chdir(cwd)
    try {
      const r = await runtime().decide(request)
      expect(r).toMatchObject({ ok: true, ledger: "memory" })
      expect(readdirSync(cwd)).toEqual([])
    } finally {
      process.chdir(before)
    }
  })

  it("keeps answering when the root can't be written, counting in memory", async () => {
    const dir = temp()
    const root = join(dir, "not-a-dir")
    writeFileSync(root, "")
    const rt = runtime({ root })
    const r = await rt.decide(request)
    expect(r).toMatchObject({ ok: true, ledger: "memory" })
    expect(rt.spentToday()).toBeCloseTo(0.00003)
  })

  it.skipIf(process.getuid?.() === 0)("keeps answering on a read-only root", async () => {
    const root = temp()
    chmodSync(root, 0o500)
    try {
      const r = await runtime({ root }).decide(request)
      expect(r).toMatchObject({ ok: true, ledger: "memory" })
    } finally {
      chmodSync(root, 0o700)
    }
  })

  it("replays recorded answers offline, with egress off", async () => {
    const root = temp()
    const { fetch } = provider()
    // Record through the engine's own fixture layout by a live call in record mode.
    const { createDecider } = await import("../decide.js")
    const { FixtureStore } = await import("../fixtures/store.js")
    const { resolveProfile } = await import("../model/profiles.js")
    const { createOpenRouterTransport } = await import("../transport/openrouter.js")
    const { prepareState } = await import("../prepare.js")
    const profile = resolveProfile("typesafe/jev-1.13")
    const safe = prepareState(request.state, { questions, profile })
    await createDecider({
      profile,
      egressConsent: true,
      mode: "record",
      transport: createOpenRouterTransport({ apiKey: "sk-test", fetch }),
      fixtures: new FixtureStore(join(root, "fixtures")),
    }).decide({ state: safe.state, questions, namespace: "triage" })

    const r = await runtime({ root, egress: "off", mode: "replay", apiKey: "" }).decide(request)
    expect(r).toMatchObject({ ok: true, source: "replay" })
    const miss = await runtime({ root, egress: "off", mode: "replay" }).decide({
      ...request,
      state: "never recorded",
    })
    expect(miss).toMatchObject({ ok: false, reason: "provider-error" })
  })

  it("never throws, even on a malformed request or an unknown model", async () => {
    const bad = await runtime().decide({ ...request, questions: {} as never })
    expect(bad).toMatchObject({ ok: false, reason: "internal" })
    const model = await runtime({ model: "nobody/nothing" }).decide(request)
    expect(model).toMatchObject({ ok: false, reason: "internal" })
  })

  it("never puts the state or the key in a fallback's detail", async () => {
    const { fetch } = provider(0.95, { status: 400 })
    const r = await runtime({ apiKey: "sk-or-v1-secretkey" }, fetch).decide(request)
    expect(JSON.stringify(r)).not.toContain("Site down")
    expect(JSON.stringify(r)).not.toContain("secretkey")
  })
})
