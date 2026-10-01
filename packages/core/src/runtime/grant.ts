/**
 * Reading runtime consent from an adopted module's own source (0020, plan
 * m11-adopt D1 and D7). The grant is one marked line of reviewed code:
 *
 *   TypeScript: `const EGRESS = "off" // system1: runtime egress …`
 *   Python:     `EGRESS = "off"  # system1: runtime egress …`
 *
 * `adopt` only ever writes `"off"`; switching it to `"on"` is the user's edit.
 * Nothing else is a grant: no flag, no environment variable, no config file.
 */
import { readFileSync } from "node:fs"

/** The comment that marks the one grant line. */
export const EGRESS_MARKER = "system1: runtime egress"

/**
 * The stdin/stdout shape of `decide runtime`. It changes only when that shape
 * does, so a Python module checks it rather than the CLI version, and
 * upgrading a global `decide` doesn't switch every module to fallback.
 */
export const RUNTIME_PROTOCOL = 1

/**
 * `const EGRESS = "on"`, `export const EGRESS: Egress = 'on'`, `EGRESS = "on"`,
 * `EGRESS: Final = "on"`, `const EGRESS = "on" as const`: the literal `on`
 * assigned to `EGRESS`, followed only by the marker comment.
 *
 * - **At column 0**, where a module-level binding sits: an indented line (in
 *   an `if`, a function or a docstring's body) is off. A template also checks
 *   its own value before it spawns `decide`, so file and value must agree.
 * - **A type annotation can't hold `=`, a quote-free comment opener or a
 *   newline,** so `EGRESS: "= 'on' #" = "off"` can't pass for a grant.
 * - **Nothing but the marker comment after it,** so `"on" if os.environ…` or
 *   `"on" || x` is no grant: consent is never computed, only written.
 */
const ON =
  /^(?:export\s+)?(?:(?:const|let|var)\s+)?EGRESS\s*(?::\s*[^=#/\n]+?\s*)?=\s*(["'])on\1\s*(?:(?:as|satisfies)\s+[\w.]+\s*)?;?\s*(?:\/\/|#)\s*system1: runtime egress/

export interface ModuleGrant {
  egress: "on" | "off"
  /** Why it is off, for the fallback's detail. */
  why?: string
}

/**
 * The grant a module's source holds: `on` only when exactly one line carries
 * the marker and that line assigns `"on"` to `EGRESS`. Anything else, two
 * marked lines, no marked line, or any other value, is off.
 */
export function grantIn(source: string): ModuleGrant {
  const marked = source.split(/\r?\n/).filter((line) => line.includes(EGRESS_MARKER))
  if (marked.length === 0) return { egress: "off", why: "the module has no marked EGRESS line" }
  if (marked.length > 1)
    return { egress: "off", why: `the module has ${marked.length} marked EGRESS lines, not one` }
  return ON.test(marked[0] as string)
    ? { egress: "on" }
    : { egress: "off", why: "the module's EGRESS line is off" }
}

/** `grantIn` over a module file; an unreadable file is `undefined`, for the caller to report. */
export function readModuleGrant(path: string): ModuleGrant | undefined {
  let source: string
  try {
    source = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  return grantIn(source)
}
