import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DecisionsError } from "../errors.js"
import { snapshotCriteria } from "../guard/done-check.js"
import { guardStatePath, readGuardState } from "../guard/state.js"
import { useTempDirs } from "../testkit/tmp.js"
import { failOpenReason, type PackModule, runHook } from "./hook.js"

const temp = useTempDirs()
const NOW = new Date("2026-09-27T12:00:00Z")
const ENABLED = "guard:\n  packs:\n    done-check:\n      enabled: true\n"
const CONSENT = "egress:\n  consent: { granted: true }\n"

function repo(config = CONSENT + ENABLED, files: Record<string, string> = {}) {
  const dir = temp({ ".system1/config.yaml": config, ...files })
  execFileSync("git", ["-C", dir, "init", "-q"])
  return dir
}

function commit(dir: string, file = "a.txt"): string {
  writeFileSync(join(dir, file), String(Math.random()))
  execFileSync("git", ["-C", dir, "add", "-A"])
  execFileSync("git", [
    "-C",
    dir,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "x",
  ])
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
}

const event = (dir: string, name: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: name,
  session_id: "s1",
  cwd: dir,
  ...extra,
})

const run = (dir: string, e: unknown, packs?: Partial<Record<"done-check", PackModule>>) =>
  runHook("done-check", e, { env: {}, home: temp(), now: NOW, ...(packs ? { packs } : {}) })

const state = (dir: string) => readGuardState(guardStatePath(dir))

describe("decide hook: dormant", () => {
  it("does nothing unless the pack is enabled", async () => {
    const dir = repo(CONSENT)
    expect(await run(dir, event(dir, "SessionStart"))).toEqual({})
    expect(await run(dir, event(dir, "Stop"))).toEqual({})
    expect(existsSync(guardStatePath(dir))).toBe(false)
  })

  it("does nothing when enabled without consent", async () => {
    const dir = repo(ENABLED)
    expect(await run(dir, event(dir, "Stop"))).toEqual({})
    expect(existsSync(guardStatePath(dir))).toBe(false)
  })

  it("stays silent on a broken config or an unreadable event when dormant", async () => {
    const dir = repo("guard: [\n")
    expect(await run(dir, event(dir, "Stop"))).toEqual({})
    expect(await runHook("done-check", undefined, { env: {}, cwd: repo(CONSENT) })).toEqual({})
  })
})

describe("decide hook: active", () => {
  it("records the base and the criteria at SessionStart", async () => {
    const dir = repo(undefined, { "TASK.md": "- tests pass\n" })
    const sha = commit(dir)
    expect(await run(dir, event(dir, "SessionStart", { source: "startup" }))).toEqual({})
    expect(state(dir).sessions["claude:s1"]).toMatchObject({
      harness: "claude",
      base: sha,
      baseSource: "session-start",
      criteria: [{ path: "TASK.md", text: "- tests pass\n" }],
    })
  })

  it("keeps the base on resume or compact, and starts over on startup", async () => {
    const dir = repo()
    const first = commit(dir)
    await run(dir, event(dir, "SessionStart", { source: "startup" }))
    const second = commit(dir)
    await run(dir, event(dir, "SessionStart", { source: "resume" }))
    await run(dir, event(dir, "SessionStart", { source: "compact" }))
    expect(state(dir).sessions["claude:s1"]?.base).toBe(first)
    await run(dir, event(dir, "SessionStart", { source: "startup" }))
    expect(state(dir).sessions["claude:s1"]?.base).toBe(second)
  })

  it("takes HEAD at the first Stop when SessionStart didn't run, or null with no commits", async () => {
    const dir = repo()
    expect(await run(dir, event(dir, "Stop"))).toEqual({})
    expect(state(dir).sessions["claude:s1"]).toMatchObject({ base: null, baseSource: "first-stop" })
    const other = repo()
    const sha = commit(other)
    await run(other, event(other, "Stop"))
    expect(state(other).sessions["claude:s1"]?.base).toBe(sha)
  })

  it("allows the second stop at once, touching nothing", async () => {
    const dir = repo()
    expect(await run(dir, event(dir, "Stop", { stop_hook_active: true }))).toEqual({})
    expect(existsSync(guardStatePath(dir))).toBe(false)
  })

  it("names Codex from its turn_id, or from --harness", async () => {
    const dir = repo()
    await run(dir, event(dir, "Stop", { turn_id: "t1" }))
    expect(Object.keys(state(dir).sessions)).toEqual(["codex:s1"])
    const other = repo()
    await runHook("done-check", event(other, "Stop"), { env: {}, home: temp(), harness: "codex" })
    expect(Object.keys(state(other).sessions)).toEqual(["codex:s1"])
  })

  it("says so when the event, the pack or the session id is unusable", async () => {
    const dir = repo()
    const noCwd = { ...event(dir, "Stop"), cwd: undefined }
    expect(await runHook("done-check", noCwd, { env: {}, home: temp(), cwd: dir })).toEqual({
      systemMessage: expect.stringMatching(/not checked: the harness sent an unexpected event/),
    })
    expect(await run(dir, event(dir, "Stop", { session_id: "../../x" }))).toEqual({
      systemMessage: expect.stringMatching(/session id it can't use/),
    })
    // An unknown pack is a wiring mismatch: it stays silent, like a dormant one.
    expect(await runHook("lint-check", event(dir, "Stop"), { env: {}, home: temp() })).toEqual({})
  })

  it("fails open with the reason when the pack throws", async () => {
    const dir = repo()
    const failing: PackModule = {
      sessionStart: () => ({}),
      stop: async () => {
        throw new DecisionsError("provider-http", "HTTP 500")
      },
    }
    expect(await run(dir, event(dir, "Stop"), { "done-check": failing })).toEqual({
      systemMessage:
        "System 1 done-check: not checked: the decision model's provider failed (provider-http)",
    })
  })

  it("fails open at latencyMs, and aborts the work", async () => {
    const dir = repo(
      `${CONSENT}guard:\n  packs:\n    done-check:\n      enabled: true\n      latencyMs: 50\n`,
    )
    let signal: AbortSignal | undefined
    const slow: PackModule = {
      sessionStart: () => ({}),
      stop: (ctx) => {
        signal = ctx.signal
        return new Promise(() => {})
      },
    }
    const started = Date.now()
    expect(await run(dir, event(dir, "Stop"), { "done-check": slow })).toEqual({
      systemMessage: "System 1 done-check: not checked: it took longer than 50 ms (latencyMs)",
    })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(signal?.aborted).toBe(true)
  })
})

describe("decide hook: sessions and deadlines", () => {
  it("gives the pack the ledger session: SYSTEM1_SESSION, else the harness's id", async () => {
    const dir = repo()
    const seen: string[] = []
    const spy: PackModule = {
      sessionStart: () => ({}),
      stop: async (ctx) => {
        seen.push(ctx.ledgerSession)
        return {}
      },
    }
    await run(dir, event(dir, "Stop"), { "done-check": spy })
    await runHook("done-check", event(dir, "Stop"), {
      env: { SYSTEM1_SESSION: "mine" },
      home: temp(),
      packs: { "done-check": spy },
    })
    expect(seen).toEqual(["claude:s1", "mine"])
  })

  it("writes no state once the deadline has passed", async () => {
    const dir = repo()
    const { ensureSession } = await import("../guard/done-check.js")
    const controller = new AbortController()
    controller.abort()
    const ctx = {
      repoRoot: dir,
      sessionKey: "claude:s1",
      ledgerSession: "claude:s1",
      tool: { cwd: dir, env: {} },
      harness: "claude" as const,
      pack: {
        enabled: true,
        latencyMs: 5000,
        maxUsdPerSession: 0.01,
        criteria: [],
        evidence: [],
        askAboutMessage: false,
      },
      event: { hook_event_name: "Stop", session_id: "s1", cwd: dir },
      signal: controller.signal,
      now: NOW,
    }
    await expect(ensureSession(ctx)).rejects.toMatchObject({ name: "AbortError" })
    expect(existsSync(guardStatePath(dir))).toBe(false)
  })
})

describe("failOpenReason", () => {
  it.each([
    ["egress-refused", /no egress consent/],
    ["no-key", /no API key/],
    ["provider-unreachable", /provider failed/],
    ["malformed-response", /provider failed/],
    ["replay-miss", /no recorded answer/],
    ["budget-exceeded", /^detail$/],
    ["state-too-large", /too large to send/],
    ["source-error", /git failed/],
  ] as const)("%s", (code, message) => {
    expect(failOpenReason(new DecisionsError(code, "detail"), 5000)).toMatch(message)
  })

  it("covers an abort and an unknown error without echoing it", () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" })
    expect(failOpenReason(abort, 5000)).toMatch(/longer than 5000 ms/)
    expect(failOpenReason(new Error("secret content"), 5000)).toBe(
      "an internal error; run `decide doctor`",
    )
  })
})

describe("snapshotCriteria", () => {
  it("skips paths outside the repo, symlinks, directories and missing files", () => {
    const outside = temp({ "secret.md": "- no\n" })
    const dir = temp({ "TASK.md": "- one\n", "docs/x.md": "" })
    symlinkSync(join(outside, "secret.md"), join(dir, "link.md"))
    const got = snapshotCriteria(dir, [
      "TASK.md",
      "../secret.md",
      join(outside, "secret.md"),
      "link.md",
      "docs",
      "missing.md",
    ])
    expect(got.map((c) => c.path)).toEqual(["TASK.md"])
  })

  it("skips a file reached through a symlinked parent directory", () => {
    const outside = temp({ "done.md": "- TOP SECRET\n" })
    const dir = temp({ "TASK.md": "- one\n" })
    symlinkSync(outside, join(dir, "docs"))
    expect(snapshotCriteria(dir, ["docs/done.md", "TASK.md"]).map((c) => c.path)).toEqual([
      "TASK.md",
    ])
  })

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips an unreadable file instead of failing",
    () => {
      const dir = temp({ "TASK.md": "- one\n", "done.md": "- two\n" })
      chmodSync(join(dir, "TASK.md"), 0)
      expect(snapshotCriteria(dir, ["TASK.md", "done.md"]).map((c) => c.path)).toEqual(["done.md"])
    },
  )

  it("reads a file in a real subdirectory", () => {
    const dir = temp({ "docs/done.md": "- two\n" })
    mkdirSync(join(dir, "docs/empty"))
    expect(snapshotCriteria(dir, ["docs/done.md"]).map((c) => c.path)).toEqual(["docs/done.md"])
  })

  it("keeps a long file by hash only", () => {
    const dir = temp({ "TASK.md": `- ${"x".repeat(20_000)}\n` })
    const [c] = snapshotCriteria(dir, ["TASK.md"])
    expect(c?.text).toBeUndefined()
    expect(c?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
