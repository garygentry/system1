/**
 * Doctor's checks for `adopt` and `compare` (M11 §9): what adopted code may
 * send, which emulated baselines may receive this repo's content, and whether
 * a capture of raw inputs could be committed. Read-only, like all of doctor.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { ProfileGrant } from "../config/load.js"
import { stateDir } from "../config/load.js"
import { EGRESS_MARKER, grantIn } from "../runtime/grant.js"
import { gitIgnored, insideGitWorkTree } from "../sources/read.js"
import type { DoctorCheck } from "./doctor.js"

/**
 * Tests and skill templates: they hold grant lines to test or copy, not what
 * an app runs. Only adopt's own `references/templates/`, so an app's
 * `src/templates/` or `build/` is still looked at.
 */
const NOT_APP_CODE =
  /(^|\/)(node_modules|__tests__|tests?|fixtures)\/|(^|\/)references\/templates\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/
/** Source an adopted module could be: TypeScript, JavaScript or Python. */
const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/
/** A runtime call in code, not in a comment line. */
const CALL = /^(?!\s*(?:\/\/|\/?\*|#)).*\bcreatePolicyRuntime\s*\(\s*\{/m
const BUNDLED = /\bmodule\s*:\s*["']bundled["']/
/** A module's grant line: `EGRESS` set at the start of the line that carries the marker. */
const GRANT_LINE = new RegExp(
  `^(?:export\\s+)?(?:(?:const|let|var)\\s+)?EGRESS\\b.*${EGRESS_MARKER}`,
  "m",
)

/**
 * Files that hold a grant line or call the TS runtime, by `git grep` (tracked
 * and untracked, not ignored), or why they couldn't be looked for. A Python
 * module that spawns the CLI without the line is off anyway: it reads the file.
 */
function runtimeFiles(repoRoot: string): string[] | string {
  if (!insideGitWorkTree(repoRoot)) return "not a git work tree: adopted modules not looked for"
  try {
    const out = execFileSync(
      "git",
      [
        "-C",
        repoRoot,
        "grep",
        "-l",
        "-z",
        "-I",
        "--untracked",
        "-E",
        "-e",
        EGRESS_MARKER,
        "-e",
        "createPolicyRuntime[[:space:]]*\\([[:space:]]*\\{",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
        killSignal: "SIGKILL",
      },
    )
    return out.split("\0").filter((p) => p && SOURCE.test(p) && !NOT_APP_CODE.test(p))
  } catch (error) {
    // Exit 1: no match.
    if ((error as { status?: number }).status === 1) return []
    return `git grep failed${(error as { signal?: string }).signal === "SIGKILL" ? " (timed out)" : ""}: adopted modules not looked for`
  }
}

const list = (paths: string[]) =>
  paths.length <= 3
    ? paths.join(", ")
    : `${paths.slice(0, 3).join(", ")} (+${paths.length - 3} more)`

/**
 * Adopted modules and their runtime grant (0020). Egress on is the user's
 * edit, so it is reported, not failed: doctor makes it visible. So is a
 * `"bundled"` opt-out, where the value passed is the only lock. A runtime
 * call with no marked line and no opt-out can't send: the module lock reads
 * the file.
 */
export function adoptedCheck(repoRoot: string): DoctorCheck {
  const files = runtimeFiles(repoRoot)
  if (typeof files === "string") return { name: "adopted", status: "ok", detail: files }
  const on: string[] = []
  const bundled: string[] = []
  let modules = 0
  for (const path of files) {
    let source: string
    try {
      source = readFileSync(join(repoRoot, path), "utf8")
    } catch {
      continue
    }
    const marked = GRANT_LINE.test(source)
    if (!marked && !CALL.test(source)) continue
    if (marked) modules++
    if (marked && grantIn(source).egress === "on") on.push(path)
    if (BUNDLED.test(source)) bundled.push(path)
  }
  if (modules === 0 && bundled.length === 0)
    return { name: "adopted", status: "ok", detail: "no adopted modules" }
  const notes = [
    on.length ? `runtime egress ON in ${list(on)}` : "",
    bundled.length ? `module lock opted out ("bundled") in ${list(bundled)}` : "",
  ].filter(Boolean)
  const summary = `${modules} adopted module${modules === 1 ? "" : "s"}`
  if (notes.length === 0)
    return { name: "adopted", status: "ok", detail: `${summary}, runtime egress off in all` }
  return {
    name: "adopted",
    status: "warn",
    advisory: true,
    detail: `${summary}; ${notes.join("; ")}`,
    fix: "switching egress on and writing \"bundled\" are your edits (docs/runtime.md); if you didn't make them, review the module's diff",
  }
}

/** Emulated baselines this repo lets `compare` send content to (a second vendor, its own opt-in). */
export function emulatedCheck(allowProfiles: ProfileGrant[]): DoctorCheck {
  if (allowProfiles.length === 0)
    return { name: "emulated", status: "ok", detail: "no emulated baseline allowed" }
  const ids = allowProfiles.map((g) => g.id).join(", ")
  return {
    name: "emulated",
    status: "ok",
    detail: `compare may send this repo's content to: ${ids} (egress.allowProfiles)`,
  }
}

/**
 * Raw inputs on disk: each shadow capture, and the answers `compare --record`
 * kept for it (`fixtures/compare.<spec>/`, which hold every captured state).
 * One file stands for each recorded directory.
 */
function rawInputFiles(repoRoot: string): string[] {
  const files: string[] = []
  const compare = join(stateDir(repoRoot), "compare")
  if (existsSync(compare))
    for (const e of readdirSync(compare, { withFileTypes: true }))
      if (e.isDirectory() && existsSync(join(compare, e.name, "captured.jsonl")))
        files.push(relative(repoRoot, join(compare, e.name, "captured.jsonl")))
  const fixtures = join(stateDir(repoRoot), "fixtures")
  if (existsSync(fixtures))
    for (const e of readdirSync(fixtures, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith("compare.")) continue
      const first = readdirSync(join(fixtures, e.name)).find((f) => f.endsWith(".json"))
      if (first) files.push(relative(repoRoot, join(fixtures, e.name, first)))
    }
  return files
}

/** Which of `paths` git already tracks: ignoring them now won't take them out. */
function gitTracked(repoRoot: string, paths: string[]): Set<string> {
  const out = execFileSync("git", ["-C", repoRoot, "ls-files", "-z", "--", ...paths], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
    killSignal: "SIGKILL",
  })
  return new Set(out.split("\0").filter(Boolean))
}

/** Shadow captures and compare's recorded answers hold raw inputs: git must not have them. */
export function capturedCheck(repoRoot: string): DoctorCheck {
  const files = rawInputFiles(repoRoot)
  if (files.length === 0) return { name: "captured", status: "ok", detail: "no shadow captures" }
  if (!insideGitWorkTree(repoRoot))
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture file(s), not in a git work tree`,
    }
  let tracked: Set<string>
  let ignored: Set<string>
  try {
    tracked = gitTracked(repoRoot, files)
    ignored = new Set(gitIgnored(repoRoot, files))
  } catch {
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture file(s); git couldn't say whether they are ignored`,
    }
  }
  const committed = files.filter((f) => tracked.has(f))
  const exposed = files.filter((f) => !tracked.has(f) && !ignored.has(f))
  if (committed.length === 0 && exposed.length === 0)
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture file(s), all ignored by git`,
    }
  const where = (f: string) => (f.includes("/fixtures/") ? f.slice(0, f.lastIndexOf("/") + 1) : f)
  return {
    name: "captured",
    status: "warn",
    advisory: true,
    detail: [
      committed.length ? `raw inputs already committed: ${list(committed.map(where))}` : "",
      exposed.length ? `raw inputs git would commit: ${list(exposed.map(where))}` : "",
    ]
      .filter(Boolean)
      .join("; "),
    fix: [
      "add `.system1/compare/` and `.system1/fixtures/compare.*/` to .gitignore",
      committed.length
        ? "then `git rm -r --cached` the committed ones; they stay in history until it is rewritten"
        : "",
    ]
      .filter(Boolean)
      .join("; "),
  }
}
