import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fakeDecisionsFetch } from "../testkit/fake-model.js"
import { useTempDirs } from "../testkit/tmp.js"
import { runAsk } from "./ask.js"
import { createContext } from "./context.js"
import { runMany } from "./many.js"
import { runUsage } from "./usage.js"

const temp = useTempDirs()
const CONSENT = "egress:\n  consent: { granted: true }\n"
const questions = { relevant: { type: "noul", instructions: "The file handles authentication." } }

function repo(files: Record<string, string>, { consent = true, key = true } = {}) {
  const cwd = temp({
    ...(consent ? { ".decisions/config.yaml": CONSENT } : { ".decisions/.keep": "" }),
    ...files,
  })
  const model = fakeDecisionsFetch()
  const ctx = createContext({
    cwd,
    home: temp(),
    env: key ? { OPENROUTER_API_KEY: "k" } : {},
    fetch: model.fetch,
  })
  return { cwd, ctx, model }
}

const FILES = {
  "src/auth.ts": "export const auth = () => {}",
  "src/maybe.ts": "maybe related",
  "src/util.ts": "export const add = 1",
  "src/other.ts": "nothing",
  ".env": "SECRET=x",
}

describe("many", () => {
  it("fans out, keeps survivors, routes undecided separately, and reports what was withheld", async () => {
    const { ctx, model } = repo(FILES)
    const r = await runMany(ctx, {
      questions,
      sources: [{ kind: "glob", patterns: ["**/*"] }],
      keep: ["relevant>=0.7"],
    })
    expect(model.calls).toBe(4)
    expect(r.source).toBe("live")
    expect(r.kept.map((k) => k.id)).toEqual(["src/auth.ts"])
    expect(r.undecided.map((u) => [u.id, u.questions])).toEqual([["src/maybe.ts", ["relevant"]]])
    expect(r.counts).toMatchObject({
      items: 4,
      kept: 1,
      undecided: 1,
      dropped: 2,
      failed: 0,
      skipped: 1,
    })
    expect(r.skipped).toMatchObject({ total: 1, byReason: { excluded: 1 } })
    expect(r.usage.cost).toBeCloseTo(0.000016)
  })

  it("dry run projects without calling, and needs no consent", async () => {
    const { ctx, model } = repo(FILES, { consent: false })
    const r = await runMany(ctx, {
      questions,
      sources: [{ kind: "glob", patterns: ["src/*"] }],
      dryRun: true,
    })
    expect(model.calls).toBe(0)
    expect(r).toMatchObject({
      dryRun: true,
      counts: { items: 4 },
      projection: { basis: "projected", calls: 4 },
    })
    expect(r.sampleIds).toHaveLength(4)
  })

  it("refuses without consent before any call", async () => {
    const { ctx, model } = repo(FILES, { consent: false })
    await expect(
      runMany(ctx, { questions, sources: [{ kind: "glob", patterns: ["src/*"] }] }),
    ).rejects.toMatchObject({
      code: "egress-refused",
    })
    expect(model.calls).toBe(0)
  })

  it("stops at the spend guard, and proceeds with confirm", async () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/f${i}.ts`, "x"]))
    const { cwd, model } = repo(files)
    const ctx = createContext({
      cwd,
      home: temp(),
      env: { OPENROUTER_API_KEY: "k" },
      fetch: model.fetch,
    })
    ctx.config.budget.maxCalls = 3
    const input = { questions, sources: [{ kind: "glob" as const, patterns: ["src/*"] }] }
    await expect(runMany(ctx, input)).rejects.toMatchObject({ code: "budget-exceeded" })
    expect(model.calls).toBe(0)
    await expect(runMany(ctx, { ...input, confirm: true })).resolves.toMatchObject({
      counts: { items: 5 },
    })
  })

  it("reports partial failures per item without failing the run", async () => {
    const { ctx } = repo({ "a.ts": "auth", "b.ts": "explode" })
    const r = await runMany(ctx, { questions, sources: [{ kind: "glob", patterns: ["*.ts"] }] })
    expect(r.counts).toMatchObject({ items: 2, failed: 1 })
    expect(r.failed[0]).toMatchObject({ id: "b.ts", code: "provider-http" })
  })

  it("raises the shared error when every item fails the same way", async () => {
    const { ctx } = repo({ "a.ts": "explode", "b.ts": "explode" })
    await expect(
      runMany(ctx, { questions, sources: [{ kind: "glob", patterns: ["*.ts"] }] }),
    ).rejects.toMatchObject({
      code: "provider-http",
      message: expect.stringMatching(/^All 2 items failed/),
    })
  })

  it("records live, then replays identically with no key and no consent", async () => {
    const { cwd, ctx } = repo(FILES)
    const input = {
      questions,
      sources: [{ kind: "glob" as const, patterns: ["src/*"] }],
      keep: ["relevant>=0.7"],
    }
    const live = await runMany(ctx, { ...input, mode: "record" })
    const offline = createContext({ cwd, home: temp(), env: {} })
    offline.config.egress.consent = { granted: false }
    const replayed = await runMany(offline, input)
    expect(replayed.source).toBe("replay")
    expect(replayed.kept).toEqual(live.kept)
    expect(replayed.usage.cost).toBe(0)
    expect(existsSync(join(cwd, ".decisions/fixtures/adhoc"))).toBe(true)
  })

  it("uses a spec's questions, source, keep and namespace", async () => {
    const spec = [
      "description: Auth files.",
      "questions:",
      "  relevant: { type: noul, instructions: The file handles authentication. }",
      'keep: ["relevant>=0.7"]',
      "source: { glob: ['src/*'] }",
    ].join("\n")
    const { cwd, ctx } = repo({ ...FILES, ".decisions/specs/auth-files.yaml": spec })
    const r = await runMany(ctx, { spec: "auth-files", mode: "record" })
    expect(r.spec).toBe("auth-files")
    expect(r.kept.map((k) => k.id)).toEqual(["src/auth.ts"])
    expect(existsSync(join(cwd, ".decisions/fixtures/auth-files"))).toBe(true)
  })

  it("rejects conflicting or incomplete input", async () => {
    const { ctx } = repo(FILES)
    await expect(runMany(ctx, { sources: [{ kind: "text", text: "x" }] })).rejects.toThrow(
      /No questions/,
    )
    await expect(runMany(ctx, { questions })).rejects.toThrow(/No source/)
    await expect(runMany(ctx, { questions, spec: "x", sources: [] })).rejects.toThrow(/not both/)
    await expect(runMany(ctx, { questions, sources: [{ kind: "nope" }] })).rejects.toMatchObject({
      code: "invalid-request",
    })
  })
})

describe("ask", () => {
  it("answers one state and gives a verdict for keep", async () => {
    const { ctx } = repo(FILES)
    const r = await runAsk(ctx, {
      questions,
      sources: [{ kind: "file", path: "src/auth.ts" }],
      keep: ["relevant>=0.7"],
    })
    expect(r).toMatchObject({ id: "src/auth.ts", source: "live", verdict: "kept", undecided: [] })
    const flat = await runAsk(ctx, {
      questions,
      sources: [{ kind: "text", text: "maybe" }],
      keep: ["relevant>=0.7"],
    })
    expect(flat.verdict).toBe("undecided")
  })

  it("refuses more than one state, pointing at many", async () => {
    const { ctx } = repo(FILES)
    await expect(
      runAsk(ctx, { questions, sources: [{ kind: "glob", patterns: ["src/*"] }] }),
    ).rejects.toThrow(/decide many/)
  })

  it("says when the only state was withheld", async () => {
    const { ctx } = repo(FILES)
    await expect(
      runAsk(ctx, { questions, sources: [{ kind: "file", path: ".env" }] }),
    ).rejects.toThrow(/\.env excluded/)
  })
})

describe("usage", () => {
  it("summarises measured spend from the ledger", async () => {
    const { cwd, ctx } = repo(FILES)
    await runMany(ctx, { questions, sources: [{ kind: "glob", patterns: ["src/*"] }] })
    const u = runUsage(ctx)
    expect(u).toMatchObject({ basis: "measured", calls: 4, liveCalls: 4 })
    expect(
      readFileSync(join(cwd, ".decisions/usage.jsonl"), "utf8").trim().split("\n"),
    ).toHaveLength(4)
    expect(() => runUsage(ctx, { since: "not a date" })).toThrow(/not a date/)
  })
})
