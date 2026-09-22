import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { glob } from "tinyglobby"
import { DecisionsError } from "../errors.js"
import type { Document, LineRange, Skipped, SourceSpec } from "./types.js"

export interface ReadOptions {
  /** Paths resolve against this directory (normally the repo root). */
  cwd: string
  /** Files larger than this are skipped as `too-large` without being read. */
  maxFileBytes?: number
}

export interface ReadResult {
  documents: Document[]
  skipped: Skipped[]
}

const DEFAULT_MAX_FILE_BYTES = 2_000_000

/** Never content: dependencies, git internals, and our own state (config, fixtures, ledger). */
const ALWAYS_IGNORED = ["**/node_modules/**", "**/.git/**", "**/.decisions/**"]

export async function readSources(
  specs: readonly SourceSpec[],
  options: ReadOptions,
): Promise<ReadResult> {
  const documents: Document[] = []
  const skipped: Skipped[] = []
  for (const spec of specs) {
    const result = await readSource(spec, options)
    documents.push(...result.documents)
    skipped.push(...result.skipped)
  }
  return { documents, skipped }
}

async function readSource(spec: SourceSpec, options: ReadOptions): Promise<ReadResult> {
  switch (spec.kind) {
    case "text":
      return { documents: [{ id: spec.id ?? "text", kind: "text", text: spec.text }], skipped: [] }
    case "stdin":
      return { documents: [{ id: "stdin", kind: "text", text: spec.text }], skipped: [] }
    case "file":
      return readFiles([spec.path], options, spec.range)
    case "glob":
      return readGlob(spec.patterns, options)
    case "jsonl":
      return { documents: readJsonl(spec.path, options), skipped: [] }
    case "diff":
      return { documents: readDiff(spec, options), skipped: [] }
  }
}

/**
 * Parse `path`, `path:12` or `path:12-40` (1-based, inclusive). A bare `:`
 * suffix that isn't a line spec stays part of the path.
 */
export function parseFileRef(ref: string): { path: string; range?: LineRange } {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(ref)
  if (!match?.[1]) return { path: ref }
  const start = Number(match[2])
  const end = match[3] === undefined ? start : Number(match[3])
  if (start < 1 || end < start) {
    throw new DecisionsError(
      "invalid-request",
      `Invalid line range in "${ref}" (use path:START-END, 1-based)`,
    )
  }
  return { path: match[1], range: { start, end } }
}

function readFiles(paths: readonly string[], options: ReadOptions, range?: LineRange): ReadResult {
  const documents: Document[] = []
  const skipped: Skipped[] = []
  const limit = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  for (const path of paths) {
    const absolute = resolve(options.cwd, path)
    const rel = toRel(options.cwd, absolute)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new DecisionsError("source-error", `No such file: ${rel}`, { path: rel })
    }
    if (statSync(absolute).size > limit) {
      skipped.push({ path: rel, reason: "too-large", detail: `> ${limit} bytes` })
      continue
    }
    const buffer = readFileSync(absolute)
    if (buffer.subarray(0, 8000).includes(0)) {
      skipped.push({ path: rel, reason: "binary" })
      continue
    }
    let text = buffer.toString("utf8")
    let startLine = 1
    if (range) {
      const lines = text.split("\n")
      if (range.start > lines.length) {
        throw new DecisionsError(
          "source-error",
          `${rel} has ${lines.length} lines; range starts at ${range.start}`,
        )
      }
      text = lines.slice(range.start - 1, range.end).join("\n")
      startLine = range.start
    }
    const id = range
      ? `${rel}:${range.start}-${Math.min(range.end, startLine + text.split("\n").length - 1)}`
      : rel
    documents.push({ id, kind: "file", path: rel, text, startLine })
  }
  return { documents, skipped }
}

async function readGlob(patterns: readonly string[], options: ReadOptions): Promise<ReadResult> {
  const matches = await glob([...patterns], {
    cwd: options.cwd,
    ignore: ALWAYS_IGNORED,
    dot: true,
    onlyFiles: true,
  })
  matches.sort()
  const ignored = new Set(gitIgnored(options.cwd, matches))
  const kept = matches.filter((m) => !ignored.has(m))
  const result = readFiles(kept, options)
  return {
    documents: result.documents,
    skipped: [
      ...[...ignored].map((path) => ({ path, reason: "gitignored" as const })),
      ...result.skipped,
    ],
  }
}

/**
 * The subset of `paths` git would ignore, when `cwd` is inside a work tree.
 * Outside one, nothing is filtered (and `node_modules`/`.git` are still skipped).
 */
export function gitIgnored(cwd: string, paths: readonly string[]): string[] {
  if (paths.length === 0 || !insideGitWorkTree(cwd)) return []
  try {
    const out = execFileSync("git", ["-C", cwd, "check-ignore", "-z", "--stdin"], {
      input: paths.join("\0"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    })
    return out.split("\0").filter(Boolean)
  } catch (error) {
    // Exit 1 means "none ignored", which is not an error.
    if ((error as { status?: number }).status === 1) return []
    throw new DecisionsError("source-error", `git check-ignore failed: ${String(error)}`)
  }
}

function insideGitWorkTree(cwd: string): boolean {
  try {
    return (
      execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    )
  } catch {
    return false
  }
}

function readJsonl(path: string, options: ReadOptions): Document[] {
  const absolute = resolve(options.cwd, path)
  const rel = toRel(options.cwd, absolute)
  if (!existsSync(absolute))
    throw new DecisionsError("source-error", `No such file: ${rel}`, { path: rel })
  const documents: Document[] = []
  readFileSync(absolute, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.trim() === "") return
      let data: unknown
      try {
        data = JSON.parse(line)
      } catch {
        throw new DecisionsError("source-error", `${rel}:${index + 1} is not valid JSON`, {
          path: rel,
          line: index + 1,
        })
      }
      documents.push({
        id: `${rel}:row${index + 1}`,
        kind: "row",
        path: rel,
        data,
        startLine: index + 1,
      })
    })
  return documents
}

/** One document per file in the diff, text starting at its `diff --git` header. */
function readDiff(spec: Extract<SourceSpec, { kind: "diff" }>, options: ReadOptions): Document[] {
  if (spec.range?.startsWith("-")) {
    throw new DecisionsError("invalid-request", `Invalid diff range "${spec.range}"`)
  }
  const args = ["-C", options.cwd, "diff", "--no-color", "--no-ext-diff", "--unified=3"]
  if (spec.staged) args.push("--cached")
  args.push(spec.range ?? "HEAD", "--", ...(spec.paths ?? []))
  let out: string
  try {
    out = execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error).trim()
    throw new DecisionsError("source-error", `git diff failed: ${stderr}`)
  }
  return splitDiffByFile(out)
}

export function splitDiffByFile(diff: string): Document[] {
  const sections = diff.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "))
  return sections.map((text) => {
    const path =
      /^\+\+\+ b\/(.+)$/m.exec(text)?.[1] ??
      /^diff --git a\/.+ b\/(.+)$/m.exec(text)?.[1] ??
      "unknown"
    return { id: `${path}#diff`, kind: "diff" as const, path, text: text.replace(/\n$/, "") }
  })
}

function toRel(cwd: string, absolute: string): string {
  const rel = relative(cwd, absolute)
  return rel === "" || isAbsolute(rel) || rel.startsWith("..")
    ? absolute
    : rel.split("\\").join("/")
}
