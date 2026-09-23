import { describe, expect, it } from "vitest"
import { draw, type PopulationPair, population, prng, shuffle } from "./calibration-sample.js"

const groups = new Map([
  ["io", "checkable"],
  ["defect", "judgement"],
])

function run(rows: Array<{ id: string; io?: number; defect?: number }>, undecided = false) {
  const toRow = (r: { id: string; io?: number; defect?: number }) => ({
    id: r.id,
    answers: {
      ...(r.io === undefined ? {} : { io: { type: "noul", noul: r.io } }),
      ...(r.defect === undefined ? {} : { defect: { type: "noul", noul: r.defect } }),
      other: { type: "noul", noul: 0.9 },
    },
  })
  const result = undecided
    ? { kept: [], undecided: rows.map(toRow) }
    : { kept: rows.map(toRow), undecided: [] }
  return JSON.stringify({ v: 1, ok: true, command: "many", result })
}

function pop(n: number): PopulationPair[] {
  return Array.from({ length: n }, (_, i) => ({
    corpus: "c",
    id: `f.ts:${i}`,
    question: "io",
    group: "checkable",
    predicted: (i % 10) / 10 + 0.05,
  }))
}

describe("population", () => {
  it("takes every grouped noul from kept and undecided, envelope or bare, once each", () => {
    const text = run([{ id: "a", io: 0.1, defect: 0.5 }])
    const both = JSON.stringify({
      kept: JSON.parse(text).result.kept,
      undecided: JSON.parse(
        run(
          [
            { id: "a", io: 0.1 },
            { id: "b", io: 0.5 },
          ],
          true,
        ),
      ).result.undecided,
    })
    expect(population("c", text, groups)).toHaveLength(2)
    const merged = population("c", both, groups)
    expect(merged.map((p) => `${p.id}/${p.question}`).sort()).toEqual(["a/defect", "a/io", "b/io"])
  })

  it("ignores ungrouped questions and refuses a run with nothing to sample", () => {
    expect(() => population("c", run([{ id: "a" }]), groups)).toThrow(/no noul answers/)
  })
})

describe("draw", () => {
  it("caps each (group, bucket) stratum and records its population", () => {
    const { sample, strata } = draw(pop(200), 5, 1)
    expect(strata).toHaveLength(10)
    for (const s of strata) expect(s).toMatchObject({ population: 20, sampled: 5 })
    expect(sample).toHaveLength(50)
  })

  it("takes a whole stratum smaller than the cap", () => {
    const { strata } = draw(pop(30), 5, 1)
    expect(strata.every((s) => s.sampled === 3 && s.population === 3)).toBe(true)
  })

  it("is deterministic for a seed and independent of input order", () => {
    const a = draw(pop(200), 5, 42).sample.map((p) => p.id)
    const b = draw(shuffle(pop(200), prng(9)), 5, 42).sample.map((p) => p.id)
    const c = draw(pop(200), 5, 43).sample.map((p) => p.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })
})
