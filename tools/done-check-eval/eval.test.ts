import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  expected,
  grade,
  loadMessages,
  loadScenarios,
  messageCard,
  namedInBlock,
  type Run,
  runMessages,
  runScenario,
  type SetName,
} from "./run.js"

/**
 * The labelled stop events (M10 §8), replayed from their recorded answers: no
 * key, no network. A change to done-check that changes what it sends misses
 * the fixtures and fails here; re-record with `pnpm eval:done-check --record`
 * (and `--holdout`), then read the scorecard before committing.
 */
const results = (set: SetName) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, set === "holdout" ? "holdout-results.json" : "results.json"),
      "utf8",
    ),
  ) as Array<Pick<Run, "id" | "outcome" | "named" | "calls">>

for (const set of ["scenarios", "holdout"] as const) {
  describe(`done-check eval: ${set}`, () => {
    const scenarios = loadScenarios(set)
    const recorded = results(set)

    it("has a recorded result for every scenario", () => {
      expect(recorded.map((r) => r.id).sort()).toEqual(scenarios.map((s) => s.id).sort())
    })

    it("gives every scenario the agent's last message", () => {
      const missing = scenarios.filter((s) => typeof s.message !== "string" || !s.message.trim())
      expect(missing.map((s) => s.id)).toEqual([])
    })

    for (const s of scenarios) {
      it.concurrent(`${s.id}: replays as recorded, and never blocks wrongly`, async () => {
        const run = await runScenario(s, { mode: "replay" })
        expect(run.message, "a replay miss: re-record").not.toContain("not checked")
        const want = recorded.find((r) => r.id === s.id)
        expect({ outcome: run.outcome, named: run.named }).toEqual({
          outcome: want?.outcome,
          named: want?.named,
        })
        expect(grade(s, run.outcome, run.named, run.message)).not.toBe("false-block")
      })
    }
  })
}

describe("done-check eval: the acceptance cases", () => {
  const all = loadScenarios()
  const recorded = results("scenarios")
  const outcome = (id: string) => recorded.find((r) => r.id === id)
  const scenario = (id: string) => {
    const s = all.find((x) => x.id === id)
    if (!s) throw new Error(`no scenario ${id}`)
    return s
  }

  it("lets a done task through and blocks a not-done one, naming the criterion", () => {
    expect(outcome("expiry-done")?.outcome).toBe("allow")
    for (const id of [
      "expiry-readme-missing",
      "commit-readme-missing",
      "untracked-stub",
      "criteria-ticked",
    ]) {
      expect(outcome(id), id).toMatchObject({
        outcome: "block",
        named: expected(scenario(id)).unmet,
      })
    }
  })

  it("never blocks on unjudgeable or exact-fact criteria", () => {
    for (const id of ["unjudgeable-with-done", "unjudgeable-others", "exact-facts"]) {
      expect(outcome(id)?.outcome, id).toBe("allow")
    }
  })

  it("sends nothing on a stop with no change", () => {
    expect(outcome("question-before-starting")).toMatchObject({ outcome: "allow", calls: 0 })
  })

  it("lets a stop that asks the user something through, sending at most the message", () => {
    for (const s of all.filter((x) => x.kind === "question")) {
      expect(outcome(s.id)?.outcome, s.id).toBe("allow")
      expect(outcome(s.id)?.calls, s.id).toBeLessThanOrEqual(1)
    }
  })
})

describe("namedInBlock", () => {
  it("reads the unmet list of a block reason", () => {
    const reason = [
      "System 1 done-check: these criteria look unmet by this session's change:",
      "- a",
      "- b",
      "Finish them, or say why they don't apply. The next stop is allowed.",
      "Not settled by the check:",
      "- c (the model was unsure)",
    ].join("\n")
    expect(namedInBlock(reason)).toEqual(["a", "b"])
  })
})

/**
 * The question check alone, replayed. Its bar is set so that no completion is
 * skipped: a skipped completion is a stop never checked. The blind holdout was
 * run once, after the bar was fixed.
 */
for (const set of ["messages", "holdout"] as const) {
  describe(`done-check question check: ${set === "messages" ? "fitted" : "blind holdout"}`, () => {
    it("replays every message, and skips no completion", async () => {
      const runs = await runMessages(set, { mode: "replay" })
      expect(runs.map((r) => r.id)).toEqual(loadMessages(set).map((m) => m.id))
      const card = messageCard(runs)
      expect(card.completions.skipped).toEqual([])
      expect(card.questions.skipped.length).toBeGreaterThanOrEqual(set === "messages" ? 16 : 17)
    })
  })
}
