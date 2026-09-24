import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs } from "../testkit/tmp.js"
import {
  type Backlog,
  backlogProblems,
  type Candidate,
  mergeCandidates,
  opportunityId,
  parseRecordFilter,
  parseRecordSort,
  projectedSaving,
  readBacklog,
  recordMatches,
  writeBacklog,
} from "./backlog.js"

const temp = useTempDirs()
const EMPTY: Backlog = { version: 1, opportunities: [] }

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    mode: "code",
    location: { path: "src/route.ts", lines: { start: 10, end: 40 } },
    mechanism: "regex list classifying prompt intent",
    shape: "single",
    evidence: "const TRIGGERS = [/\\b(classify|triage)\\b/]",
    questions: {
      intent: { type: "noul", instructions: "The prompt asks for a verdict per item." },
    },
    projected: {
      volume: 200,
      per: "day",
      currentCostPerItemUsd: 0.002,
      decisionCostPerItemUsd: 0.00003,
    },
    risk: { level: "low", note: "a miss only skips a hint" },
    next: "save the spec with design",
    source: { sweep: "sweep-1", answers: "live" },
    ...over,
  }
}

describe("opportunity ids", () => {
  it("depend on mode and whitespace-normalised evidence, not on the path", () => {
    const a = opportunityId("code", "if (x)\n   return  y")
    expect(a).toMatch(/^op-[0-9a-f]{12}$/)
    expect(opportunityId("code", "  if (x) return y ")).toBe(a)
    expect(opportunityId("agents", "if (x) return y")).not.toBe(a)
  })
})

describe("projectedSaving", () => {
  it("is volume × (current − decision), negative when the decision costs more", () => {
    expect(projectedSaving(candidate().projected)).toBe(0.394)
    expect(
      projectedSaving({
        volume: 10,
        per: "run",
        currentCostPerItemUsd: 0,
        decisionCostPerItemUsd: 0.001,
      }),
    ).toBe(-0.01)
  })
})

describe("mergeCandidates", () => {
  it("adds new entries as projected, with the saving computed and timestamps set", () => {
    const { backlog, added } = mergeCandidates(EMPTY, [candidate()], "2026-09-24T00:00:00.000Z")
    expect(added).toHaveLength(1)
    expect(backlog.opportunities[0]).toMatchObject({
      status: "new",
      projected: { basis: "projected", savingUsd: 0.394 },
      firstSeenAt: "2026-09-24T00:00:00.000Z",
      seenAt: "2026-09-24T00:00:00.000Z",
    })
    expect(backlogProblems(backlog)).toEqual([])
  })

  it("keeps the id and firstSeenAt when the same evidence moves to another file", () => {
    const first = mergeCandidates(EMPTY, [candidate()], "t1").backlog
    const moved = candidate({ location: { path: "src/routing/route.ts" } })
    const { backlog, added, updated, staled } = mergeCandidates(first, [moved], "t2")
    expect({ added, staled }).toEqual({ added: [], staled: [] })
    expect(updated).toEqual([first.opportunities[0]?.id])
    expect(backlog.opportunities).toHaveLength(1)
    expect(backlog.opportunities[0]).toMatchObject({
      location: { path: "src/routing/route.ts" },
      firstSeenAt: "t1",
      seenAt: "t2",
    })
  })

  it("marks a new entry stale when its path is re-swept and its evidence changed", () => {
    const first = mergeCandidates(EMPTY, [candidate()], "t1").backlog
    const changed = candidate({ evidence: "const TRIGGERS = loadTriggers()" })
    const { backlog, added, staled } = mergeCandidates(first, [changed], "t2")
    expect(added).toHaveLength(1)
    expect(staled).toEqual([first.opportunities[0]?.id])
    expect(backlog.opportunities.map((o) => o.status).sort()).toEqual(["new", "stale"])
  })

  it("never stales an entry at a path the add didn't cover, or one already decided", () => {
    const first = mergeCandidates(
      EMPTY,
      [candidate(), candidate({ evidence: "x", status: "rejected", statusReason: "a baseline" })],
      "t1",
    ).backlog
    const other = candidate({ location: { path: "src/other.ts" }, evidence: "other" })
    expect(mergeCandidates(first, [other], "t2").staled).toEqual([])
    const again = candidate({ evidence: "changed" })
    const { staled } = mergeCandidates(first, [again], "t3")
    expect(staled).toHaveLength(1) // the `new` one, not the rejected one
  })

  it("keeps a rejection, and its reason, across a re-sweep that gives no status", () => {
    const rejected = candidate({
      status: "rejected",
      statusReason: "kept on purpose as a baseline",
    })
    const first = mergeCandidates(EMPTY, [rejected], "t1").backlog
    const { backlog } = mergeCandidates(first, [candidate()], "t2")
    expect(backlog.opportunities[0]).toMatchObject({
      status: "rejected",
      statusReason: "kept on purpose as a baseline",
    })
    const reopened = mergeCandidates(backlog, [candidate({ status: "new" })], "t3").backlog
    expect(reopened.opportunities[0]?.status).toBe("new")
    expect(reopened.opportunities[0]).not.toHaveProperty("statusReason")
  })

  it("refuses a rejection with no reason, and a bad question set", () => {
    expect(() => mergeCandidates(EMPTY, [candidate({ status: "rejected" })], "t")).toThrow(
      /statusReason is required/,
    )
    expect(() =>
      mergeCandidates(
        EMPTY,
        [
          candidate({
            questions: { q: { type: "choice", instructions: "x", criteria: { a: "only" } } },
          }),
        ],
        "t",
      ),
    ).toThrow(/choice criteria/)
  })
})

describe("the backlog file", () => {
  it("reads a missing file as empty, and round-trips what it writes", () => {
    const file = join(temp({}), ".system1/opportunities.json")
    expect(readBacklog(file)).toEqual(EMPTY)
    const { backlog } = mergeCandidates(EMPTY, [candidate()], "t")
    writeBacklog(file, backlog)
    expect(readBacklog(file)).toEqual(backlog)
  })

  it("reports a malformed file with every problem, and leaves it untouched", () => {
    const file = join(temp({}), "opportunities.json")
    const { backlog } = mergeCandidates(EMPTY, [candidate()], "t")
    const tampered = structuredClone(backlog)
    const [entry] = tampered.opportunities
    if (!entry) throw new Error("no entry")
    entry.projected.savingUsd = 99
    entry.evidence = "edited by hand"
    const text = JSON.stringify(tampered)
    writeFileSync(file, text)
    expect(() => readBacklog(file)).toThrow(/does not match its mode and evidence/)
    expect(() => readBacklog(file)).toThrow(/savingUsd does not match its inputs/)
    expect(readFileSync(file, "utf8")).toBe(text)
    writeFileSync(file, "{not json")
    expect(() => readBacklog(file)).toThrow(/not JSON/)
  })
})

describe("record filters", () => {
  const [o] = mergeCandidates(EMPTY, [candidate()], "t").backlog.opportunities
  if (!o) throw new Error("no entry")

  it("default bare object fields to their natural sub-field", () => {
    expect(recordMatches(o, parseRecordFilter("risk=low"))).toBe(true)
    expect(recordMatches(o, parseRecordFilter("projected>=0.3"))).toBe(true)
    expect(recordMatches(o, parseRecordFilter("projected.volume<100"))).toBe(false)
    expect(recordMatches(o, parseRecordFilter("status in new,stale"))).toBe(true)
    expect(recordMatches(o, parseRecordFilter("location=src/route.ts"))).toBe(true)
    expect(parseRecordSort("seenAt:asc")).toEqual({ field: "seenAt", direction: "asc" })
  })

  it("rejects unknown fields and non-numeric comparisons", () => {
    expect(() => parseRecordFilter("colour=red")).toThrow(/no field "colour"/)
    expect(() => parseRecordFilter("status>=new")).toThrow(/needs a number/)
    expect(() => parseRecordFilter("status")).toThrow(/Cannot parse/)
  })
})
