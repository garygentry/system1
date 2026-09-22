import { assertConsent } from "../config/consent.js"
import { allProfiles } from "../config/load.js"
import { DecisionsError, isDecisionsError } from "../errors.js"
import { resolveProfile } from "../model/profiles.js"
import type { Answers, Usage } from "../model/types.js"
import { type Prepared, prepare } from "../prepare.js"
import { checkBudget, project } from "../run/budget.js"
import { type AnswerSource, sumUsage } from "../run/spend.js"
import { parseFileRef } from "../sources/read.js"
import type { SourceSpec } from "../sources/types.js"
import { describeExpectation, type Expectation, meets, parseExpect } from "../spec/expect.js"
import { loadSpec } from "../spec/spec.js"
import { parseSplit } from "../split/split.js"
import { checkInput, deciderFor, type ToolContext } from "./context.js"
import { type SkippedSummary, summariseSkipped } from "./many.js"
import type { SpecCheckInput } from "./schemas.js"

export type ExampleStatus = "pass" | "fail" | "undecided" | "captured" | "withheld"

export interface ExampleResult {
  id: string
  /**
   * - `pass`: every expectation met.
   * - `fail`: at least one decided answer missed its expectation.
   * - `undecided`: nothing failed, but an expected question came back too flat to judge.
   * - `captured`: the example has no `expect`; its answers are shown for reading.
   * - `withheld`: egress checks kept it from being sent (e.g. an excluded file).
   */
  status: ExampleStatus
  /** Full answers, distributions included: reading them is the point. */
  answers?: Answers
  failures?: Array<{ question: string; expected: string }>
  undecided?: string[]
  reason?: string
}

export interface SpecCheckResult {
  spec: string
  file: string
  model: string
  source: AnswerSource
  /** True when every example passed, or was captured with nothing to check. */
  passed: boolean
  counts: Record<ExampleStatus, number> & { examples: number }
  examples: ExampleResult[]
  usage: Usage
  skipped: SkippedSummary
}

/**
 * Run a spec's examples and compare each against its `expect`. Replay by
 * default: this is an offline regression test for a spec and the fixtures
 * committed beside it. `mode: "record"` captures fresh answers.
 *
 * A mismatch is a result (`passed: false`), not an error. Errors are reserved
 * for a spec that cannot be checked: no examples, or answers never recorded.
 */
export async function runSpecCheck(ctx: ToolContext, rawInput: unknown): Promise<SpecCheckResult> {
  const input = checkInput<SpecCheckInput>("spec-check", rawInput)
  const spec = loadSpec(input.spec, ctx.specDirs, ctx.cwd)
  const examples = spec.examples ?? []
  if (examples.length === 0) {
    throw new DecisionsError(
      "invalid-request",
      `Spec "${spec.name}" has no examples to check. Add some under examples: (id, state or file, expect).`,
    )
  }
  const profile = resolveProfile(input.model ?? ctx.config.model, allProfiles(ctx.config))

  const prepared: Array<{ id: string; expect: Record<string, Expectation>; prep: Prepared }> = []
  for (const example of examples) {
    const source: SourceSpec =
      example.file !== undefined
        ? { kind: "file", ...parseFileRef(example.file) }
        : { kind: "text", text: example.state ?? "", id: example.id }
    prepared.push({
      id: example.id,
      expect: example.expect ? parseExpect(example.expect, spec.questions, example.id) : {},
      prep: await prepare({
        sources: [source],
        split: parseSplit("file"),
        questions: spec.questions,
        profile,
        cwd: ctx.config.repoRoot,
        exclude: ctx.config.egress.exclude,
      }),
    })
  }

  const decider = deciderFor(ctx, profile, input.mode ?? "replay")
  if (decider.mode !== "replay") {
    assertConsent(ctx.config.egress.consent, ctx.config.repoRoot)
    const tokens = prepared.map((p) => p.prep.projection.estimatedInputTokens)
    checkBudget(project(profile, tokens), ctx.config.budget, input.confirm ?? false)
  }

  const results: ExampleResult[] = []
  const usages: Usage[] = []
  let misses = 0
  for (const { id, expect, prep } of prepared) {
    const [item, ...rest] = prep.items
    if (!item || rest.length > 0) {
      const why = prep.skipped[0]
      results.push({
        id,
        status: "withheld",
        reason: why ? `${why.path} ${why.reason}` : `gave ${prep.items.length} states, not 1`,
      })
      continue
    }
    try {
      const r = await decider.decide({
        state: item.state,
        questions: spec.questions,
        namespace: spec.name,
      })
      usages.push(r.usage)
      results.push(judge(id, r.answers, r.undecided, expect))
    } catch (error) {
      if (isDecisionsError(error) && error.code === "replay-miss") {
        misses += 1
        continue
      }
      throw error
    }
  }

  if (misses > 0) {
    throw new DecisionsError(
      "replay-miss",
      `${misses} of ${examples.length} examples of "${spec.name}" have no recorded answer. Record them with \`decide spec check ${spec.name} --live\` (needs a key and repo consent).`,
      { misses },
    )
  }

  const counts = {
    examples: results.length,
    pass: 0,
    fail: 0,
    undecided: 0,
    captured: 0,
    withheld: 0,
  }
  for (const r of results) counts[r.status] += 1
  return {
    spec: spec.name,
    file: spec.file,
    model: profile.id,
    source: decider.mode === "replay" ? "replay" : "live",
    passed: counts.fail === 0 && counts.undecided === 0 && counts.withheld === 0,
    counts,
    examples: results,
    usage: sumUsage(usages),
    skipped: summariseSkipped(prepared.flatMap((p) => p.prep.skipped)),
  }
}

function judge(
  id: string,
  answers: Answers,
  flat: string[],
  expect: Record<string, Expectation>,
): ExampleResult {
  const entries = Object.entries(expect)
  if (entries.length === 0) {
    return { id, status: "captured", answers, ...(flat.length ? { undecided: flat } : {}) }
  }
  const failures: NonNullable<ExampleResult["failures"]> = []
  const undecided: string[] = []
  for (const [question, expectation] of entries) {
    const answer = answers[question]
    const isFlat = flat.includes(question)
    if (expectation.kind === "undecided") {
      if (!isFlat) failures.push({ question, expected: "undecided" })
    } else if (isFlat) {
      undecided.push(question)
    } else if (!answer || !meets(question, answer, expectation)) {
      failures.push({ question, expected: describeExpectation(expectation) })
    }
  }
  const status: ExampleStatus = failures.length ? "fail" : undecided.length ? "undecided" : "pass"
  return {
    id,
    status,
    answers,
    ...(failures.length ? { failures } : {}),
    ...(undecided.length ? { undecided } : {}),
  }
}
