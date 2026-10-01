/**
 * `decide compare` (M11, plan m11-adopt D3): Jev against a baseline over the
 * same captured states, reduced to measured signals and written to
 * `.system1/compare/<spec>/report.json`.
 *
 * The baseline is the mechanism in place (`current`: its answers come from the
 * capture, no call is made) or an emulated chat model (`emulated[:<model>]`).
 * Only `state` is ever sent, through `prepareState` (scrub and size); the
 * capture's `current`, `output` and `usage` never leave the machine.
 *
 * Without labels the report names no winner: agreement is not correctness.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { BaselineClient } from "../baseline/client.js"
import {
  type BadLine,
  type CapturedRow,
  compareDir,
  compareFixturesDir,
  labelsPath,
  readCaptured,
  readLabels,
} from "../compare/capture.js"
import {
  type Accuracy,
  type Agreement,
  accuracy,
  agreement,
  type CostSignal,
  costSignal,
  type Disagreement,
  decisivenessByType,
  disagreements,
  type HeadToHead,
  headToHead,
  type LatencySignal,
  latencySignal,
  type Rate,
  type RowAnswers,
  undecidedShare,
} from "../compare/signals.js"
import { assertConsent } from "../config/consent.js"
import { allProfiles } from "../config/load.js"
import type { Unsaved } from "../decide.js"
import { DecisionsError, type ErrorCode, isDecisionsError, spentOf } from "../errors.js"
import {
  assertDecisionProfile,
  DEFAULT_EMULATED_ID,
  EMULATED_PREFIX,
  type ModelProfile,
  resolveProfile,
} from "../model/profiles.js"
import type { QuestionType, Usage } from "../model/types.js"
import { prepareState } from "../prepare-state.js"
import { checkBudget, type Projection, project } from "../run/budget.js"
import { mapWithConcurrency } from "../run/pool.js"
import { type AnswerSource, sumUsage } from "../run/spend.js"
import { loadSpec } from "../spec/spec.js"
import { baselineFor, checkInput, deciderFor, type ToolContext } from "./context.js"
import type { CompareInput } from "./schemas.js"

/** Ledger tag for both sides' calls, so a comparison's spend sums apart. */
export const COMPARE_TAG = "compare"
/** Disagreements listed in the report; the total is always given. */
const SAMPLE = 50

type SideSource = AnswerSource | "captured"

export interface CompareSide {
  model: string
  /** `captured`: the answers came from the capture, not from a call. */
  source: SideSource
  cost: CostSignal
  latency: LatencySignal
  /** Rows whose call failed, by error code. */
  failed: Partial<Record<ErrorCode | "error", number>>
}

export interface CompareReport {
  spec: string
  /** Where this report was written. */
  file: string
  captured: string
  generatedAt: string
  baselineKind: "current" | "emulated"
  jev: CompareSide
  baseline: CompareSide & {
    /** Rows whose answers parsed strictly into the question set's answer space. */
    parsed: Rate
  }
  rows: {
    /** Rows in the capture, after `limit`. */
    captured: number
    /** Rows both sides answered. */
    compared: number
    /** Capture lines left out, with why: the first 20. */
    invalid: BadLine[]
    /** How many capture lines were left out, in the whole file. */
    invalidTotal: number
    /** States never sent: too large for the model, or not a valid state. */
    withheld: Array<{ id: string; reason: string }>
  }
  signals: {
    agreement: Agreement
    decisiveness: Partial<Record<QuestionType, { jev: number | null; baseline: number | null }>>
    /** Jev's answers too flat to act on. A single value has no spread, so the baseline has none. */
    undecidedShare: Rate
  }
  labels: null | {
    file: string
    /** Labelled rows that were compared. */
    matched: number
    /** Label ids with no compared row. */
    unmatched: number
    invalid: BadLine[]
    invalidTotal: number
    /** Each side's accuracy over what it answered: rates on different sets. */
    accuracy: { jev: Accuracy; baseline: Accuracy }
    /** Both sides over the same labelled answers: what `winner` is decided on. */
    headToHead: HeadToHead
  }
  /**
   * With labels: the side right more often over the labelled answers both
   * gave (`labels.headToHead`), or `tie`; null when there are none. Null
   * without labels, always: agreement can't say who is right.
   */
  winner: "jev" | "baseline" | "tie" | null
  verdict: string
  disagreements: { total: number; sample: Disagreement[] }
  /** Measured spend of this run's calls, both sides. Zero on replay. */
  usage: Usage
  /** Spend lines or recorded answers that couldn't be written. */
  unsaved?: Unsaved[]
  /** Set when report.json couldn't be written; the report is still returned. */
  reportUnsaved?: string
}

export interface CompareDryRun {
  spec: string
  dryRun: true
  baselineKind: "current" | "emulated"
  rows: {
    captured: number
    invalid: BadLine[]
    invalidTotal: number
    withheld: Array<{ id: string; reason: string }>
  }
  projection: { jev: Projection; baseline: Projection | null; total: Projection }
}

export type CompareResult = CompareReport | CompareDryRun

/** `current`, `emulated` or `emulated:<model>` as a baseline profile (or none, for current). */
function baselineProfile(ctx: ToolContext, text: string): ModelProfile | undefined {
  if (text === "current") return undefined
  const id =
    text === "emulated" ? DEFAULT_EMULATED_ID : text.startsWith(EMULATED_PREFIX) ? text : undefined
  if (!id)
    throw new DecisionsError(
      "invalid-request",
      `Unknown baseline "${text}". Use: current, emulated or emulated:<model>`,
    )
  const profile = resolveProfile(id, allProfiles(ctx.config))
  if (profile.transport !== "openrouter-chat")
    throw new DecisionsError("invalid-request", `${id} is not an emulated baseline`)
  return profile
}

function sumProjections(parts: Projection[]): Projection {
  return {
    basis: "projected",
    calls: parts.reduce((n, p) => n + p.calls, 0),
    estimatedInputTokens: parts.reduce((n, p) => n + p.estimatedInputTokens, 0),
    projectedUsd: parts.reduce((n, p) => n + p.projectedUsd, 0),
    // The oldest price any part used.
    priceAsOf: parts.map((p) => p.priceAsOf).sort()[0] ?? "unknown",
  }
}

export async function runCompare(ctx: ToolContext, rawInput: unknown): Promise<CompareResult> {
  const input = checkInput<CompareInput>("compare", rawInput)
  const spec = loadSpec(input.spec, ctx.specDirs, ctx.cwd)
  const { questions } = spec
  const root = ctx.config.repoRoot
  const jevProfile = resolveProfile(input.model ?? ctx.config.model, allProfiles(ctx.config))
  assertDecisionProfile(jevProfile)
  const emulated = baselineProfile(ctx, input.baseline ?? "current")
  const baselineKind = emulated ? "emulated" : "current"

  const dir = compareDir(root, spec.name)
  const capturedFile = join(dir, "captured.jsonl")
  const read = readCaptured(capturedFile, questions)
  const rows = input.limit !== undefined ? read.rows.slice(0, input.limit) : read.rows
  if (rows.length === 0)
    throw new DecisionsError(
      "source-error",
      `${capturedFile} has no usable rows${read.bad.length ? ` (${read.bad.length} invalid)` : ""}.`,
      { path: capturedFile, invalid: read.bad.slice(0, 20) },
    )

  // Only the state is sent: scrubbed and sized for each side's profile.
  type Ready = { row: CapturedRow; state: CapturedRow["state"]; tokens: number }
  const ready: Ready[] = []
  const withheld: Array<{ id: string; reason: string }> = []
  for (const row of rows) {
    try {
      const sizes = [jevProfile, ...(emulated ? [emulated] : [])].map((profile) =>
        prepareState(row.state, { questions, profile, id: row.id }),
      )
      const jevSide = sizes[0] as ReturnType<typeof prepareState>
      ready.push({ row, state: jevSide.state, tokens: jevSide.tokens })
    } catch (error) {
      // A state too large is that row's problem; anything else is the run's.
      if (!isDecisionsError(error) || error.code !== "state-too-large") throw error
      withheld.push({ id: row.id, reason: error.message.split("\n")[0] ?? error.code })
    }
  }

  const tokens = ready.map((r) => r.tokens)
  const jevProjection = project(jevProfile, tokens)
  const baseProjection = emulated ? project(emulated, tokens) : null
  const total = sumProjections([jevProjection, ...(baseProjection ? [baseProjection] : [])])
  const invalid = read.bad.slice(0, 20)
  if (input.dryRun) {
    return {
      spec: spec.name,
      dryRun: true,
      baselineKind,
      rows: { captured: rows.length, invalid, invalidTotal: read.bad.length, withheld },
      projection: { jev: jevProjection, baseline: baseProjection, total },
    }
  }

  const mode = input.mode ?? "auto"
  // Beside the capture, not with the spec's committed fixtures: these hold its raw inputs.
  const recorded = {
    tag: COMPARE_TAG,
    fixturesDir: compareFixturesDir(ctx.config.repoRoot, spec.name),
  }
  const decider = deciderFor(ctx, jevProfile, mode, recorded)
  const client: BaselineClient | undefined = emulated
    ? baselineFor(ctx, emulated, mode, recorded)
    : undefined
  const live = decider.mode !== "replay" || (client && client.mode !== "replay")
  if (live) {
    assertConsent(ctx.config.egress.consent, root)
    // Refused before Jev spends anything, not on the baseline's first call.
    if (
      emulated &&
      client?.mode !== "replay" &&
      !ctx.config.egress.allowProfiles.some((g) => g.id === emulated.id)
    )
      throw new DecisionsError(
        "profile-not-allowed",
        `This repo hasn't allowed ${emulated.id} to receive its content. The user allows it with \`decide config egress allow-profile ${emulated.id}\`.`,
        { model: emulated.id },
      )
    // 0011: one guard over both sides' calls together.
    checkBudget(total, ctx.config.budget, input.confirm ?? false)
  }

  const namespace = spec.name
  const settled = await mapWithConcurrency(
    ready,
    ctx.config.concurrency,
    async ({ row, state }) => {
      const [jev, base] = await Promise.allSettled([
        decider.decide({ state, questions, namespace }),
        client ? client.answer({ state, questions, namespace }) : Promise.resolve(undefined),
      ])
      return { row, jev, base }
    },
  )

  const answered: RowAnswers[] = []
  const jevUsage: Array<Usage | undefined> = []
  const jevLatency: number[] = []
  const baseUsage: Array<Usage | undefined> = []
  const baseLatency: Array<number | undefined> = []
  const measured: Usage[] = []
  const unsaved: Unsaved[] = []
  const jevFailed: CompareSide["failed"] = {}
  const baseFailed: CompareSide["failed"] = {}
  let parsedOk = 0
  let parsedOf = 0
  let misses = 0
  // A failed call that may have been billed still counts toward its side's cost.
  const fail = (into: CompareSide["failed"], usages: Array<Usage | undefined>, error: unknown) => {
    const code = isDecisionsError(error) ? error.code : "error"
    if (code === "replay-miss") misses += 1
    into[code] = (into[code] ?? 0) + 1
    const spent = spentOf(error)
    if (spent) {
      usages.push(spent.usage)
      measured.push(spent.usage)
    }
  }
  for (const outcome of settled) {
    // The worker never throws: both calls are settled inside it.
    if (!("value" in outcome)) throw outcome.error
    const { row, jev, base } = outcome.value
    const answers: RowAnswers = { id: row.id }
    if (jev.status === "fulfilled") {
      const r = jev.value
      answers.jev = { answers: r.answers, undecided: r.undecided }
      measured.push(r.usage)
      unsaved.push(...(r.unsaved ?? []))
      if (r.source === "live") {
        jevUsage.push(r.usage)
        jevLatency.push(r.latencyMs)
      }
    } else fail(jevFailed, jevUsage, jev.reason)

    if (!client) {
      parsedOf += 1
      if (row.current) {
        parsedOk += 1
        answers.baseline = row.current
      }
      baseUsage.push(row.usage)
      baseLatency.push(row.latencyMs)
    } else if (base.status === "fulfilled" && base.value) {
      const r = base.value
      parsedOf += 1
      if (r.answers) {
        parsedOk += 1
        answers.baseline = r.answers
      }
      measured.push(r.usage)
      unsaved.push(...(r.unsaved ?? []))
      if (r.source === "live") {
        baseUsage.push(r.usage)
        baseLatency.push(r.latencyMs)
      }
    } else if (base.status === "rejected") fail(baseFailed, baseUsage, base.reason)
    answered.push(answers)
  }
  if (misses > 0)
    throw new DecisionsError(
      "replay-miss",
      `${misses} answers for "${spec.name}" have no recording. Run \`decide compare ${spec.name} --record\` (a key, repo consent${emulated ? ", and the allowed baseline" : ""}) to record them.`,
      { misses },
    )

  const labelsFile = labelsPath(root, spec.name)
  const labelled = readLabels(labelsFile, questions)
  if (labelled)
    for (const a of answered) {
      const label = labelled.byId.get(a.id)
      if (label) a.label = label
    }
  const compared = answered.filter((a) => a.jev && a.baseline)
  const signals = {
    agreement: agreement(questions, answered),
    decisiveness: decisivenessByType(questions, answered),
    undecidedShare: undecidedShare(questions, answered),
  }
  let labels: CompareReport["labels"] = null
  let winner: CompareReport["winner"] = null
  let verdict: string
  if (labelled) {
    const ids = new Set(answered.map((a) => a.id))
    const acc = {
      jev: accuracy(questions, answered, "jev"),
      baseline: accuracy(questions, answered, "baseline"),
    }
    labels = {
      file: labelsFile,
      matched: answered.filter((a) => a.label).length,
      unmatched: [...labelled.byId.keys()].filter((id) => !ids.has(id)).length,
      invalid: labelled.bad.slice(0, 20),
      invalidTotal: labelled.bad.length,
      accuracy: acc,
      headToHead: headToHead(questions, answered),
    }
    const h = labels.headToHead
    const j = acc.jev.overall
    const bu = acc.baseline.overall.unanswered
    if (h.n === 0) {
      verdict =
        "Labels exist, but no labelled question was answered by both sides (Jev decided): no winner."
    } else {
      winner = h.jev > h.baseline ? "jev" : h.baseline > h.jev ? "baseline" : "tie"
      const pct = (hits: number) => `${((hits / h.n) * 100).toFixed(1)}%`
      verdict =
        `On the ${h.n} labelled answers both sides gave, Jev was right on ${pct(h.jev)} and the ` +
        `${baselineKind} baseline on ${pct(h.baseline)} (${winner === "tie" ? "a tie" : `${winner} ahead`}). ` +
        (j.unanswered + bu > 0
          ? `Left out: ${j.unanswered} labelled answers Jev didn't give (undecided or failed) and ${bu} the baseline didn't (failed or unparsed). `
          : "") +
        "Small samples move a lot: read n before acting."
    }
  } else {
    verdict =
      `No labels (${labelsFile}), so no winner: agreement says where the two differ, not which is right. ` +
      "Label some rows to measure accuracy."
  }

  const all = disagreements(questions, answered)
  const report: CompareReport = {
    spec: spec.name,
    file: join(dir, "report.json"),
    captured: capturedFile,
    generatedAt: new Date().toISOString(),
    baselineKind,
    jev: {
      model: jevProfile.id,
      source: decider.mode === "replay" ? "replay" : "live",
      cost: costSignal(jevUsage),
      latency: latencySignal(jevLatency),
      failed: jevFailed,
    },
    baseline: {
      model: emulated?.id ?? "current",
      source: client ? (client.mode === "replay" ? "replay" : "live") : "captured",
      cost: costSignal(baseUsage),
      latency: latencySignal(baseLatency),
      failed: baseFailed,
      parsed: { n: parsedOf, hits: parsedOk, rate: parsedOf > 0 ? parsedOk / parsedOf : null },
    },
    rows: {
      captured: rows.length,
      compared: compared.length,
      invalid,
      invalidTotal: read.bad.length,
      withheld,
    },
    signals,
    labels,
    winner,
    verdict,
    disagreements: { total: all.length, sample: all.slice(0, SAMPLE) },
    usage: sumUsage(measured),
    ...(unsaved.length ? { unsaved } : {}),
  }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(report.file, `${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    // The calls are paid for: the report is returned whether or not it was kept.
    report.reportUnsaved = (error as NodeJS.ErrnoException).code ?? String(error)
  }
  return report
}
