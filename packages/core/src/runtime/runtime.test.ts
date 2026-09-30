import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createDecider } from "../decide.js"
import { FixtureStore } from "../fixtures/store.js"
import { resolveProfile } from "../model/profiles.js"
import { prepareState } from "../prepare.js"
import { useTempDirs } from "../testkit/tmp.js"
import { createOpenRouterTransport } from "../transport/openrouter.js"
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

interface ProviderOpts {
  status?: number
  hang?: boolean
  cost?: number
  /** Omit `usage`: the cost is unknown. */
  noUsage?: boolean
  /** Echo the request body back in an error, as some endpoints do. */
  echo?: boolean
  /** Check the Authorization header the way a real fetch would. */
  strictHeaders?: boolean
}

/** A fake decisions endpoint: `noul` for every question. */
function provider(noul = 0.95, opts: ProviderOpts = {}) {
  const calls: unknown[] = []
  const fetch = (async (_url: string, init?: RequestInit) => {
    if (opts.strictHeaders) new Headers(init?.headers) // throws on a bad header value, quoting it
    calls.push(JSON.parse(String(init?.body)))
    if (opts.hang)
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      )
    if (opts.status)
      return new Response(opts.echo ? String(init?.body) : "upstream", { status: opts.status })
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
    return Response.json({
      model: "typesafe/jev-1.13-20260917",
      answers: Object.fromEntries(
        Object.keys(body.questions).map((q) => [q, { type: "noul", noul }]),
      ),
      ...(opts.noUsage
        ? {}
        : { usage: { input_tokens: 100, output_tokens: 4, cost: opts.cost ?? 0.00003 } }),
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

/** Record `request` in `root/fixtures` with a fake live call, as `adopt`'s tests would ship. */
async function record(root: string) {
  const profile = resolveProfile("typesafe/jev-1.13")
  const safe = prepareState(request.state, { questions, profile })
  await createDecider({
    profile,
    egressConsent: true,
    mode: "record",
    transport: createOpenRouterTransport({ apiKey: "sk-test", fetch: provider().fetch }),
    fixtures: new FixtureStore(join(root, "fixtures")),
  }).decide({ state: safe.state, questions, namespace: request.namespace })
}

const line = (ts: string, cost: unknown) => `${JSON.stringify({ ts, tag: "runtime", cost })}\n`

describe("createPolicyRuntime: answers and consent", () => {
  it("answers, and counts the spend in the root's ledger", async () => {
    const root = temp()
    const rt = runtime({ root })
    expect(await rt.decide(request)).toMatchObject({ ok: true, source: "live", ledger: "file" })
    expect(existsSync(join(root, "usage.jsonl"))).toBe(true)
    expect(rt.spentToday()).toBeCloseTo(0.00003)
  })

  it('sends nothing unless egress is exactly "on"', async () => {
    for (const egress of ["off", "ON", "On", " on", true, 1, undefined]) {
      const { fetch, calls } = provider()
      const r = await runtime({ egress: egress as never }, fetch).decide(request)
      expect(r, String(egress)).toMatchObject({ ok: false, reason: "egress-off" })
      expect(calls, String(egress)).toHaveLength(0)
    }
  })

  it("a key in the environment never grants egress", async () => {
    const before = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "sk-from-env"
    try {
      const { fetch, calls } = provider()
      const r = await runtime({ egress: "off", apiKey: undefined }, fetch).decide(request)
      expect(r).toMatchObject({ ok: false, reason: "egress-off" })
      expect(calls).toHaveLength(0)
    } finally {
      if (before === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = before
    }
  })

  it("falls back with no-key when the key is absent or malformed, never echoing it", async () => {
    expect(await runtime({ apiKey: "" }).decide(request)).toMatchObject({ reason: "no-key" })
    const { fetch } = provider(0.95, { strictHeaders: true })
    const r = await runtime({ apiKey: "sk-or-v1-SECRETPART\n# prod key" }, fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "no-key" })
    expect(JSON.stringify(r)).not.toContain("SECRETPART")
  })
})

describe("createPolicyRuntime: fallbacks", () => {
  it("falls back on an undecided answer, with the answers for the log", async () => {
    const r = await runtime({}, provider(0.5).fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "undecided", undecided: ["urgent"] })
    if (!r.ok) expect(r.answers?.urgent).toBeDefined()
  })

  it("falls back on a provider error, never quoting the response body", async () => {
    const { fetch } = provider(0.95, { status: 400, echo: true })
    const r = await runtime({}, fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "provider-error", detail: "provider-http 400" })
    expect(JSON.stringify(r)).not.toContain("Site down")
  })

  it("times out on the whole call, retries included", async () => {
    const { fetch } = provider(0.95, { hang: true })
    const started = performance.now()
    const r = await runtime({ timeoutMs: 100 }, fetch).decide(request)
    expect(r).toMatchObject({ ok: false, reason: "timeout" })
    expect(performance.now() - started).toBeLessThan(600)
  })

  it("refuses a state too large, and never sends it", async () => {
    const { fetch, calls } = provider()
    const r = await runtime({}, fetch).decide({ ...request, state: "word ".repeat(100_000) })
    expect(r).toMatchObject({ ok: false, reason: "refused" })
    expect(calls).toHaveLength(0)
  })

  it("never throws or rejects, whatever it is given", async () => {
    const cases: Array<[Partial<PolicyRuntimeOptions>, unknown]> = [
      [{}, { ...request, questions: {} }],
      [{ model: "nobody/nothing" }, request],
      [{ maxUsdPerDay: Number.NaN }, request],
      [{ maxUsdPerDay: -1 }, request],
      [{ maxUsdPerDay: undefined as never }, request],
      [{ mode: "record" as never }, request],
      [{ timeoutMs: 0 }, request],
      [{ root: 5 as never }, request],
      [{ now: () => new Date("nope") }, request],
      [{}, undefined],
      [{}, { ...request, state: undefined }],
    ]
    for (const [extra, req] of cases) {
      const r = await runtime(extra).decide(req as never)
      expect(typeof r.ok, JSON.stringify(extra)).toBe("boolean")
    }
    expect(await createPolicyRuntime(undefined as never).decide(request)).toMatchObject({
      ok: false,
      reason: "internal",
    })
    expect(await runtime({ maxUsdPerDay: Number.NaN }).decide(request)).toMatchObject({
      reason: "internal",
      detail: "maxUsdPerDay must be a finite number, at least 0",
    })
  })
})

describe("createPolicyRuntime: the daily cap", () => {
  it("stops before the call; the call that crosses it goes, the next one doesn't", async () => {
    const { fetch, calls } = provider(0.95, { cost: 0.6 })
    const rt = runtime({ maxUsdPerDay: 1 }, fetch)
    expect((await rt.decide(request)).ok).toBe(true)
    expect((await rt.decide(request)).ok).toBe(true)
    expect(await rt.decide(request)).toMatchObject({ ok: false, reason: "budget" })
    expect(calls).toHaveLength(2)
  })

  it("holds against concurrent calls: each reserves its projection before it waits", async () => {
    // Report no usage, so each call counts exactly its projection.
    const { fetch, calls } = provider(0.95, { noUsage: true })
    const probe = runtime({}, fetch)
    await probe.decide(request)
    const one = probe.spentToday()
    const rt = runtime({ maxUsdPerDay: one * 5.5 }, fetch)
    const before = calls.length
    const results = await Promise.all(Array.from({ length: 20 }, () => rt.decide(request)))
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(calls.length - before).toBe(5)
  })

  it("counts a cost the provider doesn't report at its projection, not as free", async () => {
    const rt = runtime({}, provider(0.95, { noUsage: true }).fetch)
    expect((await rt.decide(request)).ok).toBe(true)
    expect(rt.spentToday()).toBeGreaterThan(0)
  })

  it("keeps the cap across a restart, counting only today's numeric lines", async () => {
    const root = temp()
    appendFileSync(join(root, "usage.jsonl"), line("2000-01-01T00:00:00.000Z", 5))
    const { fetch } = provider(0.95, { cost: 1 })
    expect((await runtime({ root }, fetch).decide(request)).ok).toBe(true)
    appendFileSync(join(root, "usage.jsonl"), line(new Date().toISOString(), "abc"))
    const again = runtime({ root }, fetch)
    expect(again.spentToday()).toBeCloseTo(1)
    expect(await again.decide(request)).toMatchObject({ ok: false, reason: "budget" })
  })

  it.skipIf(process.getuid?.() === 0)(
    "keeps the day's spend when the ledger stops being writable after a restart",
    async () => {
      const root = temp()
      appendFileSync(join(root, "usage.jsonl"), line(new Date().toISOString(), 0.9))
      const rt = runtime({ root }, provider(0.95, { cost: 0.05 }).fetch)
      expect(rt.spentToday()).toBeCloseTo(0.9)
      chmodSync(join(root, "usage.jsonl"), 0o400)
      try {
        expect(await rt.decide(request)).toMatchObject({ ok: true, ledger: "memory" })
        expect(rt.spentToday()).toBeCloseTo(0.95)
      } finally {
        chmodSync(join(root, "usage.jsonl"), 0o600)
      }
    },
  )

  it("resets when the UTC day turns", async () => {
    let at = new Date("2026-10-01T23:59:00Z")
    const rt = runtime({ now: () => at }, provider(0.95, { cost: 1 }).fetch)
    expect((await rt.decide(request)).ok).toBe(true)
    expect((await rt.decide(request)).ok).toBe(false)
    at = new Date("2026-10-02T00:01:00Z")
    expect((await rt.decide(request)).ok).toBe(true)
  })

  it("reads a long ledger quickly: only today's tail", () => {
    const root = temp()
    writeFileSync(
      join(root, "usage.jsonl"),
      line("2000-01-01T00:00:00.000Z", 0.00003).repeat(200_000) +
        line(new Date().toISOString(), 0.25),
    )
    const started = performance.now()
    expect(runtime({ root }).spentToday()).toBeCloseTo(0.25)
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe("createPolicyRuntime: where it writes", () => {
  it("with no root, counts in memory", async () => {
    const rt = runtime()
    expect(await rt.decide(request)).toMatchObject({ ok: true, ledger: "memory" })
    expect(rt.spentToday()).toBeGreaterThan(0)
  })

  it("keeps answering when the root can't be written, counting in memory", async () => {
    const root = join(temp(), "not-a-dir")
    writeFileSync(root, "")
    const rt = runtime({ root })
    expect(await rt.decide(request)).toMatchObject({ ok: true, ledger: "memory" })
    expect(rt.spentToday()).toBeCloseTo(0.00003)
  })

  it.skipIf(process.getuid?.() === 0)("keeps answering on a read-only root", async () => {
    const root = temp()
    chmodSync(root, 0o500)
    try {
      expect(await runtime({ root }).decide(request)).toMatchObject({ ok: true, ledger: "memory" })
    } finally {
      chmodSync(root, 0o700)
    }
  })

  it("replays recorded answers offline with egress off, sending and writing nothing", async () => {
    const root = temp()
    await record(root)
    const { fetch, calls } = provider()
    const r = await runtime({ root, egress: "off", mode: "replay", apiKey: "" }, fetch).decide(
      request,
    )
    expect(r).toMatchObject({ ok: true, source: "replay" })
    expect(calls).toHaveLength(0)
    expect(existsSync(join(root, "usage.jsonl"))).toBe(false)
    const miss = await runtime({ root, egress: "off", mode: "replay" }).decide({
      ...request,
      state: "never recorded",
    })
    expect(miss).toMatchObject({
      ok: false,
      reason: "provider-error",
      detail: "no recorded answer for this state (replay)",
    })
  })
})
