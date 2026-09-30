/**
 * The `done-check` guard pack (M10 §5, decision D8/D9): at Stop, check this
 * session's change against the criteria files' bullets and block once on a
 * confidently unmet one.
 *
 * This file is loaded only after the hook has found the pack enabled and
 * consented, so the dormant path never pays for it.
 */
import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import type { DecideMode } from "../decide.js"
import type { ContextOptions } from "../tools/context.js"
import { decideDone } from "./check.js"
import { gather } from "./gather.js"
import { headCommit } from "./git.js"
import type { GuardPackConfig } from "./packs.js"
import {
  CRITERIA_SNAPSHOT_MAX_CHARS,
  type GuardSession,
  guardStatePath,
  MAX_CRITERIA_FILES,
  readGuardState,
  updateGuardState,
} from "./state.js"

/** What the hook runner hands a pack. */
export interface PackContext {
  repoRoot: string
  /** `<harness>:<session id>`: the state key. */
  sessionKey: string
  /** The ledger's session for this pack's calls (`SYSTEM1_SESSION`, else `sessionKey`). */
  ledgerSession: string
  /** Builds the full tool context (profiles, transport) when a pack needs to decide. */
  tool: ContextOptions
  harness: "claude" | "codex"
  pack: GuardPackConfig
  event: HookEvent
  signal: AbortSignal
  now: Date
  /** How the pack's decider answers; `auto` unless an eval records fixtures. */
  mode?: DecideMode
}

/** The fields of a harness hook event the runner reads. Harnesses add others. */
export interface HookEvent {
  hook_event_name: string
  session_id: string
  cwd: string
  source?: string
  stop_hook_active?: boolean
  transcript_path?: string | null
  turn_id?: string
  last_assistant_message?: string | null
}

/** A harness hook response: allow (`{}`), block once, or a line for the user. */
export type HookOutput =
  | Record<string, never>
  | { decision: "block"; reason: string }
  | { systemMessage: string }

/** Read at most this much of a criteria file. */
const CRITERIA_READ_MAX_BYTES = 256 * 1024

export interface CriteriaSnapshot {
  path: string
  sha256: string
  text?: string
}

/**
 * The configured criteria files as they are now. A path that leaves the repo
 * (by `..`, an absolute path, or a symlinked file or parent directory), a
 * directory, and a missing or unreadable file are left out: it can't be a
 * criteria file, and following it could read something the user never meant
 * to send. The file is opened without following a final symlink and checked
 * on the open descriptor, so a link swapped in after the check isn't read.
 */
export function snapshotCriteria(repoRoot: string, paths: readonly string[]): CriteriaSnapshot[] {
  let root: string
  try {
    root = realpathSync(repoRoot)
  } catch {
    return []
  }
  const out: CriteriaSnapshot[] = []
  for (const path of paths.slice(0, MAX_CRITERIA_FILES)) {
    const full = resolve(repoRoot, path)
    const rel = relative(repoRoot, full)
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue
    const snapshot = readCriteriaFile(root, full)
    if (snapshot) out.push({ path: rel.split("\\").join("/"), ...snapshot })
  }
  return out
}

function readCriteriaFile(root: string, full: string): Omit<CriteriaSnapshot, "path"> | undefined {
  let fd: number | undefined
  try {
    const parent = realpathSync(dirname(full))
    const inside = relative(root, parent)
    if (inside.startsWith("..") || isAbsolute(inside)) return undefined
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(fd)
    if (!stat.isFile()) return undefined
    const buffer = Buffer.alloc(Math.min(stat.size, CRITERIA_READ_MAX_BYTES))
    const bytes = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0))
    const text = bytes.toString("utf8")
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(text.length <= CRITERIA_SNAPSHOT_MAX_CHARS ? { text } : {}),
    }
  } catch {
    // Missing, unreadable, a symlink (ELOOP): not a criteria file.
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Gathered outside the state lock: git can be slow, and the deadline must be able to cut it. */
async function newSession(
  ctx: PackContext,
  baseSource: GuardSession["baseSource"],
): Promise<GuardSession> {
  const at = ctx.now.toISOString()
  return {
    harness: ctx.harness,
    base: await headCommit(ctx.repoRoot, ctx.signal),
    baseSource,
    startedAt: at,
    updatedAt: at,
    criteria: snapshotCriteria(ctx.repoRoot, ctx.pack.criteria),
  }
}

/** Past the deadline the hook has already answered: write nothing more. */
function assertLive(ctx: PackContext): void {
  if (ctx.signal.aborted) throw Object.assign(new Error("deadline passed"), { name: "AbortError" })
}

/**
 * SessionStart: record the commit and the criteria this session starts from.
 * A resumed or compacted session keeps the base it already has.
 */
export async function sessionStart(ctx: PackContext): Promise<HookOutput> {
  const resumed = ctx.event.source === "resume" || ctx.event.source === "compact"
  const file = guardStatePath(ctx.repoRoot)
  const created = await newSession(ctx, "session-start")
  assertLive(ctx)
  updateGuardState(
    file,
    (state) => {
      if (resumed && state.sessions[ctx.sessionKey]) return { result: undefined }
      return {
        state: { ...state, sessions: { ...state.sessions, [ctx.sessionKey]: created } },
        result: undefined,
      }
    },
    { now: ctx.now },
  )
  return {}
}

/** The session's state, recording HEAD now as the base if SessionStart didn't run. */
export async function ensureSession(ctx: PackContext): Promise<GuardSession> {
  const file = guardStatePath(ctx.repoRoot)
  const known = readGuardState(file).sessions[ctx.sessionKey]
  if (known) return known
  const created = await newSession(ctx, "first-stop")
  assertLive(ctx)
  return updateGuardState(
    file,
    (state) => {
      const existing = state.sessions[ctx.sessionKey]
      if (existing) return { result: existing }
      return {
        state: { ...state, sessions: { ...state.sessions, [ctx.sessionKey]: created } },
        result: created,
      }
    },
    { now: ctx.now },
  )
}

/**
 * Stop: gather the criteria and the change, ask the model, and block once if
 * a criterion is confidently unmet. No criteria means silence and no egress;
 * an unchanged re-stop sends nothing; a stop where the agent asks its user
 * something sends only its last message, and is let through.
 */
export async function stop(ctx: PackContext): Promise<HookOutput> {
  const session = await ensureSession(ctx)
  const gathered = await gather(ctx, session)
  if (gathered.criteria.length === 0) return {}
  const result = await decideDone(ctx, gathered, session.last?.hash)
  assertLive(ctx)
  if (result.hash && result.outcome !== "skipped") {
    const hash = result.hash
    // The verdict is paid for: a state file that can't be written never discards it.
    try {
      updateGuardState(
        guardStatePath(ctx.repoRoot),
        (state) => {
          const current = state.sessions[ctx.sessionKey]
          if (!current) return { result: undefined }
          const at = ctx.now.toISOString()
          return {
            state: {
              ...state,
              sessions: {
                ...state.sessions,
                [ctx.sessionKey]: {
                  ...current,
                  updatedAt: at,
                  last: { hash, at, outcome: result.outcome },
                },
              },
            },
            result: undefined,
          }
        },
        { now: ctx.now },
      )
    } catch (error) {
      // Without the hash the next stop checks again (and pays): say so.
      const code = (error as NodeJS.ErrnoException)?.code ?? "an error"
      if ("systemMessage" in result.output)
        return {
          systemMessage: `${result.output.systemMessage} (not saved: the guard state couldn't be written, ${code})`,
        }
    }
  }
  return result.output
}
