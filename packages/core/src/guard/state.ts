/**
 * Guard state (M10 §3): what a guard pack remembers per harness session.
 * `done-check` needs the commit the session started from (so a session that
 * commits before stopping is still checked, and other people's uncommitted
 * work is not), the criteria files as they were then (so an agent that edits
 * or empties its own criteria is checked against the originals), and a hash
 * of what it last checked (so an unchanged re-stop sends nothing).
 *
 * Spend is not kept here: the spend ledger is the measured, append-only
 * record, keyed by session and tag (plans/m10-hooks.md, decision 4).
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { stateDir } from "../config/load.js"
import { DecisionsError } from "../errors.js"
import { withFileLock, writeTextAtomic } from "../store/file.js"

export const GUARD_STATE_FORMAT = 1
/** Past this the file is refused (fail open), never trimmed or deleted by decide. */
export const GUARD_STATE_MAX_BYTES = 1_000_000
/** The most text kept per criteria file; a longer file is kept by hash only. */
export const CRITERIA_SNAPSHOT_MAX_CHARS = 16_384
/** Sessions idle longer than this are pruned on the next write. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** At most this many sessions are kept, newest first. */
export const MAX_SESSIONS = 200

const CLOSED = { additionalProperties: false } as const
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" })
/** An ISO-8601 UTC timestamp, as `Date.toISOString` writes it. */
const Time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$" })
/** `<harness>:<harness session id>`, the same id the spend ledger uses. */
export const SESSION_ID_PATTERN = "^(claude|codex):[A-Za-z0-9._-]{1,128}$"
/** The most criteria files a session snapshots. */
export const MAX_CRITERIA_FILES = 20

const SessionSchema = Type.Object(
  {
    harness: Type.Union([Type.Literal("claude"), Type.Literal("codex")]),
    /** The commit the session started from; `null` in a repo with no commits yet. */
    base: Type.Union([Type.String({ pattern: "^[0-9a-f]{40}([0-9a-f]{24})?$" }), Type.Null()]),
    /** `first-stop`: SessionStart didn't run, so the base is HEAD at the first Stop. */
    baseSource: Type.Union([Type.Literal("session-start"), Type.Literal("first-stop")]),
    startedAt: Time,
    updatedAt: Time,
    /** The criteria files at the base, by hash; the text too when it fits. */
    criteria: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          sha256: Sha256,
          text: Type.Optional(Type.String({ maxLength: CRITERIA_SNAPSHOT_MAX_CHARS })),
        },
        CLOSED,
      ),
      { maxItems: MAX_CRITERIA_FILES },
    ),
    /** The last check: the hash of what it looked at, and what it did. */
    last: Type.Optional(
      Type.Object(
        {
          hash: Sha256,
          at: Time,
          outcome: Type.Union([
            Type.Literal("allow"),
            Type.Literal("block"),
            Type.Literal("skipped"),
          ]),
        },
        CLOSED,
      ),
    ),
  },
  CLOSED,
)

export const GuardStateSchema = Type.Object(
  {
    version: Type.Literal(GUARD_STATE_FORMAT),
    sessions: Type.Record(Type.String({ pattern: SESSION_ID_PATTERN }), SessionSchema),
  },
  CLOSED,
)

export type GuardSession = Static<typeof SessionSchema>
export type GuardState = Static<typeof GuardStateSchema>

export function guardStatePath(repoRoot: string): string {
  return join(stateDir(repoRoot), "guard", "state.json")
}

/** Every problem with a state value, as `path message` lines. Empty when valid. */
export function guardStateProblems(value: unknown): string[] {
  const problems = [...Value.Errors(GuardStateSchema, value)].map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  )
  // The schema's key pattern isn't enforced by the validator, so check ids here:
  // this also keeps `__proto__` and friends out.
  const sessions = (value as { sessions?: unknown } | null)?.sessions
  if (typeof sessions === "object" && sessions !== null) {
    const pattern = new RegExp(SESSION_ID_PATTERN)
    for (const id of Object.keys(sessions)) {
      if (!pattern.test(id)) problems.push(`/sessions ${JSON.stringify(id)} is not a session id`)
    }
  }
  return problems
}

/**
 * Read the state. A missing file is an empty state. A file that is too large
 * or malformed is an error and is left as it is: the hook fails open with the
 * message, and the user deletes the file if they want to start over.
 */
export function readGuardState(file: string): GuardState {
  if (!existsSync(file)) return { version: GUARD_STATE_FORMAT, sessions: {} }
  let size: number
  let text: string
  try {
    size = statSync(file).size
    if (size > GUARD_STATE_MAX_BYTES)
      throw unreadable(file, [`it is ${size} bytes, over the limit`])
    text = readFileSync(file, "utf8")
  } catch (error) {
    if (error instanceof DecisionsError) throw error
    throw unreadable(file, [`cannot read it: ${(error as Error).message}`])
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw unreadable(file, [`not JSON: ${(error as Error).message}`])
  }
  const problems = guardStateProblems(value)
  if (problems.length) throw unreadable(file, problems)
  return value as GuardState
}

function unreadable(file: string, problems: string[]): DecisionsError {
  return new DecisionsError(
    "invalid-request",
    `${file} is not a valid guard state (it was left as it is; delete it to start over):\n  ${problems.join("\n  ")}`,
    { file, problems },
  )
}

/** Drop sessions idle past the TTL, then keep the newest `MAX_SESSIONS`. */
export function pruneSessions(state: GuardState, now: Date): GuardState {
  const cutoff = now.getTime() - SESSION_TTL_MS
  // A time in the future (clock skew) counts as now, so it still expires.
  const at = (s: GuardSession) => Math.min(Date.parse(s.updatedAt), now.getTime())
  const kept = Object.entries(state.sessions)
    .filter(([, s]) => at(s) >= cutoff)
    .sort(([, a], [, b]) => at(b) - at(a))
    .slice(0, MAX_SESSIONS)
  return { ...state, sessions: Object.fromEntries(kept) }
}

export interface UpdateOptions {
  now?: Date
  /** How long to wait for another hook holding the lock. A hook keeps this short. */
  waitMs?: number
}

/**
 * Read, change and write the state under its lock, pruning as it writes.
 * `change` returns the new state, or `undefined` to write nothing.
 */
export function updateGuardState<T>(
  file: string,
  change: (state: GuardState) => { state?: GuardState; result: T },
  options: UpdateOptions = {},
): T {
  const now = options.now ?? new Date()
  return withFileLock(
    file,
    {
      waitMs: options.waitMs ?? 200,
      staleMs: 30_000,
      busy: (lock) =>
        new DecisionsError(
          "invalid-request",
          `${file} is locked by another guard hook (${lock}). Delete the lock file if no hook is running.`,
          { file, lock },
        ),
    },
    () => {
      const { state, result } = change(readGuardState(file))
      if (state) {
        const next = pruneSessions(state, now)
        const problems = guardStateProblems(next)
        if (problems.length) {
          throw new DecisionsError(
            "invalid-request",
            `Refused to write an invalid guard state to ${file} (a bug in decide; the file is unchanged):\n  ${problems.join("\n  ")}`,
            { file, problems },
          )
        }
        writeTextAtomic(file, fitToSize(next))
      }
      return result
    },
  )
}

/**
 * The state as JSON within `GUARD_STATE_MAX_BYTES`, so a write can never make
 * the next read fail. Over the limit, the oldest sessions lose their criteria
 * text first (their hashes stay, so a changed file is still noticed), then the
 * oldest sessions go. Sessions are ordered newest first by `pruneSessions`.
 */
export function fitToSize(state: GuardState): string {
  const text = (s: GuardState) => `${JSON.stringify(s, null, 2)}\n`
  let out = text(state)
  if (Buffer.byteLength(out) <= GUARD_STATE_MAX_BYTES) return out
  const entries = Object.entries(state.sessions).map(
    ([id, s]) => [id, { ...s, criteria: s.criteria.map((c) => ({ ...c })) }] as const,
  )
  const current = () => ({ ...state, sessions: Object.fromEntries(entries) })
  for (let i = entries.length - 1; i >= 0; i--) {
    for (const c of entries[i]?.[1].criteria ?? []) delete c.text
    out = text(current())
    if (Buffer.byteLength(out) <= GUARD_STATE_MAX_BYTES) return out
  }
  while (entries.length > 0) {
    entries.pop()
    out = text(current())
    if (Buffer.byteLength(out) <= GUARD_STATE_MAX_BYTES) return out
  }
  return out
}
