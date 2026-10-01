import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { QuestionSet } from "../model/types.js"
import { fakeDecisionsFetch } from "../testkit/fake-model.js"
import { useTempDirs } from "../testkit/tmp.js"
import { type CompareReport, runCompare } from "../tools/compare.js"
import { createContext } from "../tools/context.js"
import { readCaptured, readLabels } from "./capture.js"
import { accuracy, agreement, costSignal, latencySignal, type RowAnswers } from "./signals.js"

const temp = useTempDirs()

const questions: QuestionSet = {
  auth: { type: "noul", instructions: "The ticket is about logging in." },
  team: {
    type: "choice",
    instructions: "Which team owns it.",
    criteria: { identity: "Identity", billing: "Billing" },
  },
}
const SPEC = `description: Route tickets.
questions:
  auth: { type: noul, instructions: The ticket is about logging in. }
  team:
    type: choice
    instructions: Which team owns it.
    criteria: { identity: Identity, billing: Billing }
`
const CONSENT = "egress:\n  consent: { granted: true }\n"
const ALLOWED = `${CONSENT}  allowProfiles: [emulated:anthropic/claude-haiku-4.5]\n`

const row = (id: string, state: unknown, current?: unknown, extra: object = {}) =>
  JSON.stringify({ id, state, ...(current !== undefined ? { current } : {}), ...extra })

/** Three tickets: the current mechanism agrees on t1, disagrees on t2's team, and t3 is flat for Jev. */
const CAPTURED = [
  row(
    "t1",
    "auth fails",
    { auth: 0.9, team: "identity" },
    { usage: { cost: 0.001 }, latencyMs: 900 },
  ),
  row("t2", "invoice wrong", { auth: 0.1, team: "identity" }, { latencyMs: 700 }),
  row("t3", "maybe login", { auth: 0.6, team: "billing" }),
].join("\n")

/** A chat endpoint for the emulated side: always identity, auth 0.8. */
function chatFetch(decisions: typeof fetch) {
  const chat = { calls: 0 }
  const fetch = (async (url: string, init: RequestInit) => {
    if (!String(url).includes("chat/completions")) return decisions(url, init)
    chat.calls += 1
    return Response.json({
      model: "anthropic/claude-4.5-haiku-20251001",
      choices: [{ message: { content: JSON.stringify({ auth: 0.8, team: "identity" }) } }],
      usage: { prompt_tokens: 400, completion_tokens: 12, cost: 0.0005 },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, chat }
}

function repo(files: Record<string, string>, { key = true, config = CONSENT } = {}) {
  const cwd = temp({
    ".system1/config.yaml": config,
    ".system1/specs/tickets.yaml": SPEC,
    ...files,
  })
  const model = fakeDecisionsFetch()
  const { fetch, chat } = chatFetch(model.fetch)
  const ctx = createContext({
    cwd,
    home: temp(),
    env: key ? { OPENROUTER_API_KEY: "k" } : {},
    fetch,
  })
  return { cwd, ctx, model, chat }
}

const CAPTURE_PATH = ".system1/compare/tickets/captured.jsonl"

describe("compare signals", () => {
  const rows: RowAnswers[] = [
    {
      id: "a",
      jev: { answers: { auth: { type: "noul", noul: 0.9 } }, undecided: [] },
      baseline: { auth: { type: "noul", noul: 0.7 } },
      label: { auth: { type: "noul", noul: 1 } },
    },
    {
      id: "b",
      jev: { answers: { auth: { type: "noul", noul: 0.5 } }, undecided: ["auth"] },
      baseline: { auth: { type: "noul", noul: 0.2 } },
      label: { auth: { type: "noul", noul: 0 } },
    },
    {
      id: "c",
      baseline: { auth: { type: "noul", noul: 0.2 } },
      label: { auth: { type: "noul", noul: 1 } },
    },
  ]
  const q = { auth: questions.auth } as QuestionSet

  it("counts an undecided Jev answer apart, not as a disagreement", () => {
    const a = agreement(q, rows)
    expect(a.byQuestion.auth).toMatchObject({ n: 1, hits: 1, rate: 1, jevUndecided: 1 })
    expect(a.byType.noul).toMatchObject({ n: 1, rate: 1 })
  })

  it("gives accuracy with its n, and unanswered labels apart", () => {
    expect(accuracy(q, rows, "jev").overall).toEqual({ n: 1, hits: 1, rate: 1, unanswered: 2 })
    expect(accuracy(q, rows, "baseline").overall).toEqual({
      n: 3,
      hits: 2,
      rate: 2 / 3,
      unanswered: 0,
    })
  })

  it("reports cost as unknown, never zero, and flags an incomplete total", () => {
    expect(costSignal([undefined, undefined])).toEqual({
      calls: 2,
      total: null,
      perCall: null,
      complete: false,
    })
    const some = costSignal([{ input_tokens: 0, output_tokens: 0, cost: 0.002 }, undefined])
    expect(some).toMatchObject({ total: 0.002, perCall: 0.001, complete: false })
    expect(costSignal([{ input_tokens: 1, output_tokens: 0, cost: 0.001 }])).toMatchObject({
      complete: true,
    })
    expect(costSignal([])).toMatchObject({ total: null, complete: false })
  })

  it("summarises latency", () => {
    expect(latencySignal([100, 300, 200, undefined])).toEqual({
      n: 3,
      meanMs: 200,
      p50Ms: 200,
      p95Ms: 300,
    })
    expect(latencySignal([])).toMatchObject({ n: 0, p50Ms: null })
  })
})

describe("reading a capture and labels", () => {
  it("leaves out bad lines with their numbers, and parses current strictly", () => {
    const dir = temp({
      "c.jsonl": [
        row("a", "x", { auth: 0.2, team: "billing" }),
        "{torn",
        row("a", "dup", { auth: 0.2, team: "billing" }),
        JSON.stringify({ state: "no id" }),
        row("b", 7),
        row("c", { text: "y" }, { auth: 2, team: "billing" }, { usage: { cost: -1 } }),
        "",
      ].join("\n"),
      "l.jsonl": [
        JSON.stringify({ id: "a", labels: { team: "billing" } }),
        JSON.stringify({ id: "b", labels: { team: "nope" } }),
        JSON.stringify({ id: "c", labels: { other: 1 } }),
      ].join("\n"),
    })
    const { rows, bad } = readCaptured(join(dir, "c.jsonl"), questions)
    expect(rows.map((r) => r.id)).toEqual(["a", "c"])
    expect(bad.map((b) => b.line)).toEqual([2, 3, 4, 5])
    expect(rows[1]).toMatchObject({ currentError: expect.stringMatching(/auth/) })
    expect(rows[1]?.usage).toBeUndefined()
    const labels = readLabels(join(dir, "l.jsonl"), questions)
    expect([...(labels?.byId.keys() ?? [])]).toEqual(["a"])
    expect(labels?.bad.map((b) => b.line)).toEqual([2, 3])
    expect(readLabels(join(dir, "none.jsonl"), questions)).toBeUndefined()
  })

  it("says where the capture is expected when it is missing", async () => {
    const { ctx } = repo({})
    await expect(runCompare(ctx, { spec: "tickets" })).rejects.toMatchObject({
      code: "source-error",
      message: expect.stringMatching(/captured\.jsonl.*shadow harness/s),
    })
  })
})

describe("runCompare against the current mechanism", () => {
  it("reports signals, writes report.json, and names no winner without labels", async () => {
    const { cwd, ctx, model } = repo({ [CAPTURE_PATH]: CAPTURED })
    const r = (await runCompare(ctx, { spec: "tickets" })) as CompareReport
    expect(model.calls).toBe(3)
    expect(r.winner).toBeNull()
    expect(r.verdict).toMatch(/No labels.*no winner/)
    expect(r.baseline).toMatchObject({ model: "current", source: "captured" })
    // Only t1 reported its cost: a lower bound, never zero for the others.
    expect(r.baseline.cost).toMatchObject({ total: 0.001, complete: false })
    expect(r.baseline.latency).toMatchObject({ n: 2 })
    expect(r.jev.cost).toMatchObject({ calls: 3, complete: true })
    // t1 agrees on both; t2 disagrees on team; t3 is flat for Jev, so not counted.
    expect(r.signals.agreement.byQuestion.team).toMatchObject({ n: 2, hits: 1, jevUndecided: 1 })
    expect(r.disagreements.sample).toEqual([
      { id: "t2", question: "team", jev: "billing", baseline: "identity" },
    ])
    expect(r.signals.undecidedShare).toMatchObject({ n: 6, hits: 2 })
    const written = JSON.parse(
      readFileSync(join(cwd, ".system1/compare/tickets/report.json"), "utf8"),
    )
    expect(written.winner).toBeNull()
    // Spend is ledgered under the compare tag.
    expect(readFileSync(join(cwd, ".system1/usage.jsonl"), "utf8")).toMatch(/"tag":"compare"/)
  })

  it("never sends the captured answers, output or usage", async () => {
    const sent: string[] = []
    const { cwd } = repo({
      [CAPTURE_PATH]: row(
        "t1",
        "auth fails",
        { auth: 0.9, team: "identity" },
        { output: "SECRET-OUTPUT" },
      ),
    })
    const model = fakeDecisionsFetch()
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push(String(init.body))
      return model.fetch(url, init)
    }) as unknown as typeof globalThis.fetch
    await runCompare(
      createContext({ cwd, home: temp(), env: { OPENROUTER_API_KEY: "k" }, fetch }),
      {
        spec: "tickets",
      },
    )
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0] as string).state).toBe("auth fails")
    expect(sent[0]).not.toMatch(/SECRET-OUTPUT|current/)
  })

  it("with labels, reports accuracy with n and the leader", async () => {
    const labels = [
      JSON.stringify({ id: "t1", labels: { team: "identity" } }),
      JSON.stringify({ id: "t2", labels: { team: "billing" } }),
      JSON.stringify({ id: "gone", labels: { team: "billing" } }),
    ].join("\n")
    const { ctx } = repo({ [CAPTURE_PATH]: CAPTURED, ".system1/labels/tickets.jsonl": labels })
    const r = (await runCompare(ctx, { spec: "tickets" })) as CompareReport
    expect(r.labels).toMatchObject({ matched: 2, unmatched: 1 })
    expect(r.labels?.accuracy.jev.overall).toMatchObject({ n: 2, hits: 2 })
    expect(r.labels?.accuracy.baseline.overall).toMatchObject({ n: 2, hits: 1 })
    expect(r.winner).toBe("jev")
    expect(r.verdict).toMatch(/100\.0% of 2.*50\.0% of 2/)
  })

  it("dry run projects without calls or consent", async () => {
    const { ctx, model } = repo({ [CAPTURE_PATH]: CAPTURED }, { config: "" })
    const r = await runCompare(ctx, { spec: "tickets", dryRun: true, baseline: "emulated" })
    expect(model.calls).toBe(0)
    expect(r).toMatchObject({ dryRun: true, rows: { captured: 3 } })
    if ("dryRun" in r) {
      expect(r.projection.total.calls).toBe(6)
      expect(r.projection.total.projectedUsd).toBeCloseTo(
        r.projection.jev.projectedUsd + (r.projection.baseline?.projectedUsd ?? 0),
      )
    }
  })

  it("guards both sides' calls together, and withholds a state too large", async () => {
    const { ctx, model } = repo(
      { [CAPTURE_PATH]: CAPTURED },
      { config: `${ALLOWED}budget: { maxCalls: 5 }\n` },
    )
    await expect(runCompare(ctx, { spec: "tickets", baseline: "emulated" })).rejects.toMatchObject({
      code: "budget-exceeded",
    })
    expect(model.calls).toBe(0)
    const big = repo({
      [CAPTURE_PATH]: [
        CAPTURED,
        row("huge", "word ".repeat(60_000), { auth: 0, team: "billing" }),
      ].join("\n"),
    })
    const r = (await runCompare(big.ctx, { spec: "tickets", limit: 4 })) as CompareReport
    expect(r.rows.withheld).toEqual([
      { id: "huge", reason: expect.stringMatching(/too large|token/i) },
    ])
    expect(big.model.calls).toBe(3)
  })
})

describe("runCompare against the emulated baseline", () => {
  it("refuses an emulated baseline the repo hasn't allowed, before Jev spends anything", async () => {
    const { ctx, model, chat } = repo({ [CAPTURE_PATH]: CAPTURED })
    await expect(runCompare(ctx, { spec: "tickets", baseline: "emulated" })).rejects.toMatchObject({
      code: "profile-not-allowed",
    })
    expect(model.calls + chat.calls).toBe(0)
  })

  it("asks both, counts the parse rate, records, and replays without a key", async () => {
    const { cwd, ctx, model, chat } = repo({ [CAPTURE_PATH]: CAPTURED }, { config: ALLOWED })
    const r = (await runCompare(ctx, {
      spec: "tickets",
      baseline: "emulated",
      mode: "record",
    })) as CompareReport
    expect([model.calls, chat.calls]).toEqual([3, 3])
    expect(r.baseline).toMatchObject({
      model: "emulated:anthropic/claude-haiku-4.5",
      source: "live",
      parsed: { n: 3, hits: 3, rate: 1 },
      cost: { total: 0.0015, complete: true },
    })
    expect(r.usage.cost).toBeCloseTo(0.0015 + 3 * 0.000004)
    const again = (await runCompare(createContext({ cwd, home: temp(), env: {} }), {
      spec: "tickets",
      baseline: "emulated",
    })) as CompareReport
    expect(again.jev.source).toBe("replay")
    expect(again.baseline.source).toBe("replay")
    expect(again.signals.agreement).toEqual(r.signals.agreement)
    // A replay measures no cost: unknown, not zero.
    expect(again.jev.cost.total).toBeNull()
    expect(existsSync(join(cwd, ".system1/compare/tickets/report.json"))).toBe(true)
  })

  it("refuses an unknown baseline", async () => {
    const { ctx } = repo({ [CAPTURE_PATH]: CAPTURED })
    await expect(runCompare(ctx, { spec: "tickets", baseline: "gpt" })).rejects.toMatchObject({
      code: "invalid-request",
    })
  })
})
