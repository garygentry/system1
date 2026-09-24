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
    ? [entry(loadSpec(input.spec, ctx.specDirs, ctx.cwd))]
    : listSpecs(ctx.specDirs)
        .filter((s) => !s.shadowed)
        .map((s) =>
          s.error
            ? { name: s.name, file: s.file, origin: s.origin, findings: [], invalid: s.error }
            : entry(loadSpec(s.file, ctx.specDirs, ctx.cwd)),
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

function entry(spec: Spec): SpecLintEntry {
  return { name: spec.name, file: spec.file, origin: spec.origin, findings: lintSpec(spec) }
}
