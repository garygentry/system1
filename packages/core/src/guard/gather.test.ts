import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readSources } from "../sources/read.js"
import { useTempDirs } from "../testkit/tmp.js"
import { type PackContext, snapshotCriteria } from "./done-check.js"
import { EMPTY_TREE, gather, MAX_CRITERIA, parseBullets } from "./gather.js"
import { PACKS } from "./packs.js"
import type { GuardSession } from "./state.js"

const temp = useTempDirs()
const NOW = new Date("2026-09-27T12:00:00Z")

function repo(files: Record<string, string> = {}): string {
  const dir = temp(files)
  execFileSync("git", ["-C", dir, "init", "-q"])
  return dir
}

function commit(dir: string): string {
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

function ctx(dir: string, pack: Partial<PackContext["pack"]> = {}): PackContext {
  return {
    repoRoot: dir,
    sessionKey: "claude:s1",
    ledgerSession: "claude:s1",
    tool: { cwd: dir, env: {} },
    harness: "claude",
    pack: {
      enabled: true,
      ...PACKS["done-check"].defaults,
      criteria: [...PACKS["done-check"].defaults.criteria],
      ...pack,
    },
    event: { hook_event_name: "Stop", session_id: "s1", cwd: dir },
    signal: new AbortController().signal,
    now: NOW,
  }
}

function session(dir: string, base: string | null, criteria = ["TASK.md"]): GuardSession {
  return {
    harness: "claude",
    base,
    baseSource: "session-start",
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    criteria: snapshotCriteria(dir, criteria),
  }
}

describe("parseBullets", () => {
  it("reads -, *, +, numbered and boxed bullets; drops ticked ones, prose, headings and code", () => {
    const text = [
      "# Task",
      "Some prose.",
      "- first",
      "* second",
      "+ third",
      "1. fourth",
      "2) fifth",
      "- [ ] open box",
      "- [x] done box",
      "- [X] done too",
      "```",
      "- not a criterion",
      "```",
      "  - nested",
    ].join("\n")
    expect(parseBullets(text).map((b) => b.text)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "open box",
      "nested",
    ])
  })

  it("honours longer fences, and skips rules and HTML comments", () => {
    const text = [
      "````",
      "```",
      "- inside the outer fence",
      "```",
      "````",
      "- after the fence",
      "* * *",
      "---",
      "<!--",
      "- commented out",
      "-->",
      "<!-- - also commented -->",
      "- last",
    ].join("\n")
    expect(parseBullets(text).map((b) => b.text)).toEqual(["after the fence", "last"])
  })

  it("joins an indented continuation line and reports the bullet's line", () => {
    expect(parseBullets("intro\n- errors are logged\n  with the request id\n\nafter")).toEqual([
      { text: "errors are logged with the request id", line: 2 },
    ])
  })
})

describe("gather", () => {
  it("splits criteria from exact facts, and builds the change from the base", async () => {
    const dir = repo({
      "TASK.md": "- Errors are logged, not swallowed\n- All tests pass\n- Done before Friday\n",
      "src/a.ts": "x",
    })
    const base = commit(dir)
    writeFileSync(join(dir, "src/a.ts"), "y")
    writeFileSync(join(dir, "src/new.ts"), "new")
    mkdirSync(join(dir, ".system1/guard"), { recursive: true })
    writeFileSync(join(dir, ".system1/guard/state.json"), "{}")
    const got = await gather(ctx(dir), session(dir, base))
    expect(got.criteria).toEqual([
      { text: "Errors are logged, not swallowed", file: "TASK.md", line: 1 },
    ])
    expect(got.checkYourself.map((c) => [c.text, c.why])).toEqual([
      ["All tests pass", expect.stringMatching(/exact fact.*check it yourself/)],
      ["Done before Friday", expect.stringMatching(/dates.*check it yourself/)],
    ])
    expect(got.sources).toEqual([
      {
        kind: "diff",
        range: base,
        paths: [".", ":(exclude).system1/", ":(exclude,glob)**/node_modules/**"],
      },
      { kind: "file", path: "src/new.ts", optional: true },
    ])
    expect(got.notes).toEqual([])
  })

  it("gives sources the reader accepts: the session's change, never decide's state", async () => {
    const dir = repo({ "TASK.md": "- Errors are logged\n", "src/a.ts": "x" })
    const base = commit(dir)
    writeFileSync(join(dir, "src/a.ts"), "y")
    writeFileSync(join(dir, "src/new.ts"), "new")
    mkdirSync(join(dir, ".system1"), { recursive: true })
    writeFileSync(join(dir, ".system1/config.yaml"), "x: 1")
    commit(dir)
    writeFileSync(join(dir, "src/a.ts"), "z")
    const got = await gather(ctx(dir), session(dir, base))
    const read = await readSources(got.sources, { cwd: dir })
    expect(read.documents.map((d) => d.path).sort()).toEqual(["src/a.ts", "src/new.ts"])
  })

  it("diffs against the empty tree when the session started before the first commit", async () => {
    const dir = repo({ "TASK.md": "- The parser rejects empty input\n" })
    const got = await gather(ctx(dir), session(dir, null))
    expect(got.sources[0]).toMatchObject({ kind: "diff", range: EMPTY_TREE })
    expect(got.sources).toContainEqual({ kind: "file", path: "TASK.md", optional: true })
  })

  it("checks against the original when the agent edits or empties its criteria", async () => {
    const dir = repo({ "TASK.md": "- The retry backs off exponentially\n" })
    commit(dir)
    const s = session(dir, null)
    writeFileSync(join(dir, "TASK.md"), "")
    const edited = await gather(ctx(dir), s)
    expect(edited.criteria.map((c) => c.text)).toEqual(["The retry backs off exponentially"])
    expect(edited.notes).toEqual([
      "TASK.md changed since the session started; checked against the original",
    ])
    rmSync(join(dir, "TASK.md"))
    expect((await gather(ctx(dir), s)).criteria).toHaveLength(1)
  })

  it("never uses a criteria file too long to snapshot, changed or not", async () => {
    const long = `- The cache is invalidated on write\n${"filler line\n".repeat(2000)}`
    const dir = repo({ "TASK.md": long })
    const s = session(dir, commit(dir))
    expect(s.criteria[0]?.text).toBeUndefined()
    expect((await gather(ctx(dir), s)).notes).toEqual(["TASK.md is too long to read as criteria"])
    writeFileSync(join(dir, "TASK.md"), "- something easier\n")
    const got = await gather(ctx(dir), s)
    expect(got.criteria).toEqual([])
    expect(got.notes).toEqual(["TASK.md is too long to read as criteria"])
  })

  it("still checks a criteria file dropped from the config mid-session", async () => {
    const dir = repo({ "TASK.md": "- The retry backs off exponentially\n" })
    const s = session(dir, commit(dir))
    const got = await gather(ctx(dir, { criteria: [] }), s)
    expect(got.criteria.map((c) => c.text)).toEqual(["The retry backs off exponentially"])
    expect(got.notes).toEqual([
      "TASK.md was removed from the criteria config during the session; still checked",
    ])
  })

  it("says so when the base commit no longer exists", async () => {
    const dir = repo({ "TASK.md": "- The flag is documented\n" })
    const s = session(dir, "0".repeat(40))
    await expect(gather(ctx(dir), s)).rejects.toThrow(/base commit no longer exists/)
  })

  it("notes ignored files changed during the session, never reading them", async () => {
    const dir = repo({
      "TASK.md": "- The flag is documented\n",
      ".gitignore": "secret.txt\nbuild/\n",
    })
    const s = {
      ...session(dir, commit(dir)),
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    }
    writeFileSync(join(dir, "secret.txt"), "hidden work")
    mkdirSync(join(dir, "build"))
    writeFileSync(join(dir, "build/out.js"), "x")
    const got = await gather(ctx(dir), s)
    expect(got.notes).toEqual([
      "ignored files changed during the session and weren't checked: secret.txt",
    ])
    expect(JSON.stringify(got.sources)).not.toContain("secret.txt")
  })

  it("leaves nested node_modules out of the change, and tolerates a vanished file", async () => {
    const dir = repo({
      "TASK.md": "- The flag is documented\n",
      "pkg/node_modules/x/index.js": "a",
    })
    const base = commit(dir)
    writeFileSync(join(dir, "pkg/node_modules/x/index.js"), "b")
    writeFileSync(join(dir, "gone.ts"), "x")
    const got = await gather(ctx(dir), session(dir, base))
    rmSync(join(dir, "gone.ts"))
    const read = await readSources(got.sources, { cwd: dir })
    expect(read.documents.map((d) => d.path)).toEqual([])
  })

  it("uses a criteria file created mid-session as it is", async () => {
    const dir = repo()
    const s = session(dir, null)
    writeFileSync(join(dir, "TASK.md"), "- The flag is documented\n")
    expect((await gather(ctx(dir), s)).criteria.map((c) => c.text)).toEqual([
      "The flag is documented",
    ])
  })

  it("sends nothing and reads no change when there are no criteria", async () => {
    const dir = repo({ "TASK.md": "Just prose, no bullets.\n" })
    expect(await gather(ctx(dir), session(dir, null))).toEqual({
      criteria: [],
      checkYourself: [],
      notes: [],
      sources: [],
    })
  })

  it("caps criteria, and notes missing evidence", async () => {
    const bullets = Array.from(
      { length: MAX_CRITERIA + 2 },
      (_, i) => `- Handles case ${"abcdefghij"[i % 10]}${i}`,
    )
    const dir = repo({ "TASK.md": `${bullets.join("\n")}\n`, "test.log": "ok" })
    const got = await gather(
      ctx(dir, { evidence: ["test.log", "missing.log"] }),
      session(dir, null),
    )
    expect(got.criteria).toHaveLength(MAX_CRITERIA)
    expect(got.checkYourself.filter((c) => /limit/.test(c.why))).toHaveLength(2)
    expect(got.sources).toContainEqual({ kind: "file", path: "test.log", optional: true })
    expect(got.notes).toContain("evidence file missing.log was not found")
  })
})
