import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { mapWithConcurrency } from "./pool.js"
import { SpendLedger, sumUsage } from "./spend.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempLedger = () => {
  const dir = mkdtempSync(join(tmpdir(), "decisions-ledger-"))
  dirs.push(dir)
  return new SpendLedger(join(dir, "nested", "usage.jsonl"))
}
const entry = (over: Partial<Parameters<SpendLedger["append"]>[0]> = {}) => ({
  ts: "2026-09-22T00:00:00.000Z",
  model: "typesafe/jev-1.13",
  source: "live" as const,
  calls: 1,
  input_tokens: 700,
  output_tokens: 150,
  cost: 0.00003,
  ...over,
})

describe("SpendLedger", () => {
  it("summarises nothing as zero", () => {
    expect(tempLedger().summary()).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      calls: 0,
      liveCalls: 0,
      replayCalls: 0,
    })
  })

  it("persists across instances and splits live from replay", () => {
    const ledger = tempLedger()
    ledger.append(entry())
    ledger.append(entry({ source: "replay", input_tokens: 0, output_tokens: 0, cost: 0 }))
    const summary = new SpendLedger(ledger.file).summary()
    expect(summary).toMatchObject({ calls: 2, liveCalls: 1, replayCalls: 1, input_tokens: 700 })
    expect(summary.cost).toBeCloseTo(0.00003)
  })

  it("filters by session and time", () => {
    const ledger = tempLedger()
    ledger.append(entry({ session: "a" }))
    ledger.append(entry({ session: "b", ts: "2026-09-23T00:00:00.000Z" }))
    expect(ledger.summary({ session: "a" }).calls).toBe(1)
    expect(ledger.summary({ since: new Date("2026-09-22T12:00:00Z") }).calls).toBe(1)
  })

  it("skips a torn trailing line instead of failing", () => {
    const ledger = tempLedger()
    ledger.append(entry())
    appendFileSync(ledger.file, '{"ts":"2026-09-2')
    expect(ledger.summary().calls).toBe(1)
  })
})

describe("sumUsage", () => {
  it("adds usages and tolerates gaps", () => {
    expect(sumUsage([{ input_tokens: 1, output_tokens: 2, cost: 0.5 }, undefined])).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cost: 0.5,
    })
  })
})

describe("mapWithConcurrency", () => {
  it("keeps input order, isolates failures and respects the limit", async () => {
    let inFlight = 0
    let peak = 0
    const progress: number[] = []
    const results = await mapWithConcurrency(
      [30, 10, 20, 0],
      2,
      async (ms, i) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, ms))
        inFlight -= 1
        if (i === 2) throw new Error("boom")
        return i
      },
      (done) => progress.push(done),
    )
    expect(peak).toBe(2)
    expect(results).toEqual([
      { value: 0 },
      { value: 1 },
      { error: new Error("boom") },
      { value: 3 },
    ])
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})
