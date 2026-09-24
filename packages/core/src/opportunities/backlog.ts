import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { stateDir } from "../config/load.js"
import { DecisionsError } from "../errors.js"
import { QuestionSchema } from "../model/schema.js"
import { assertQuestionSet } from "../model/validate.js"
import { type Op, tokenizeFilter, tokenizeSort } from "../project/project.js"

/**
 * The scout backlog: places where an LLM call, a hand-written heuristic or an
 * agent fan-out is doing a decision model's job. The `scout` skill decides what
 * counts; this module validates and persists it, so the backlog is a typed
 * artifact rather than prose in a transcript. Every saving in it is projected
 * (arithmetic over the inputs shown beside it), never measured.
 */
export const BACKLOG_FORMAT = 1

const CLOSED = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
/** Bounded so the computed saving is always a finite number that survives JSON. */
const Usd = Type.Number({ minimum: 0, maximum: 1e6 })

const Status = Type.Union([
  Type.Literal("new"),
  Type.Literal("stale"),
  Type.Literal("adopted"),
  Type.Literal("rejected"),
])

const candidateFields = {
  /** `code`: a codebase (Mode A). `agents`: skills, hooks, agent configuration (Mode B). */
  mode: Type.Union([Type.Literal("code"), Type.Literal("agents")]),
  location: Type.Object(
    {
      path: Text,
      lines: Type.Optional(
        Type.Object(
          { start: Type.Integer({ minimum: 1 }), end: Type.Integer({ minimum: 1 }) },
          CLOSED,
        ),
      ),
    },
    CLOSED,
  ),
  /** What does the job today, e.g. "gpt-4o call parsed to an enum". */
  mechanism: Text,
  shape: Type.Union([
    Type.Literal("single"),
    Type.Literal("fanout"),
    Type.Literal("cascade"),
    Type.Literal("pairwise"),
  ]),
  /**
   * The text that triggered it, taken verbatim from the screened item. The id is
   * derived from it, so it must be copied, not paraphrased.
   */
  evidence: Type.String({ pattern: "\\S" }),
  /** A draft question set that would replace the mechanism. */
  questions: Type.Record(Type.String(), QuestionSchema, { minProperties: 1 }),
  /** The inputs of the projected saving. The saving itself is computed here. */
  projected: Type.Object(
    {
      volume: Type.Number({ minimum: 0, maximum: 1e12 }),
      /** What `volume` counts per, e.g. "day", "PR", "run". */
      per: Text,
      currentCostPerItemUsd: Usd,
      decisionCostPerItemUsd: Usd,
      /** Where the figures came from. */
      note: Type.Optional(Type.String()),
    },
    CLOSED,
  ),
  risk: Type.Object(
    {
      level: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
      /** What would go wrong if the replacement erred. */
      note: Text,
    },
    CLOSED,
  ),
  /** The next step, e.g. "save the spec with design, then adopt". */
  next: Text,
  /** Defaults to `new`. `rejected` needs a `statusReason`. */
  status: Type.Optional(Status),
  statusReason: Type.Optional(Text),
  /** Which sweep produced it, and whether its screening answers were live or replayed. */
  source: Type.Object(
    {
      sweep: Text,
      answers: Type.Union([Type.Literal("live"), Type.Literal("replay")]),
    },
    CLOSED,
  ),
}

export const CandidateSchema = Type.Object(candidateFields, CLOSED)

export const OpportunitySchema = Type.Object(
  {
    id: Type.String({ pattern: "^op-[0-9a-f]{12}$" }),
    ...candidateFields,
    status: Status,
    projected: Type.Object(
      {
        ...candidateFields.projected.properties,
        basis: Type.Literal("projected"),
        /** volume × (current − decision), per `per`. Negative means it would cost more. */
        savingUsd: Type.Number(),
      },
      CLOSED,
    ),
    firstSeenAt: Type.String(),
    seenAt: Type.String(),
  },
  CLOSED,
)

export const BacklogSchema = Type.Object(
  {
    version: Type.Literal(BACKLOG_FORMAT),
    opportunities: Type.Array(OpportunitySchema),
  },
  CLOSED,
)

export type Candidate = Static<typeof CandidateSchema>
export type Opportunity = Static<typeof OpportunitySchema>
export type Backlog = Static<typeof BacklogSchema>
export type OpportunityStatus = Opportunity["status"]

export function backlogPath(repoRoot: string): string {
  return join(stateDir(repoRoot), "opportunities.json")
}

/**
 * Stable across re-runs and file moves: the mode and the evidence, with
 * whitespace collapsed. Not the path (a moved file keeps its id) and nothing
 * the agent paraphrases.
 */
export function opportunityId(mode: Candidate["mode"], evidence: string): string {
  const normal = evidence.replace(/\s+/g, " ").trim()
  return `op-${createHash("sha256").update(`${mode}\n${normal}`).digest("hex").slice(0, 12)}`
}

export function projectedSaving(p: Candidate["projected"]): number {
  return round(p.volume * (p.currentCostPerItemUsd - p.decisionCostPerItemUsd))
}

/** Every problem with a backlog value, as `path message` lines. Empty when valid. */
export function backlogProblems(value: unknown): string[] {
  const problems = [...Value.Errors(BacklogSchema, value)].map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  )
  if (problems.length) return problems
  const backlog = value as Backlog
  const seen = new Set<string>()
  backlog.opportunities.forEach((o, i) => {
    if (seen.has(o.id)) problems.push(`/opportunities/${i}/id ${o.id} appears twice`)
    seen.add(o.id)
    if (o.id !== opportunityId(o.mode, o.evidence)) {
      problems.push(`/opportunities/${i}/id does not match its mode and evidence`)
    }
    if (o.projected.savingUsd !== projectedSaving(o.projected)) {
      problems.push(`/opportunities/${i}/projected/savingUsd does not match its inputs`)
    }
    problems.push(...candidateProblems(o, `/opportunities/${i}`))
  })
  return problems
}

/** The checks a schema can't express. */
function candidateProblems(c: Candidate, at: string): string[] {
  const problems: string[] = []
  if (c.status === "rejected" && !c.statusReason) {
    problems.push(`${at}/statusReason is required when status is rejected`)
  }
  if (!Number.isFinite(projectedSaving(c.projected))) {
    problems.push(`${at}/projected gives a saving that isn't a finite number`)
  }
  if (c.location.lines && c.location.lines.end < c.location.lines.start) {
    problems.push(`${at}/location/lines end is before start`)
  }
  try {
    assertQuestionSet(c.questions)
  } catch (error) {
    problems.push(`${at}/questions ${(error as Error).message}`)
  }
  return problems
}

/**
 * Read the backlog. A missing file is an empty backlog; a malformed one is an
 * error, and is never repaired or overwritten.
 */
export function readBacklog(file: string): Backlog {
  if (!existsSync(file)) return { version: BACKLOG_FORMAT, opportunities: [] }
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    throw malformed(file, [`cannot read it: ${(error as Error).message}`])
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw malformed(file, [`not JSON: ${(error as Error).message}`])
  }
  const problems = backlogProblems(value)
  if (problems.length) throw malformed(file, problems)
  return value as Backlog
}

function malformed(file: string, problems: string[]): DecisionsError {
  return new DecisionsError(
    "invalid-request",
    `${file} is not a valid backlog (it was left as it is):\n  ${problems.join("\n  ")}`,
    { file, problems },
  )
}

const LOCK_WAIT_MS = 5_000
const LOCK_STALE_MS = 30_000

/**
 * Run `body` holding the backlog's lock, so concurrent `add`s (two sweeps, or
 * a sweep run in parallel) serialise instead of losing each other's entries.
 * A lock older than 30 s is from a crashed run and is taken over.
 */
export function withBacklogLock<T>(file: string, body: () => T): T {
  mkdirSync(dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true })
      } catch {}
      if (Date.now() > deadline) {
        throw new DecisionsError(
          "invalid-request",
          `${file} is locked by another \`decide opportunities add\` (${lock}). Retry, or delete the lock file if no add is running.`,
          { file, lock },
        )
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    return body()
  } finally {
    rmSync(lock, { force: true })
  }
}

/** Written whole, through a temp file, so a crash never leaves half a backlog. */
export function writeBacklog(file: string, backlog: Backlog): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(backlog, null, 2)}\n`)
  renameSync(tmp, file)
}

export interface MergeResult {
  backlog: Backlog
  added: string[]
  updated: string[]
  /** Entries at a path this add covered, not seen again, and so superseded. */
  staled: string[]
}

/**
 * Merge candidates into a backlog.
 *
 * - A candidate whose id exists updates that entry (location, draft, figures,
 *   `seenAt`), keeping `firstSeenAt`. Its status changes only when the
 *   candidate gives one, so a rejection survives a re-sweep.
 * - A new id is added with status `new` unless the candidate says otherwise.
 * - A `new` entry that this add's sweep produced before, at a path the add
 *   covers, in the same mode, and that the add didn't see again is marked
 *   `stale`: its evidence changed. It is never deleted. A stale entry seen again
 *   is `new` again.
 */
export function mergeCandidates(
  backlog: Backlog,
  candidates: readonly Candidate[],
  now: string,
): MergeResult {
  const problems = candidates.flatMap((c, i) => candidateProblems(c, `/candidates/${i}`))
  if (problems.length) {
    throw new DecisionsError("invalid-request", `Invalid candidates:\n  ${problems.join("\n  ")}`, {
      problems,
    })
  }
  const byId = new Map(backlog.opportunities.map((o) => [o.id, o]))
  const existed = new Set(byId.keys())
  const seen = new Set<string>()
  for (const { statusReason: reason, ...c } of candidates) {
    const id = opportunityId(c.mode, c.evidence)
    seen.add(id)
    const before = byId.get(id)
    // A new status replaces the old reason; no status keeps both.
    const statusReason = reason ?? (c.status ? undefined : before?.statusReason)
    byId.set(id, {
      id,
      ...c,
      // Seeing the evidence again disproves "stale"; any other status stands.
      status: c.status ?? (before?.status === "stale" ? "new" : before?.status) ?? "new",
      ...(statusReason ? { statusReason } : {}),
      projected: { ...c.projected, basis: "projected", savingUsd: projectedSaving(c.projected) },
      firstSeenAt: before?.firstSeenAt ?? now,
      seenAt: now,
    })
  }
  const added = [...seen].filter((id) => !existed.has(id))
  const updated = [...seen].filter((id) => existed.has(id))
  // Coverage is per sweep: another sweep's entries at the same path (different
  // questions, or an incremental add) are not disproved by this one.
  const key = (o: Candidate) => `${o.mode}\n${o.location.path}\n${o.source.sweep}`
  const covered = new Set(candidates.map(key))
  const staled: string[] = []
  for (const o of byId.values()) {
    if (o.status === "new" && !seen.has(o.id) && covered.has(key(o))) {
      byId.set(o.id, { ...o, status: "stale" })
      staled.push(o.id)
    }
  }
  return {
    backlog: { version: BACKLOG_FORMAT, opportunities: [...byId.values()] },
    added,
    updated,
    staled,
  }
}

/**
 * Fields a record filter or sort may name: the sub-fields each object field
 * has, and the one a bare name means. Checked statically, so a typo is an
 * error even on an empty backlog.
 */
const FIELDS: Record<string, { default?: string; subs?: readonly string[] }> = {
  id: {},
  mode: {},
  status: {},
  statusReason: {},
  shape: {},
  mechanism: {},
  evidence: {},
  next: {},
  firstSeenAt: {},
  seenAt: {},
  risk: { default: "level", subs: ["level", "note"] },
  projected: {
    default: "savingUsd",
    subs: [
      "savingUsd",
      "volume",
      "per",
      "currentCostPerItemUsd",
      "decisionCostPerItemUsd",
      "basis",
      "note",
    ],
  },
  location: { default: "path", subs: ["path", "lines.start", "lines.end"] },
  source: { default: "sweep", subs: ["sweep", "answers"] },
}

/** Top-level fields of an entry, for `--fields`. */
export const ENTRY_FIELDS: readonly string[] = [...Object.keys(OpportunitySchema.properties)]

export interface RecordFilter {
  field: string
  op: Op
  value: number | string | string[]
  source: string
}

/** `status=new`, `risk in medium,high`, `projected>=0.5`, `location.path=src/a.ts`. */
export function parseRecordFilter(text: string): RecordFilter {
  const t = tokenizeFilter(text)
  if (!t) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --keep "${text}". Use <field>[.<sub>]<op><value>, e.g. status=new or projected>=0.01`,
    )
  }
  const field = recordField(t.name, t.path, text)
  if (
    (t.op === ">" || t.op === ">=" || t.op === "<" || t.op === "<=") &&
    typeof t.value !== "number"
  ) {
    throw new DecisionsError("invalid-request", `--keep "${text}": ${t.op} needs a number`)
  }
  return { field, op: t.op, value: t.value, source: text }
}

export function parseRecordSort(text: string): { field: string; direction: "asc" | "desc" } {
  const t = tokenizeSort(text)
  if (!t) {
    throw new DecisionsError(
      "invalid-request",
      `Cannot parse --sort "${text}". Use <field>[.<sub>][:asc|desc]`,
    )
  }
  return { field: recordField(t.name, t.path, text), direction: t.direction }
}

function recordField(name: string, path: string, text: string): string {
  const spec = Object.hasOwn(FIELDS, name) ? FIELDS[name] : undefined
  if (!spec) {
    throw new DecisionsError(
      "invalid-request",
      `"${text}": no field "${name}". Fields: ${Object.keys(FIELDS).join(", ")}`,
    )
  }
  if (path && !spec.subs?.includes(path)) {
    throw new DecisionsError(
      "invalid-request",
      spec.subs
        ? `"${text}": ${name} has no "${path}". Use one of: ${spec.subs.join(", ")}`
        : `"${text}": ${name} has no sub-fields`,
    )
  }
  const sub = path || spec.default
  return sub ? `${name}.${sub}` : name
}

export function readField(o: Opportunity, field: string): unknown {
  let value: unknown = o
  for (const key of field.split(".")) {
    if (value === null || typeof value !== "object") return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

export function recordMatches(o: Opportunity, f: RecordFilter): boolean {
  const actual = readField(o, f.field)
  switch (f.op) {
    case "in":
      return (f.value as string[]).includes(String(actual))
    case "=":
      return String(actual) === String(f.value)
    case "!=":
      return String(actual) !== String(f.value)
    default: {
      if (typeof actual !== "number") return false
      const v = f.value as number
      return f.op === ">="
        ? actual >= v
        : f.op === ">"
          ? actual > v
          : f.op === "<="
            ? actual <= v
            : actual < v
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1e9) / 1e9
}
