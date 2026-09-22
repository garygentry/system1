import { describe, expect, it } from "vitest"
import { splitDiffByFile } from "../sources/read.js"
import type { Document } from "../sources/types.js"
import { parseSplit, split } from "./split.js"

const file = (text: string, startLine = 1): Document => ({
  id: "a.ts",
  kind: "file",
  path: "a.ts",
  text,
  startLine,
})

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@ function f() {
 ten
+ten and a half
 eleven
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`

describe("parseSplit", () => {
  it.each([
    ["file", { kind: "file" }],
    ["hunk", { kind: "hunk" }],
    ["row", { kind: "row" }],
    ["lines:40", { kind: "lines", size: 40, overlap: 0 }],
    ["lines:40/10", { kind: "lines", size: 40, overlap: 10 }],
  ])("parses %s", (text, spec) => {
    expect(parseSplit(text)).toEqual(spec)
  })

  it.each(["lines:0", "lines:10/10", "function", "lines"])("rejects %s", (text) => {
    expect(() => parseSplit(text)).toThrow(expect.objectContaining({ code: "invalid-request" }))
  })
})

describe("split", () => {
  it("file: one item per document with its line span", () => {
    expect(split([file("a\nb\nc")], { kind: "file" })).toEqual([
      { id: "a.ts", state: "a\nb\nc", path: "a.ts", lines: { start: 1, end: 3 } },
    ])
  })

  it("lines: overlapping windows with absolute line numbers, last window not duplicated", () => {
    const items = split([file("1\n2\n3\n4\n5", 10)], { kind: "lines", size: 3, overlap: 1 })
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ["a.ts:10-12", "1\n2\n3"],
      ["a.ts:12-14", "3\n4\n5"],
    ])
  })

  it("row: non-empty lines of text, numbered", () => {
    expect(split([file("a\n\nb")], { kind: "row" }).map((i) => [i.id, i.state])).toEqual([
      ["a.ts:1", "a"],
      ["a.ts:3", "b"],
    ])
  })

  it("row: JSONL rows pass through as structured state", () => {
    const row: Document = {
      id: "r.jsonl:row2",
      kind: "row",
      path: "r.jsonl",
      data: { x: 1 },
      startLine: 2,
    }
    expect(split([row], { kind: "file" })).toEqual([
      { id: "r.jsonl:row2", state: { x: 1 }, path: "r.jsonl", lines: { start: 2, end: 2 } },
    ])
  })

  it("hunk: each hunk with its file header and new-side line span", () => {
    const items = split(splitDiffByFile(DIFF).documents, { kind: "hunk" })
    expect(items.map((i) => [i.id, i.lines])).toEqual([
      ["a.ts#h1", { start: 1, end: 3 }],
      ["a.ts#h2", { start: 10, end: 12 }],
      ["b.ts#h1", { start: 1, end: 1 }],
    ])
    expect(items[1]?.state).toBe(
      "--- a/a.ts\n+++ b/a.ts\n@@ -10,2 +10,3 @@ function f() {\n ten\n+ten and a half\n eleven",
    )
  })

  it("hunk: refuses non-diff documents", () => {
    expect(() => split([file("x")], { kind: "hunk" })).toThrow(/needs a diff source/)
  })

  it("decodes a git-quoted path, and withholds a diff whose path can't be read", () => {
    const quoted =
      'diff --git "a/secrets/\\303\\251.txt" "b/secrets/\\303\\251.txt"\n--- "a/secrets/\\303\\251.txt"\n+++ "b/secrets/\\303\\251.txt"\n@@ -1 +1 @@\n-old\n+new\n'
    const r = splitDiffByFile(quoted)
    expect(r.documents[0]?.path).toBe("secrets/é.txt")
    const broken = "diff --git (malformed header)\n@@ -1 +1 @@\n-old\n+new\n"
    const b = splitDiffByFile(broken)
    expect(b.documents).toHaveLength(0)
    expect(b.skipped[0]).toMatchObject({ reason: "excluded", detail: "unreadable diff path" })
  })
})
