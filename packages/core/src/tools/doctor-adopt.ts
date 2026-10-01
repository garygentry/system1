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
import { insideGitWorkTree } from "../sources/read.js"
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
/** TypeScript or JavaScript: only these call the runtime in-process. */
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/
/** The runtime's own source, whose messages name the opt-out (this repo's engine). */
const RUNTIME_SOURCE = /(^|\/)core\/src\/runtime\/runtime\.[jt]s$/
const BUNDLED = /\bmodule\s*:\s*["']bundled["']/

/**
 * TS/JS source without its comments. A small scanner, not a regex: a `/*` or
 * `//` inside a string (a glob, a URL) is not a comment. Regex literals aren't
 * parsed; one holding a quote or `/*` can still mislead it.
 */
function code(source: string): string {
  let out = ""
  let quote = ""
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string
    if (quote) {
      out += c
      if (c === "\\") out += source[++i] ?? ""
      else if (c === quote) quote = ""
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2)
      i = end < 0 ? source.length : end + 1
    } else if (c === "/" && source[i + 1] === "/") {
      while (i + 1 < source.length && source[i + 1] !== "\n") i++
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c
      out += c
    }
  }
  return out
}
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
        "createPolicyRuntime",
        "-e",
        "module[[:space:]]*:[[:space:]]*[\"']bundled[\"']",
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
    if (marked) modules++
    if (marked && grantIn(source).egress === "on") on.push(path)
    // The opt-out, wherever the options are built: in the call, or in an object passed to it.
    // Not the runtime's own source, whose messages name the opt-out.
    if (SCRIPT.test(path) && !RUNTIME_SOURCE.test(path) && BUNDLED.test(code(source)))
      bundled.push(path)
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
  const lead = modules > 0 ? `${summary}; ` : ""
  return {
    name: "adopted",
    status: "warn",
    advisory: true,
    detail: `${lead}${notes.join("; ")}`,
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

/** `git ls-files` under `path`, NUL-separated. */
function lsFiles(repoRoot: string, path: string, others: boolean): string[] {
  const out = execFileSync(
    "git",
    [
      "-C",
      repoRoot,
      "ls-files",
      "-z",
      ...(others ? ["--others", "--exclude-standard"] : []),
      "--",
      path,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      killSignal: "SIGKILL",
    },
  )
  return out.split("\0").filter(Boolean)
}

/**
 * Everything `compare` keeps in `.system1/compare/` is raw inputs: the shadow
 * capture, the probe states `adopt` reads, and the answers `--record` kept
 * (each holds a captured state). Git must hold none of it.
 */
export function capturedCheck(repoRoot: string): DoctorCheck {
  const dir = join(stateDir(repoRoot), "compare")
  const hasFile = (d: string): boolean =>
    readdirSync(d, { withFileTypes: true }).some((e) =>
      e.isDirectory() ? hasFile(join(d, e.name)) : true,
    )
  if (!existsSync(dir) || !hasFile(dir))
    return { name: "captured", status: "ok", detail: "no shadow captures" }
  if (!insideGitWorkTree(repoRoot))
    return { name: "captured", status: "ok", detail: "shadow captures, not in a git work tree" }
  const rel = relative(repoRoot, dir)
  let committed: string[]
  let exposed: string[]
  try {
    committed = lsFiles(repoRoot, rel, false)
    exposed = lsFiles(repoRoot, rel, true)
  } catch {
    return {
      name: "captured",
      status: "ok",
      detail: "shadow captures; git couldn't say whether they are ignored",
    }
  }
  if (committed.length === 0 && exposed.length === 0)
    return { name: "captured", status: "ok", detail: `${rel}/ ignored by git` }
  // By spec: `.system1/compare/<spec>/`.
  const specs = (files: string[]) => [
    ...new Set(
      files.map((f) => {
        const parts = f.split("/")
        return parts.length > 3 ? `${parts.slice(0, 3).join("/")}/` : f
      }),
    ),
  ]
  return {
    name: "captured",
    status: "warn",
    advisory: true,
    detail: [
      committed.length ? `raw inputs already committed in ${list(specs(committed))}` : "",
      exposed.length ? `raw inputs git would commit in ${list(specs(exposed))}` : "",
    ]
      .filter(Boolean)
      .join("; "),
    fix: [
      "add `.system1/compare/` to .gitignore",
      committed.length
        ? "then `git rm -r --cached .system1/compare/`; the files stay in history until it is rewritten"
        : "",
    ]
      .filter(Boolean)
      .join("; "),
  }
}
