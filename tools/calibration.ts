/**
 * Calibration scoring: given a recorded sweep and hand-labelled ground truth,
 * measure how well the model's `noul` probabilities match reality.
 *
 *   tsx tools/calibration.ts --run <many.json> --labels <labels.jsonl>
 *   tsx tools/calibration.ts --run r.json --labels l.jsonl --json   # machine output
 *   tsx tools/calibration.ts --run r.json --labels l.jsonl --floor 0.2
 *
 * This is a script, not a shipped command (M7 D2): `decide calibrate` is a cut
 * feature. It is offline, deterministic and tested — no network, no key, no
 * randomness, no clock. It reads the JSON that `decide many --format json`
 * writes (no `--keep`, so every item is recorded) plus a JSONL of labels, and
 * reports a reliability curve for the `noul` questions.
 *
 * **It refuses rather than mislead.** A curve built from a handful of rows, or
 * from rows all piled in one probability bucket, launders a guess into a number
 * (M7-evidence.md §1). When the sample is too small or too skewed the script
 * prints the diagnosis and exits non-zero WITHOUT printing a curve, instead of
 * printing one with a caveat nobody reads (§2).
 *
 * `choice` and `score` need a different label shape (the true option / the true
 * level, not a boolean) and are out of scope for this pass; the script counts
 * how many such answers the run holds and says they are unmeasured here.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * Jev's undecided floor, mirrored from `@garygentry/system1-core`
 * (`DEFAULT_UNDECIDED_FLOOR`). Copied, not imported, because this script reads
 * serialized JSON and must not drag the engine's module graph into an offline
 * tool. A noul is "undecided" when its confidence — `|noul − 0.5| × 2` — is at
 * or below the floor, i.e. the noul sits within `floor / 2` of 0.5.
 */
export const DEFAULT_UNDECIDED_FLOOR = 0.15

/** 95% two-sided normal quantile, for Wilson intervals. Fixed, so runs are deterministic. */
const Z = 1.96

/** Bucket width across [0, 1]. Ten buckets: [0,0.1), … , [0.9,1.0]. */
export const BUCKET_WIDTH = 0.1

// --- Refusal thresholds (documented so the doc can cite them, not taste) -----

/** Below this many labelled noul pairs, no curve: too little to say anything. */
export const MIN_LABELLED_TOTAL = 30
/** A bucket "counts" toward coverage only at this many pairs or more. */
export const MIN_BUCKET_N = 5
/** Fewer than this many populated buckets and the curve has no shape to report. */
export const MIN_POPULATED_BUCKETS = 3
/** If one bucket holds more than this share of all pairs, the sample is too skewed. */
export const MAX_BUCKET_SHARE = 0.7

// --- Shapes we read (a subset of the `many` result / core answer types) ------

type AnswerJson = { type: string } & Record<string, unknown>
interface RunRow {
  id: string
  answers: Record<string, AnswerJson>
}

/** One hand-assigned ground truth: proposition `question` on item `id` is true/false. */
export interface Label {
  id: string
  question: string
  label: boolean
  note?: string
}

/** A predicted probability paired with its observed truth. */
export interface Pair {
  id: string
  question: string
  predicted: number
  actual: boolean
}

export interface Bucket {
  /** Inclusive lower, exclusive upper — except the last, which includes 1.0. */
  lo: number
  hi: number
  n: number
  /** Observed fraction true. `null` when the bucket is empty. */
  observed: number | null
  /** Wilson 95% interval for `observed`. `null` when empty. */
  interval: [number, number] | null
}

export interface UndecidedBand {
  floor: number
  lo: number
  hi: number
  n: number
  observed: number | null
}

export interface QuestionShapes {
  noul: number
  choice: number
  score: number
  /** Answer types this run holds that this script does not measure. */
  unmeasured: string[]
}

export interface DroppedLabel {
  label: Label
  reason: "unknown-id" | "unknown-question" | "not-noul" | "bad-label"
}

export interface CalibrationReport {
  /** Whether the sample is large and spread enough to report a curve. */
  usable: boolean
  /** Why not, when `usable` is false. Empty when usable. */
  refusals: string[]
  totalPairs: number
  buckets: Bucket[]
  undecidedBand: UndecidedBand
  shapes: QuestionShapes
  /** Labels that could not be joined to a noul answer, with why. */
  dropped: DroppedLabel[]
}

// --- Parsing -----------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Read the rows of a recorded sweep. Accepts the full `many` result — merging
 * `kept` and `undecided`, because the undecided (≈0.5) items are exactly the
 * ones §1 insists on keeping in the sample — or a bare array of rows. Failed
 * and skipped items carry no answers and are absent by construction.
 */
export function parseRun(text: string): RunRow[] {
  const data: unknown = JSON.parse(text)
  const raw: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data)
      ? [...asArray(data.kept), ...asArray(data.undecided)]
      : []
  const rows: RunRow[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || !isRecord(item.answers)) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    rows.push({ id: item.id, answers: item.answers as Record<string, AnswerJson> })
  }
  if (rows.length === 0) {
    throw new Error(
      "run holds no rows with an id and answers — is this a `many --format json` result?",
    )
  }
  return rows
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Read labels from JSONL, one object per non-blank line. Reports the line on a bad row. */
export function parseLabels(text: string): Label[] {
  const labels: Label[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`labels line ${i + 1}: not valid JSON`)
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.id !== "string" ||
      typeof parsed.question !== "string" ||
      typeof parsed.label !== "boolean"
    ) {
      throw new Error(`labels line ${i + 1}: need {id: string, question: string, label: boolean}`)
    }
    labels.push({
      id: parsed.id,
      question: parsed.question,
      label: parsed.label,
      ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
    })
  }
  return labels
}

/** The noul probability of an answer, or undefined if it is not a noul. */
function noulValue(a: AnswerJson | undefined): number | undefined {
  return a?.type === "noul" && typeof a.noul === "number" ? a.noul : undefined
}

/**
 * Join labels to the noul answers of the run. Every label that cannot be paired
 * with a noul answer is dropped with a reason, never silently: an unjoined label
 * is a labelling mistake worth surfacing.
 */
export function joinNoul(
  rows: RunRow[],
  labels: Label[],
): { pairs: Pair[]; dropped: DroppedLabel[] } {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const pairs: Pair[] = []
  const dropped: DroppedLabel[] = []
  for (const label of labels) {
    const row = byId.get(label.id)
    if (!row) {
      dropped.push({ label, reason: "unknown-id" })
      continue
    }
    const answer = row.answers[label.question]
    if (answer === undefined) {
      dropped.push({ label, reason: "unknown-question" })
      continue
    }
    const predicted = noulValue(answer)
    if (predicted === undefined) {
      dropped.push({ label, reason: "not-noul" })
      continue
    }
    pairs.push({ id: label.id, question: label.question, predicted, actual: label.label })
  }
  return { pairs, dropped }
}

// --- Statistics --------------------------------------------------------------

/** Wilson score interval for a binomial proportion. Deterministic; honest at small n. */
export function wilson(successes: number, n: number, z = Z): [number, number] {
  if (n === 0) return [0, 1]
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [clamp01(center - half), clamp01(center + half)]
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * Which [0,1] bucket a probability falls in. 1.0 lands in the last bucket. The
 * epsilon defeats float error at bucket edges — `0.7 / 0.1` is 6.999…, which
 * would otherwise drop a predicted 0.7 into the 0.6–0.7 bucket.
 */
export function bucketIndex(p: number, width = BUCKET_WIDTH): number {
  const count = Math.round(1 / width)
  return Math.min(count - 1, Math.floor(p / width + 1e-9))
}

export function bucketize(pairs: Pair[], width = BUCKET_WIDTH): Bucket[] {
  const count = Math.round(1 / width)
  const totals = Array.from({ length: count }, () => ({ n: 0, t: 0 }))
  for (const pair of pairs) {
    const b = totals[bucketIndex(pair.predicted, width)]
    if (!b) continue
    b.n++
    if (pair.actual) b.t++
  }
  return totals.map((b, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    n: b.n,
    observed: b.n === 0 ? null : b.t / b.n,
    interval: b.n === 0 ? null : wilson(b.t, b.n),
  }))
}

/**
 * The undecided band: pairs whose noul confidence is at or below the floor,
 * i.e. noul ∈ [0.5 − floor/2, 0.5 + floor/2]. If the model is honest, these
 * near-coin-flip items should be true about half the time; a strong lean would
 * say the floor is hiding decided answers.
 */
export function undecidedBand(pairs: Pair[], floor = DEFAULT_UNDECIDED_FLOOR): UndecidedBand {
  const lo = 0.5 - floor / 2
  const hi = 0.5 + floor / 2
  const inBand = pairs.filter((p) => p.predicted >= lo && p.predicted <= hi)
  const trues = inBand.filter((p) => p.actual).length
  return {
    floor,
    lo,
    hi,
    n: inBand.length,
    observed: inBand.length === 0 ? null : trues / inBand.length,
  }
}

export function questionShapes(rows: RunRow[]): QuestionShapes {
  const counts = { noul: 0, choice: 0, score: 0 }
  const unmeasured = new Set<string>()
  for (const row of rows) {
    for (const answer of Object.values(row.answers)) {
      if (answer.type === "noul") counts.noul++
      else if (answer.type === "choice") counts.choice++
      else if (answer.type === "score") counts.score++
      else unmeasured.add(answer.type)
    }
  }
  return { ...counts, unmeasured: [...unmeasured].sort() }
}

/** Why a report is not usable, if it is not. Empty array means the sample passes. */
export function refusalReasons(pairs: Pair[], buckets: Bucket[]): string[] {
  const reasons: string[] = []
  const total = pairs.length
  if (total < MIN_LABELLED_TOTAL) {
    reasons.push(`only ${total} labelled noul pairs; need at least ${MIN_LABELLED_TOTAL}`)
  }
  const populated = buckets.filter((b) => b.n >= MIN_BUCKET_N).length
  if (populated < MIN_POPULATED_BUCKETS) {
    reasons.push(
      `only ${populated} bucket(s) reach ${MIN_BUCKET_N} pairs; need ${MIN_POPULATED_BUCKETS} for a curve`,
    )
  }
  if (total > 0) {
    const max = Math.max(...buckets.map((b) => b.n))
    const share = max / total
    if (share > MAX_BUCKET_SHARE) {
      reasons.push(
        `one bucket holds ${(share * 100).toFixed(0)}% of pairs (> ${(MAX_BUCKET_SHARE * 100).toFixed(0)}%); sample too skewed`,
      )
    }
  }
  return reasons
}

export function computeCalibration(
  rows: RunRow[],
  labels: Label[],
  floor = DEFAULT_UNDECIDED_FLOOR,
): CalibrationReport {
  const { pairs, dropped } = joinNoul(rows, labels)
  const buckets = bucketize(pairs)
  const refusals = refusalReasons(pairs, buckets)
  return {
    usable: refusals.length === 0,
    refusals,
    totalPairs: pairs.length,
    buckets,
    undecidedBand: undecidedBand(pairs, floor),
    shapes: questionShapes(rows),
    dropped,
  }
}

// --- Formatting --------------------------------------------------------------

function pct(x: number | null): string {
  return x === null ? "   — " : `${(x * 100).toFixed(0).padStart(3)}%`
}

export function formatReport(report: CalibrationReport): string {
  const out: string[] = []
  out.push(`noul pairs: ${report.totalPairs}`)
  const { noul, choice, score, unmeasured } = report.shapes
  out.push(`answers in run — noul ${noul}, choice ${choice}, score ${score}`)
  if (choice + score > 0) {
    out.push("  choice/score need a different label shape and are unmeasured in this pass.")
  }
  if (unmeasured.length > 0) out.push(`  unmeasured answer types present: ${unmeasured.join(", ")}`)

  if (report.dropped.length > 0) {
    const byReason = new Map<string, number>()
    for (const d of report.dropped) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1)
    const parts = [...byReason.entries()].sort().map(([r, n]) => `${r} ${n}`)
    out.push(`dropped labels: ${report.dropped.length} (${parts.join(", ")})`)
  }

  if (!report.usable) {
    out.push("")
    out.push("NO CURVE — sample refused:")
    for (const r of report.refusals) out.push(`  · ${r}`)
    return out.join("\n")
  }

  out.push("")
  out.push("predicted     n   observed   95% interval")
  for (const b of report.buckets) {
    if (b.n === 0) continue
    const range = `${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`.padEnd(9)
    const iv = b.interval ? `${pct(b.interval[0])}–${pct(b.interval[1])}` : ""
    out.push(`${range} ${String(b.n).padStart(4)}     ${pct(b.observed)}   ${iv}`)
  }

  const ub = report.undecidedBand
  out.push("")
  out.push(
    `undecided band (floor ${ub.floor}, noul ${ub.lo.toFixed(3)}–${ub.hi.toFixed(3)}): ` +
      `n ${ub.n}, observed ${pct(ub.observed)}`,
  )
  return out.join("\n")
}

// --- CLI ---------------------------------------------------------------------

interface Args {
  run: string
  labels: string
  floor: number
  json: boolean
}

export function parseArgs(argv: string[]): Args {
  let run = ""
  let labels = ""
  let floor = DEFAULT_UNDECIDED_FLOOR
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--run") run = argv[++i] ?? ""
    else if (arg === "--labels") labels = argv[++i] ?? ""
    else if (arg === "--floor") floor = Number(argv[++i])
    else if (arg === "--json") json = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!run || !labels)
    throw new Error("usage: --run <many.json> --labels <labels.jsonl> [--floor F] [--json]")
  if (!Number.isFinite(floor) || floor <= 0 || floor >= 1)
    throw new Error("--floor must be in (0, 1)")
  return { run, labels, floor, json }
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const rows = parseRun(readFileSync(args.run, "utf8"))
  const labels = parseLabels(readFileSync(args.labels, "utf8"))
  const report = computeCalibration(rows, labels, args.floor)
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else console.log(formatReport(report))
  return report.usable ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
