import { describe, expect, it } from "vitest"
import {
  bucketize,
  computeCalibration,
  DEFAULT_UNDECIDED_FLOOR,
  formatReport,
  joinNoul,
  type Label,
  MIN_LABELLED_TOTAL,
  parseArgs,
  parseLabels,
  parseRun,
  refusalReasons,
  undecidedBand,
  wilson,
} from "./calibration.js"

// One predicted-probability group: `n` items at probability `prob`, of which the
// first `trues` are labelled true. ids are `${prob}#${index}`.
interface Group {
  prob: number
  n: number
  trues: number
}

function runWith(groups: Group[]): string {
  const kept = groups.flatMap((g) =>
    Array.from({ length: g.n }, (_, i) => ({
      id: `${g.prob}#${i}`,
      answers: { q: { type: "noul", noul: g.prob } },
    })),
  )
  return JSON.stringify({ kept, undecided: [] })
}

function labelsFor(groups: Group[]): Label[] {
  return groups.flatMap((g) =>
    Array.from({ length: g.n }, (_, i) => ({
      id: `${g.prob}#${i}`,
      question: "q",
      label: i < g.trues,
    })),
  )
}

describe("parseRun", () => {
  it("merges kept and undecided rows, since undecided ≈0.5 items must be scored", () => {
    const text = JSON.stringify({
      kept: [{ id: "a", answers: { q: { type: "noul", noul: 0.9 } } }],
      undecided: [{ id: "b", answers: { q: { type: "noul", noul: 0.5 } }, questions: ["q"] }],
    })
    expect(
      parseRun(text)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a", "b"])
  })

  it("unwraps the envelope `many --format json` prints", () => {
    const result = {
      kept: [{ id: "a", answers: { q: { type: "noul", noul: 0.9 } } }],
      undecided: [],
    }
    const text = JSON.stringify({ v: 1, ok: true, command: "many", result })
    expect(parseRun(text).map((r) => r.id)).toEqual(["a"])
  })

  it("accepts a bare array of rows", () => {
    const text = JSON.stringify([{ id: "a", answers: { q: { type: "noul", noul: 0.3 } } }])
    expect(parseRun(text)).toHaveLength(1)
  })

  it("dedupes by id and skips rows without id or answers", () => {
    const text = JSON.stringify([
      { id: "a", answers: { q: { type: "noul", noul: 0.3 } } },
      { id: "a", answers: { q: { type: "noul", noul: 0.9 } } },
      { answers: { q: { type: "noul", noul: 0.9 } } },
      { id: "c" },
    ])
    expect(parseRun(text).map((r) => r.id)).toEqual(["a"])
  })

  it("throws on a run with no usable rows", () => {
    expect(() => parseRun(JSON.stringify({ kept: [], undecided: [] }))).toThrow(/no rows/)
  })
})

describe("parseLabels", () => {
  it("reads JSONL, ignoring blank lines, keeping notes", () => {
    const text =
      '{"id":"a","question":"q","label":true,"note":"read it"}\n\n{"id":"b","question":"q","label":false}\n'
    const labels = parseLabels(text)
    expect(labels).toHaveLength(2)
    expect(labels[0]).toMatchObject({ id: "a", label: true, note: "read it" })
  })

  it("reports the offending line number on bad JSON", () => {
    expect(() => parseLabels('{"id":"a","question":"q","label":true}\nnot json\n')).toThrow(
      /line 2/,
    )
  })

  it("rejects a row missing a required field or with a non-boolean label", () => {
    expect(() => parseLabels('{"id":"a","question":"q","label":"yes"}')).toThrow(/line 1/)
    expect(() => parseLabels('{"id":"a","label":true}')).toThrow(/line 1/)
  })
})

describe("joinNoul", () => {
  const rows = parseRun(
    JSON.stringify([
      {
        id: "a",
        answers: {
          q: { type: "noul", noul: 0.8 },
          c: { type: "choice", choice: "x", probabilities: {}, confidence: 0.9 },
        },
      },
    ]),
  )

  it("pairs a label with its noul answer", () => {
    const { pairs, dropped } = joinNoul(rows, [{ id: "a", question: "q", label: true }])
    expect(pairs).toEqual([{ id: "a", question: "q", predicted: 0.8, actual: true }])
    expect(dropped).toEqual([])
  })

  it("drops labels that cannot join, with a reason each", () => {
    const { pairs, dropped } = joinNoul(rows, [
      { id: "missing", question: "q", label: true },
      { id: "a", question: "nope", label: true },
      { id: "a", question: "c", label: true },
    ])
    expect(pairs).toEqual([])
    expect(dropped.map((d) => d.reason)).toEqual(["unknown-id", "unknown-question", "not-noul"])
  })
})

describe("wilson", () => {
  it("returns the full interval for an empty sample", () => {
    expect(wilson(0, 0)).toEqual([0, 1])
  })

  it("stays within [0,1] and narrows as n grows", () => {
    const [lo10, hi10] = wilson(5, 10)
    const [lo100, hi100] = wilson(50, 100)
    expect(lo10).toBeGreaterThanOrEqual(0)
    expect(hi10).toBeLessThanOrEqual(1)
    expect(hi100 - lo100).toBeLessThan(hi10 - lo10)
  })

  it("is deterministic", () => {
    expect(wilson(3, 7)).toEqual(wilson(3, 7))
  })
})

describe("bucketize", () => {
  it("places 1.0 in the last bucket, not an eleventh", () => {
    const buckets = bucketize([{ id: "a", question: "q", predicted: 1, actual: true }])
    expect(buckets).toHaveLength(10)
    expect(buckets[9]?.n).toBe(1)
  })

  it("computes observed frequency per bucket", () => {
    const pairs = [
      { id: "1", question: "q", predicted: 0.72, actual: true },
      { id: "2", question: "q", predicted: 0.75, actual: true },
      { id: "3", question: "q", predicted: 0.78, actual: false },
    ]
    const b = bucketize(pairs)[7]
    expect(b?.n).toBe(3)
    expect(b?.observed).toBeCloseTo(2 / 3)
  })
})

describe("undecidedBand", () => {
  it("counts only pairs within floor/2 of 0.5", () => {
    const pairs = [
      { id: "1", question: "q", predicted: 0.5, actual: true },
      { id: "2", question: "q", predicted: 0.44, actual: false }, // in band at floor 0.15 → [0.425,0.575]
      { id: "3", question: "q", predicted: 0.2, actual: true }, // out of band
    ]
    const band = undecidedBand(pairs, DEFAULT_UNDECIDED_FLOOR)
    expect(band.n).toBe(2)
    expect(band.observed).toBeCloseTo(0.5)
  })
})

describe("refusal", () => {
  it("refuses when there are too few pairs", () => {
    const groups = [
      { prob: 0.1, n: 3, trues: 0 },
      { prob: 0.5, n: 3, trues: 1 },
      { prob: 0.9, n: 3, trues: 3 },
    ]
    const report = computeCalibration(parseRun(runWith(groups)), labelsFor(groups))
    expect(report.usable).toBe(false)
    expect(report.refusals.join(" ")).toMatch(/at least 30/)
    expect(formatReport(report)).toMatch(/NO CURVE/)
  })

  it("refuses a large but skewed sample where one bucket dominates", () => {
    const groups = [
      { prob: 0.9, n: 60, trues: 54 },
      { prob: 0.1, n: 10, trues: 1 },
    ]
    const report = computeCalibration(parseRun(runWith(groups)), labelsFor(groups))
    expect(report.totalPairs).toBe(70) // plenty of pairs, so smallness is not why
    expect(report.usable).toBe(false)
    expect(report.refusals.join(" ")).toMatch(/skewed/)
  })

  it("refuses when too few buckets reach the minimum count", () => {
    const groups = [{ prob: 0.5, n: 40, trues: 20 }]
    const report = computeCalibration(parseRun(runWith(groups)), labelsFor(groups))
    expect(report.usable).toBe(false)
    // one populated bucket, and it is 100% of pairs → both bucket-count and skew fire
    expect(report.refusals.length).toBeGreaterThanOrEqual(1)
  })
})

describe("a usable, well-spread sample", () => {
  // Each bucket's observed frequency is built to match its predicted probability.
  const groups = [
    { prob: 0.1, n: 10, trues: 1 },
    { prob: 0.3, n: 10, trues: 3 },
    { prob: 0.5, n: 10, trues: 5 },
    { prob: 0.7, n: 10, trues: 7 },
    { prob: 0.9, n: 10, trues: 9 },
  ]
  const report = computeCalibration(parseRun(runWith(groups)), labelsFor(groups))

  it("is usable and reports every populated bucket", () => {
    expect(report.usable).toBe(true)
    expect(report.refusals).toEqual([])
    expect(report.totalPairs).toBe(50)
    const populated = report.buckets.filter((b) => b.n > 0)
    expect(populated).toHaveLength(5)
  })

  it("observed frequency tracks the predicted bucket when calibrated", () => {
    const b70 = report.buckets[7]
    expect(b70?.observed).toBeCloseTo(0.7)
    const b90 = report.buckets[9]
    expect(b90?.observed).toBeCloseTo(0.9)
  })

  it("renders a curve, not a refusal", () => {
    const text = formatReport(report)
    expect(text).toMatch(/predicted/)
    expect(text).not.toMatch(/NO CURVE/)
    expect(text).toMatch(/undecided band/)
  })

  it("counts question shapes and flags choice/score as unmeasured", () => {
    const mixed = parseRun(
      JSON.stringify([
        {
          id: "a",
          answers: {
            q: { type: "noul", noul: 0.8 },
            dept: { type: "choice", choice: "x", probabilities: {}, confidence: 0.7 },
            sev: { type: "score", score: 1.2, confidence: 0.6 },
          },
        },
      ]),
    )
    const r = computeCalibration(mixed, [])
    expect(r.shapes).toMatchObject({ noul: 1, choice: 1, score: 1 })
    expect(formatReport(r)).toMatch(/choice\/score need a different label shape/)
  })
})

describe("parseArgs", () => {
  it("parses the required flags and defaults the floor", () => {
    const args = parseArgs(["--run", "r.json", "--labels", "l.jsonl"])
    expect(args).toEqual({
      run: "r.json",
      labels: "l.jsonl",
      floor: DEFAULT_UNDECIDED_FLOOR,
      json: false,
    })
  })

  it("accepts --floor and --json", () => {
    const args = parseArgs(["--run", "r", "--labels", "l", "--floor", "0.2", "--json"])
    expect(args.floor).toBe(0.2)
    expect(args.json).toBe(true)
  })

  it("rejects a missing run/labels, an unknown flag, and an out-of-range floor", () => {
    expect(() => parseArgs(["--run", "r"])).toThrow(/usage/)
    expect(() => parseArgs(["--run", "r", "--labels", "l", "--bogus"])).toThrow(/unknown/)
    expect(() => parseArgs(["--run", "r", "--labels", "l", "--floor", "2"])).toThrow(/floor/)
  })
})

it("MIN_LABELLED_TOTAL is the documented small-sample floor", () => {
  expect(MIN_LABELLED_TOTAL).toBe(30)
  expect(refusalReasons([], bucketize([]))).toContain(
    `only 0 labelled noul pairs; need at least 30`,
  )
})
