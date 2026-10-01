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

/** Tests, build output and skill templates: they mention the runtime, but aren't what an app runs. */
const NOT_APP_CODE =
  /(^|\/)(node_modules|dist|build|__tests__|tests?|fixtures|templates)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/
/** Source an adopted module could be: TypeScript, JavaScript or Python. */
const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/

/**
 * Files that hold a grant line or call the TS runtime. A Python module that
 * spawns `decide runtime` without the line is off anyway: it reads the file.
 * Found by `git grep` (tracked and untracked, not ignored).
 */
function runtimeFiles(repoRoot: string): string[] | undefined {
  try {
    const out = execFileSync(
      "git",
      [
        "-C",
        repoRoot,
        "grep",
        "-l",
        "-I",
        "--untracked",
        "-E",
        "-e",
        EGRESS_MARKER,
        "-e",
        "createPolicyRuntime\\s*\\(\\s*\\{",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
        killSignal: "SIGKILL",
      },
    )
    return out.split("\n").filter((p) => p && SOURCE.test(p) && !NOT_APP_CODE.test(p))
  } catch (error) {
    // Exit 1: no match. Anything else (not a work tree, no git): not looked for.
    return (error as { status?: number }).status === 1 ? [] : undefined
  }
}

const list = (paths: string[]) =>
  paths.length <= 3
    ? paths.join(", ")
    : `${paths.slice(0, 3).join(", ")} (+${paths.length - 3} more)`

/**
 * Adopted modules and their runtime grant (0020). Egress on is the user's
 * edit, so it is reported, not failed: doctor makes it visible. So are a
 * `"bundled"` opt-out (one lock instead of two) and a runtime call with no
 * marked line to read.
 */
export function adoptedCheck(repoRoot: string): DoctorCheck {
  const files = runtimeFiles(repoRoot)
  if (files === undefined)
    return {
      name: "adopted",
      status: "ok",
      detail: "not a git work tree: adopted modules not looked for",
    }
  if (files.length === 0) return { name: "adopted", status: "ok", detail: "no adopted modules" }
  const on: string[] = []
  const bundled: string[] = []
  const unmarked: string[] = []
  let modules = 0
  for (const path of files) {
    let source: string
    try {
      source = readFileSync(join(repoRoot, path), "utf8")
    } catch {
      continue
    }
    const marked = source.includes(EGRESS_MARKER)
    if (marked) modules++
    if (marked && grantIn(source).egress === "on") on.push(path)
    if (/\bmodule\s*:\s*["']bundled["']/.test(source)) bundled.push(path)
    if (!marked) unmarked.push(path)
  }
  const notes = [
    on.length ? `runtime egress ON in ${list(on)}` : "",
    bundled.length ? `module lock opted out ("bundled") in ${list(bundled)}` : "",
    unmarked.length ? `runtime calls with no marked EGRESS line in ${list(unmarked)}` : "",
  ].filter(Boolean)
  const summary = `${modules} adopted module${modules === 1 ? "" : "s"}`
  if (notes.length === 0)
    return { name: "adopted", status: "ok", detail: `${summary}, runtime egress off in all` }
  return {
    name: "adopted",
    status: "warn",
    advisory: true,
    detail: `${summary}; ${notes.join("; ")}`,
    fix: "egress on and \"bundled\" are your edits to make (docs/runtime.md); if you didn't make them, review the module's diff",
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

/** Shadow captures hold raw inputs: each must be ignored by git. */
export function capturedCheck(repoRoot: string): DoctorCheck {
  const root = join(stateDir(repoRoot), "compare")
  const files = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "captured.jsonl")))
        .map((e) => relative(repoRoot, join(root, e.name, "captured.jsonl")))
    : []
  if (files.length === 0) return { name: "captured", status: "ok", detail: "no shadow captures" }
  if (!insideGitWorkTree(repoRoot))
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture(s), not in a git work tree`,
    }
  let ignored: Set<string>
  try {
    ignored = new Set(gitIgnored(repoRoot, files))
  } catch {
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture(s); git couldn't say whether they are ignored`,
    }
  }
  const exposed = files.filter((f) => !ignored.has(f))
  if (exposed.length === 0)
    return {
      name: "captured",
      status: "ok",
      detail: `${files.length} capture(s), all ignored by git`,
    }
  return {
    name: "captured",
    status: "warn",
    advisory: true,
    detail: `shadow captures hold raw inputs and git would commit them: ${list(exposed)}`,
    fix: "add `.system1/compare/*/captured.jsonl` to .gitignore",
  }
}
