import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { withFileLock } from "../store/file.js"
import { useTempDirs } from "../testkit/tmp.js"
import {
  fitToSize,
  GUARD_STATE_MAX_BYTES,
  type GuardSession,
  type GuardState,
  guardStatePath,
  guardStateProblems,
  MAX_SESSIONS,
  pruneSessions,
  readGuardState,
  SESSION_TTL_MS,
  updateGuardState,
} from "./state.js"

const temp = useTempDirs()
const NOW = new Date("2026-09-27T12:00:00Z")
const SHA = "a".repeat(40)
const HASH = "b".repeat(64)

function session(updatedAt: string, overrides: Partial<GuardSession> = {}): GuardSession {
  return {
    harness: "claude",
    base: SHA,
    baseSource: "session-start",
    startedAt: updatedAt,
    updatedAt,
    criteria: [{ path: "TASK.md", sha256: HASH, text: "- tests pass\n" }],
    ...overrides,
  }
}

function fileIn(): string {
  return guardStatePath(temp())
}

describe("guard state", () => {
  it("reads a missing file as empty", () => {
    expect(readGuardState(fileIn())).toEqual({ version: 1, sessions: {} })
  })

  it("writes through update, and reads back what it wrote", () => {
    const file = fileIn()
    const result = updateGuardState(
      file,
      (state) => ({
        state: { ...state, sessions: { "claude:s1": session(NOW.toISOString()) } },
        result: "wrote",
      }),
      { now: NOW },
    )
    expect(result).toBe("wrote")
    expect(readGuardState(file).sessions["claude:s1"]?.base).toBe(SHA)
  })

  it("writes nothing when the change returns no state", () => {
    const file = fileIn()
    expect(updateGuardState(file, () => ({ result: 1 }))).toBe(1)
    expect(() => readFileSync(file)).toThrow()
  })

  it("accepts a null base (no commits yet) and a last check", () => {
    const file = fileIn()
    const s = session(NOW.toISOString(), {
      base: null,
      baseSource: "first-stop",
      last: { hash: HASH, at: NOW.toISOString(), outcome: "block" },
    })
    updateGuardState(file, (st) => ({ state: { ...st, sessions: { "codex:x": s } }, result: 0 }), {
      now: NOW,
    })
    expect(readGuardState(file).sessions["codex:x"]).toEqual(s)
  })

  it("refuses to write an invalid state, leaving the file as it was", () => {
    const file = fileIn()
    const bad = { ...session(NOW.toISOString()), base: "not-a-sha" } as GuardSession
    expect(() =>
      updateGuardState(file, (st) => ({
        state: { ...st, sessions: { "claude:x": bad } },
        result: 0,
      })),
    ).toThrow(/Refused to write an invalid guard state/)
    expect(() => readFileSync(file)).toThrow()
  })

  it("refuses a malformed or oversize file, and never overwrites it", () => {
    const file = fileIn()
    updateGuardState(file, (st) => ({ state: st, result: 0 }))
    writeFileSync(file, '{"version":1,"sessions":{"claude:x":{"harness":"pi"}}}')
    expect(() => readGuardState(file)).toThrow(/delete it to start over/)
    expect(() => updateGuardState(file, (st) => ({ state: st, result: 0 }))).toThrow()
    expect(readFileSync(file, "utf8")).toContain('"pi"')
    writeFileSync(file, "x".repeat(GUARD_STATE_MAX_BYTES + 1))
    expect(() => readGuardState(file)).toThrow(/over the limit/)
    writeFileSync(file, "{nope")
    expect(() => readGuardState(file)).toThrow(/not JSON/)
  })

  it("gives up quickly when another hook holds the lock", () => {
    const file = fileIn()
    updateGuardState(file, (st) => ({ state: st, result: 0 }))
    writeFileSync(`${file}.lock`, "")
    const started = Date.now()
    expect(() =>
      updateGuardState(file, (st) => ({ state: st, result: 0 }), { waitMs: 50 }),
    ).toThrow(/locked by another guard hook/)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe("pruneSessions", () => {
  it("drops sessions idle past the TTL and keeps the newest", () => {
    const old = new Date(NOW.getTime() - SESSION_TTL_MS - 1000).toISOString()
    const sessions: GuardState["sessions"] = { "claude:stale": session(old) }
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      sessions[`claude:s${i}`] = session(new Date(NOW.getTime() - i * 1000).toISOString())
    }
    const pruned = pruneSessions({ version: 1, sessions }, NOW)
    const ids = Object.keys(pruned.sessions)
    expect(ids).toHaveLength(MAX_SESSIONS)
    expect(ids).not.toContain("claude:stale")
    expect(ids[0]).toBe("claude:s0")
    expect(ids).not.toContain(`claude:s${MAX_SESSIONS}`)
  })

  it("prunes on write", () => {
    const file = join(temp(), "state.json")
    const old = new Date(NOW.getTime() - SESSION_TTL_MS - 1000).toISOString()
    updateGuardState(
      file,
      (st) => ({
        state: {
          ...st,
          sessions: { "claude:stale": session(old), "claude:fresh": session(NOW.toISOString()) },
        },
        result: 0,
      }),
      { now: NOW },
    )
    expect(Object.keys(readGuardState(file).sessions)).toEqual(["claude:fresh"])
  })
})

describe("state limits", () => {
  it("never writes a file the next read would refuse", () => {
    const file = fileIn()
    const text = `- ${"criterion text ".repeat(1000)}`.slice(0, 16_000)
    const sessions: GuardState["sessions"] = {}
    for (let i = 0; i < 200; i++) {
      sessions[`claude:s${i}`] = session(new Date(NOW.getTime() - i * 1000).toISOString(), {
        criteria: [{ path: "TASK.md", sha256: HASH, text }],
      })
    }
    updateGuardState(file, (st) => ({ state: { ...st, sessions }, result: 0 }), { now: NOW })
    const read = readGuardState(file)
    expect(read.sessions["claude:s0"]?.criteria[0]?.text).toBe(text)
    expect(read.sessions["claude:s199"]?.criteria[0]?.text).toBeUndefined()
    expect(read.sessions["claude:s199"]?.criteria[0]?.sha256).toBe(HASH)
  })

  it("fitToSize leaves a small state alone", () => {
    const state: GuardState = { version: 1, sessions: { "claude:a": session(NOW.toISOString()) } }
    expect(JSON.parse(fitToSize(state))).toEqual(state)
  })

  it.each([
    ["", "an empty id"],
    ["__proto__", "a prototype key"],
    ["pi:abc", "an unknown harness"],
    ["claude:a b", "a space"],
  ])("rejects the session id %j (%s)", (id) => {
    const value = JSON.parse(
      `{"version":1,"sessions":{${JSON.stringify(id)}:${JSON.stringify(session(NOW.toISOString()))}}}`,
    )
    expect(guardStateProblems(value)).not.toEqual([])
  })

  it("rejects a time that isn't an ISO timestamp", () => {
    const value = { version: 1, sessions: { "claude:a": session("yesterday") } }
    expect(guardStateProblems(value)).not.toEqual([])
  })

  it("treats a future time as now, so it still expires", () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    const state: GuardState = { version: 1, sessions: { "claude:f": session(future) } }
    const later = new Date(NOW.getTime() + SESSION_TTL_MS + 120_000)
    expect(pruneSessions(state, later).sessions).toEqual({})
  })
})

describe("withFileLock", () => {
  const options = (staleMs = 30_000) => ({
    waitMs: 200,
    staleMs,
    busy: () => new Error("busy") as never,
  })

  it("takes over a stale lock, and removes only its own lock", () => {
    const file = join(temp(), "f.json")
    writeFileSync(`${file}.lock`, "crashed-holder")
    utimesSync(`${file}.lock`, new Date(0), new Date(0))
    expect(withFileLock(file, options(), () => "ran")).toBe("ran")
    expect(existsSync(`${file}.lock`)).toBe(false)
    expect(readdirSync(join(file, "..")).filter((f) => f.includes("stale"))).toEqual([])
  })

  it("leaves a lock another holder took while it ran", () => {
    const file = join(temp(), "f.json")
    withFileLock(file, options(), () => {
      writeFileSync(`${file}.lock`, "someone-else")
    })
    expect(readFileSync(`${file}.lock`, "utf8")).toBe("someone-else")
  })

  it("waits for a fresh lock and gives up", () => {
    const file = join(temp(), "f.json")
    writeFileSync(`${file}.lock`, "live")
    expect(() => withFileLock(file, options(), () => 0)).toThrow("busy")
    expect(readFileSync(`${file}.lock`, "utf8")).toBe("live")
  })
})
