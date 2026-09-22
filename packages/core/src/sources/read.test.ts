import { symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { gitRepo, useTempDirs, writeTree } from "../testkit/tmp.js"
import { parseFileRef, readSources } from "./read.js"

const temp = useTempDirs()

describe("parseFileRef", () => {
  it.each([
    ["src/a.ts", { path: "src/a.ts" }],
    ["src/a.ts:12", { path: "src/a.ts", range: { start: 12, end: 12 } }],
    ["src/a.ts:12-40", { path: "src/a.ts", range: { start: 12, end: 40 } }],
    ["C:weird", { path: "C:weird" }],
  ])("parses %s", (ref, expected) => {
    expect(parseFileRef(ref)).toEqual(expected)
  })

  it("rejects backwards ranges", () => {
    expect(() => parseFileRef("a.ts:40-12")).toThrow(/Invalid line range/)
  })
})

describe("readSources", () => {
  it("reads text and stdin as single documents", async () => {
    const { documents } = await readSources(
      [
        { kind: "text", text: "hello" },
        { kind: "stdin", text: "piped" },
      ],
      { cwd: temp() },
    )
    expect(documents.map((d) => [d.id, d.text])).toEqual([
      ["text", "hello"],
      ["stdin", "piped"],
    ])
  })

  it("reads a file, or a 1-based inclusive line range of it", async () => {
    const cwd = temp({ "a.txt": "one\ntwo\nthree\nfour" })
    const whole = await readSources([{ kind: "file", path: "a.txt" }], { cwd })
    expect(whole.documents[0]).toMatchObject({ id: "a.txt", path: "a.txt", startLine: 1 })
    const part = await readSources([{ kind: "file", path: "a.txt", range: { start: 2, end: 3 } }], {
      cwd,
    })
    expect(part.documents[0]).toMatchObject({ id: "a.txt:2-3", text: "two\nthree", startLine: 2 })
  })

  it("errors on a missing file as source-error", async () => {
    await expect(
      readSources([{ kind: "file", path: "nope" }], { cwd: temp() }),
    ).rejects.toMatchObject({
      code: "source-error",
    })
  })

  it("skips binary and oversized files, reporting why", async () => {
    const cwd = temp({ "big.txt": "x".repeat(100), "ok.txt": "fine" })
    writeFileSync(join(cwd, "img.bin"), Buffer.from([1, 0, 2, 3]))
    const { documents, skipped } = await readSources([{ kind: "glob", patterns: ["*"] }], {
      cwd,
      maxFileBytes: 50,
    })
    expect(documents.map((d) => d.path)).toEqual(["ok.txt"])
    expect(skipped).toEqual(
      expect.arrayContaining([
        { path: "big.txt", reason: "too-large", detail: "> 50 bytes" },
        { path: "img.bin", reason: "binary" },
      ]),
    )
  })

  it("globs in sorted order and never enters node_modules or .git", async () => {
    const cwd = temp({
      "src/b.ts": "b",
      "src/a.ts": "a",
      "node_modules/x/index.ts": "x",
      ".git/config.ts": "g",
    })
    const { documents } = await readSources([{ kind: "glob", patterns: ["**/*.ts"] }], { cwd })
    expect(documents.map((d) => d.path)).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("honours .gitignore inside a git repo, but keeps tracked files that match it", async () => {
    // tracked.log is committed first, then *.log is ignored: git still tracks it,
    // so it is real repo content and must be read. debug.log is untracked and ignored.
    const cwd = gitRepo(temp(), { "keep.ts": "k", "tracked.log": "t" })
    writeTree(cwd, { ".gitignore": "*.log\n", "debug.log": "d", "new.ts": "n" })
    const { documents, skipped } = await readSources(
      [{ kind: "glob", patterns: ["*.ts", "*.log"] }],
      { cwd },
    )
    expect(documents.map((d) => d.path).sort()).toEqual(["keep.ts", "new.ts", "tracked.log"])
    expect(skipped).toEqual([{ path: "debug.log", reason: "gitignored" }])
  })

  it("reads JSONL rows as structured documents with line numbers", async () => {
    const cwd = temp({ "rows.jsonl": '{"id":1}\n\n{"id":2,"text":"b"}\n' })
    const { documents } = await readSources([{ kind: "jsonl", path: "rows.jsonl" }], { cwd })
    expect(documents).toEqual([
      { id: "rows.jsonl:row1", kind: "row", path: "rows.jsonl", data: { id: 1 }, startLine: 1 },
      {
        id: "rows.jsonl:row3",
        kind: "row",
        path: "rows.jsonl",
        data: { id: 2, text: "b" },
        startLine: 3,
      },
    ])
  })

  it("names the bad line in invalid JSONL", async () => {
    const cwd = temp({ "rows.jsonl": '{"ok":1}\nnot json\n' })
    await expect(readSources([{ kind: "jsonl", path: "rows.jsonl" }], { cwd })).rejects.toThrow(
      "rows.jsonl:2",
    )
  })

  it("reads a git diff as one document per file", async () => {
    const cwd = gitRepo(temp(), { "a.ts": "one\ntwo\n", "b.ts": "x\n" })
    writeTree(cwd, { "a.ts": "one\nTWO\n", "b.ts": "y\n" })
    const { documents } = await readSources([{ kind: "diff" }], { cwd })
    expect(documents.map((d) => [d.id, d.kind])).toEqual([
      ["a.ts#diff", "diff"],
      ["b.ts#diff", "diff"],
    ])
    expect(documents[0]?.text).toContain("+TWO")
    const onlyB = await readSources([{ kind: "diff", paths: ["b.ts"] }], { cwd })
    expect(onlyB.documents.map((d) => d.path)).toEqual(["b.ts"])
  })

  it("refuses a diff range that looks like an option", async () => {
    const cwd = gitRepo(temp(), { "a.ts": "a" })
    await expect(
      readSources([{ kind: "diff", range: "--output=/tmp/x" }], { cwd }),
    ).rejects.toMatchObject({
      code: "invalid-request",
    })
  })

  describe("the repo boundary", () => {
    it("withholds a path that resolves outside the repo, unless asked for", async () => {
      const outside = temp({ "secret.txt": "not yours" })
      const repo = temp({ "a.ts": "inside" })
      const spec = { kind: "file" as const, path: join(outside, "secret.txt") }
      const withheld = await readSources([spec], { cwd: repo })
      expect(withheld.documents).toEqual([])
      expect(withheld.skipped[0]).toMatchObject({ reason: "outside-repo" })

      const allowed = await readSources([spec], { cwd: repo, allowOutside: true })
      expect(allowed.documents[0]?.text).toBe("not yours")
    })

    it("reports where a symlink really points, so excludes can match it", async () => {
      const repo = temp({ ".env": "TOKEN=x", "src/a.ts": "code" })
      symlinkSync(join(repo, ".env"), join(repo, "innocent.txt"))
      const r = await readSources([{ kind: "file", path: "innocent.txt" }], { cwd: repo })
      expect(r.documents[0]).toMatchObject({ path: "innocent.txt", realPath: ".env" })
      // A symlink pointing out of the repo is withheld like any other escape.
      const outside = temp({ "k.txt": "secret" })
      symlinkSync(join(outside, "k.txt"), join(repo, "link.txt"))
      const out = await readSources([{ kind: "file", path: "link.txt" }], { cwd: repo })
      expect(out.skipped[0]).toMatchObject({ path: "link.txt", reason: "outside-repo" })
    })
  })
})
