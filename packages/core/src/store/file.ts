import { randomBytes } from "node:crypto"
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { dirname } from "node:path"
import { threadId } from "node:worker_threads"
import type { DecisionsError } from "../errors.js"

export interface LockOptions {
  /** How long to wait for another holder before giving up. */
  waitMs: number
  /** A lock older than this is from a crashed run and is taken over. */
  staleMs: number
  /** The error when the wait runs out: who holds it and what to do. */
  busy: (lock: string) => DecisionsError
}

/** Unique per call: process, thread and random bytes. */
function token(): string {
  return `${process.pid}.${threadId}.${randomBytes(6).toString("hex")}`
}

function readOr(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

/**
 * Run `body` holding `<file>.lock`, so concurrent writers of one state file
 * serialise instead of losing each other's changes. The lock is a file
 * created exclusively, holding a token unique to this holder.
 *
 * A lock older than `staleMs` is from a crashed run. It is taken over by
 * renaming it aside and checking that what was renamed is the lock that was
 * judged stale, so two waiters can't both take it, or take a fresh lock that
 * replaced it. Afterwards the lock is removed only if it still holds this
 * holder's token.
 */
export function withFileLock<T>(file: string, options: LockOptions, body: () => T): T {
  mkdirSync(dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const mine = token()
  const deadline = Date.now() + options.waitMs
  for (;;) {
    try {
      const fd = openSync(lock, "wx")
      try {
        writeSync(fd, mine)
      } finally {
        closeSync(fd)
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      takeOverIfStale(lock, options.staleMs)
      if (Date.now() > deadline) throw options.busy(lock)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    return body()
  } finally {
    if (readOr(lock) === mine) rmSync(lock, { force: true })
  }
}

function takeOverIfStale(lock: string, staleMs: number): void {
  let judged: string | undefined
  try {
    if (Date.now() - statSync(lock).mtimeMs <= staleMs) return
    judged = readOr(lock)
  } catch {
    return
  }
  if (judged === undefined) return
  const aside = `${lock}.${token()}.stale`
  try {
    renameSync(lock, aside)
  } catch {
    return // another waiter moved it first
  }
  if (readOr(aside) === judged) {
    rmSync(aside, { force: true })
    return
  }
  // What was renamed is a newer lock that replaced the stale one: put it back,
  // unless yet another lock has appeared meanwhile (then that one wins).
  try {
    const fd = openSync(lock, "wx")
    closeSync(fd)
    renameSync(aside, lock)
  } catch {
    rmSync(aside, { force: true })
  }
}

/** Written whole, through a temp file, so a crash never leaves half a file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeTextAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${token()}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}
