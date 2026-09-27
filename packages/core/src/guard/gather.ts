/**
 * `done-check`, part one: what to judge (M10 §5). The criteria come from the
 * configured files' bullets, as they were when the session started; the
 * change is this session's diff against its base, its untracked files, and
 * any evidence files. Nothing here sends anything: the sources go through
 * `prepare()` (excludes, scrubbing, size) before any question is asked.
 */
import { existsSync, lstatSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { DecisionsError } from "../errors.js"
import type { SourceSpec } from "../sources/types.js"
import { lintStatement } from "../spec/lint.js"
import type { PackContext } from "./done-check.js"
import { snapshotCriteria } from "./done-check.js"
import { git } from "./git.js"
import { type GuardSession, MAX_CRITERIA_FILES } from "./state.js"

/** git's empty tree: the base of a session that started before the first commit. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
/** The most criteria one check sends; the rest are listed for the agent to check. */
export const MAX_CRITERIA = 30
/** A bullet longer than this is not a checkable criterion. */
export const MAX_CRITERION_CHARS = 400
/** The most untracked files read into one check. */
export const MAX_UNTRACKED = 200
/** Never part of the change: decide's own state, and dependencies at any depth. */
const NOT_IN_DIFF = [":(exclude).system1/", ":(exclude,glob)**/node_modules/**"]
const devNull = process.platform === "win32" ? "NUL" : "/dev/null"

/** git's `-z` path list, without decide's state or dependencies. */
function listed(out: string): string[] {
  return out
    .split("\0")
    .filter((p) => p && !p.startsWith(".system1/") && !/(^|\/)node_modules(\/|$)/.test(p))
}

/**
 * Ignored files (not whole ignored directories, such as build output) changed
 * since the session started. They are never read: an ignore rule is the
 * user's to keep private. But a change the check can't see is said out loud.
 */
function changedIgnored(repoRoot: string, paths: string[], since: number): string[] {
  return paths.filter((p) => {
    if (p.endsWith("/")) return false
    try {
      const stat = lstatSync(resolve(repoRoot, p))
      return stat.isFile() && stat.mtimeMs > since
    } catch {
      return false
    }
  })
}

export interface Criterion {
  text: string
  /** Repo-relative path of the criteria file, and the bullet's line in it. */
  file: string
  line: number
}

export interface SelfCheck extends Criterion {
  /** Why it isn't sent: said to the agent in the block reason or message. */
  why: string
}

export interface Gathered {
  /** Sent to the model, two questions each. */
  criteria: Criterion[]
  /** Never sent: for the agent to check itself. */
  checkYourself: SelfCheck[]
  /** Said alongside the outcome, e.g. a criteria file changed mid-session. */
  notes: string[]
  /** The change, for `prepare()`. */
  sources: SourceSpec[]
}

/**
 * The bullets of a markdown file: `-`, `*`, `+`, `1.` or `1)`, with an
 * optional `[ ]` box. Ticked boxes (`[x]`) are done and dropped. Headings,
 * prose and fenced code are not criteria. An indented line right after a
 * bullet continues it.
 */
export function parseBullets(text: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = []
  let fence: string | undefined
  let comment = false
  let open: { text: string; line: number } | undefined
  text.split(/\r?\n/).forEach((raw, i) => {
    if (comment || /^\s*<!--/.test(raw)) {
      comment = !raw.includes("-->")
      open = undefined
      return
    }
    // A fence closes only with the same character, at least as many of it.
    const run = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1]
    if (run) {
      if (!fence) fence = run
      else if (run[0] === fence[0] && run.length >= fence.length && !raw.trim().slice(run.length))
        fence = undefined
      open = undefined
      return
    }
    if (fence) return
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      open = undefined // a horizontal rule
      return
    }
    const bullet = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[( |x|X)\]\s+)?(.*\S)\s*$/.exec(raw)
    if (bullet) {
      open = undefined
      if (bullet[1] === "x" || bullet[1] === "X") return
      open = { text: bullet[2] ?? "", line: i + 1 }
      out.push(open)
      return
    }
    if (open && /^\s{2,}\S/.test(raw)) {
      open.text = `${open.text} ${raw.trim()}`
      return
    }
    open = undefined
  })
  return out
}

/** A configured path as the repo-relative form snapshots use, or undefined if it leaves the repo. */
function repoPath(repoRoot: string, path: string): string | undefined {
  const rel = relative(repoRoot, resolve(repoRoot, path))
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined
  return rel.split("\\").join("/")
}

/**
 * Each criteria file's text as the session started. The files are the ones
 * snapshotted at SessionStart plus any configured now, so editing the config
 * mid-session can add criteria but not drop them. An edited or emptied file
 * is checked against its original, and the note says so. A file created
 * mid-session is used as it is (it can only add checks). A file too long to
 * snapshot is never used, whether it changed or not.
 */
function criteriaTexts(
  ctx: PackContext,
  session: GuardSession,
  notes: string[],
): Array<{ file: string; text: string }> {
  const configured = ctx.pack.criteria
    .map((p) => repoPath(ctx.repoRoot, p))
    .filter((p): p is string => p !== undefined)
  const paths = [...new Set([...session.criteria.map((c) => c.path), ...configured])]
  if (paths.length > MAX_CRITERIA_FILES) {
    notes.push(`only the first ${MAX_CRITERIA_FILES} criteria files were read`)
  }
  const out: Array<{ file: string; text: string }> = []
  for (const file of paths.slice(0, MAX_CRITERIA_FILES)) {
    const atStart = session.criteria.find((c) => c.path === file)
    if (atStart && !configured.includes(file)) {
      notes.push(`${file} was removed from the criteria config during the session; still checked`)
    }
    const now = snapshotCriteria(ctx.repoRoot, [file])[0]
    const text = atStart ? atStart.text : now?.text
    if ((atStart ?? now) && text === undefined) {
      notes.push(`${file} is too long to read as criteria`)
      continue
    }
    if (text === undefined) continue
    if (atStart && now?.sha256 !== atStart.sha256) {
      notes.push(`${file} changed since the session started; checked against the original`)
    }
    out.push({ file, text })
  }
  return out
}

function isRegularFile(repoRoot: string, path: string): boolean {
  try {
    return lstatSync(resolve(repoRoot, path)).isFile()
  } catch {
    return false
  }
}

/** Gather the criteria and the change for one Stop. Sends nothing. */
export async function gather(ctx: PackContext, session: GuardSession): Promise<Gathered> {
  const notes: string[] = []
  const criteria: Criterion[] = []
  const checkYourself: SelfCheck[] = []
  for (const { file, text } of criteriaTexts(ctx, session, notes)) {
    for (const bullet of parseBullets(text)) {
      const c = { text: bullet.text, file, line: bullet.line }
      if (bullet.text.length > MAX_CRITERION_CHARS) {
        checkYourself.push({ ...c, why: "too long to check as one criterion" })
        continue
      }
      const finding = lintStatement(bullet.text)[0]
      if (finding) {
        checkYourself.push({ ...c, why: `${finding.message}: check it yourself` })
        continue
      }
      if (criteria.length >= MAX_CRITERIA) {
        checkYourself.push({ ...c, why: `over the ${MAX_CRITERIA}-criterion limit of one check` })
        continue
      }
      criteria.push(c)
    }
  }

  const sources: SourceSpec[] = []
  if (criteria.length > 0) {
    const git_ = (args: string[]) => git(ctx.repoRoot, args, { signal: ctx.signal })
    let range: string
    if (session.base) {
      try {
        await git_(["cat-file", "-e", `${session.base}^{commit}`])
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error
        throw new DecisionsError(
          "source-error",
          "the session's base commit no longer exists (history was rewritten), so this session's change can't be found",
        )
      }
      range = session.base
    } else {
      // The empty tree, as this repo's hash function names it (SHA-1 or SHA-256).
      range = (await git_(["hash-object", "-t", "tree", devNull])).trim()
    }
    sources.push({ kind: "diff", range, paths: [".", ...NOT_IN_DIFF] })
    const untracked = listed(await git_(["ls-files", "--others", "--exclude-standard", "-z"]))
      .filter((p) => isRegularFile(ctx.repoRoot, p))
      .sort()
    if (untracked.length > MAX_UNTRACKED) {
      notes.push(
        `${untracked.length - MAX_UNTRACKED} untracked files were left out (over ${MAX_UNTRACKED})`,
      )
    }
    for (const path of untracked.slice(0, MAX_UNTRACKED)) {
      sources.push({ kind: "file", path, optional: true })
    }
    const hidden = changedIgnored(
      ctx.repoRoot,
      listed(
        await git_([
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
          "-z",
        ]),
      ),
      Date.parse(session.startedAt),
    )
    if (hidden.length > 0) {
      const shown = hidden.slice(0, 5).join(", ")
      notes.push(
        `ignored files changed during the session and weren't checked: ${shown}${hidden.length > 5 ? ` and ${hidden.length - 5} more` : ""}`,
      )
    }
    for (const configured of ctx.pack.evidence) {
      const path = repoPath(ctx.repoRoot, configured)
      if (path && existsSync(resolve(ctx.repoRoot, path)) && isRegularFile(ctx.repoRoot, path)) {
        sources.push({ kind: "file", path, optional: true })
      } else {
        notes.push(`evidence file ${configured} was not found`)
      }
    }
  }
  return { criteria, checkYourself, notes, sources }
}
