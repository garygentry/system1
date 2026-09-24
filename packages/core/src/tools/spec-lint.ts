import { basename, extname } from "node:path"
import { isDecisionsError } from "../errors.js"
import { type LintFinding, lintSpec } from "../spec/lint.js"
import { listSpecs, loadSpec, type Spec } from "../spec/spec.js"
import { checkInput, type ToolContext } from "./context.js"
import type { SpecLintInput } from "./schemas.js"

export interface SpecLintEntry {
  name: string
  file: string
  origin: Spec["origin"]
  findings: LintFinding[]
  /** Set when the spec doesn't parse: it can't be linted until it does. */
  invalid?: string
}

export interface SpecLintResult {
  specs: SpecLintEntry[]
  counts: { specs: number; errors: number; warnings: number; invalid: number }
  /**
   * No errors and no invalid specs. Warnings don't fail it; `--strict` makes
   * them fail too (exit 7).
   */
  passed: boolean
}

/**
 * Lint one spec, or every spec in reach (repo, user, bundled). Offline: no key,
 * no consent, no egress. A finding is a result, not an error.
 */
export function runSpecLint(ctx: ToolContext, rawInput: unknown = {}): SpecLintResult {
  const input = checkInput<SpecLintInput>("spec-lint", rawInput)
  const specs: SpecLintEntry[] = input.spec
    ? [named(ctx, input.spec)]
    : listSpecs(ctx.specDirs)
        .filter((s) => !s.shadowed)
        .map((s) =>
          s.error
            ? { name: s.name, file: s.file, origin: s.origin, findings: [], invalid: s.error }
            : // Loaded by path, so keep the layer it was listed from.
              { ...entry(loadSpec(s.file, ctx.specDirs, ctx.cwd)), origin: s.origin },
        )
  const all = specs.flatMap((s) => s.findings)
  const counts = {
    specs: specs.length,
    errors: all.filter((f) => f.severity === "error").length,
    warnings: all.filter((f) => f.severity === "warning").length,
    invalid: specs.filter((s) => s.invalid).length,
  }
  return { specs, counts, passed: counts.errors === 0 && counts.invalid === 0 }
}

/**
 * A named spec that exists but doesn't parse is an `invalid` entry (exit 7),
 * as it is when linting every spec. One that can't be found is still an error.
 */
function named(ctx: ToolContext, ref: string): SpecLintEntry {
  try {
    return entry(loadSpec(ref, ctx.specDirs, ctx.cwd))
  } catch (error) {
    const file = isDecisionsError(error) ? error.details?.file : undefined
    if (typeof file !== "string") throw error
    return {
      name: basename(file, extname(file)),
      file,
      origin: "path",
      findings: [],
      invalid: (error as Error).message,
    }
  }
}

function entry(spec: Spec): SpecLintEntry {
  return { name: spec.name, file: spec.file, origin: spec.origin, findings: lintSpec(spec) }
}
