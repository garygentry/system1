import {
  assertExamples,
  createContext,
  DecisionsError,
  exampleProblems,
  listSpecs,
  loadSpec,
  runSpecCheck,
  type SpecCheckResult,
} from "@garygentry/system1-core"
import { typedParse } from "../args.js"
import type { Format } from "../envelope.js"
import { EXIT, type ExitCode } from "../exit-codes.js"
import { briefSpecCheck } from "../format.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/** `decide spec list | show <name> | validate [name|path] | check <name|path>`. */
export function runSpecCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  const [action = "list", ref] = argv
  const ctx = () => createContext({ ...io, cwd: io.cwd ?? process.cwd(), env: io.env })
  switch (action) {
    case "list":
      return emit(
        io,
        "spec",
        format,
        () => ({ specs: listSpecs(ctx().specDirs) }),
        (r, f) =>
          f === "brief"
            ? r.specs.length
              ? r.specs
                  .map(
                    (s) =>
                      `${s.name}  [${s.origin}${s.shadowed ? ", shadowed" : ""}]  ${s.error ? `INVALID: ${s.error.split("\n")[0]}` : s.description}`,
                  )
                  .join("\n")
              : "no specs found"
            : undefined,
      )
    case "show":
      return emit(io, "spec", format, () => {
        if (!ref) throw new DecisionsError("invalid-request", "Usage: decide spec show <name|path>")
        const c = ctx()
        return loadSpec(ref, c.specDirs, c.cwd)
      })
    case "validate":
      return emit(
        io,
        "spec",
        format,
        () => {
          const c = ctx()
          const root = c.config.repoRoot
          if (ref) {
            const spec = loadSpec(ref, c.specDirs, c.cwd)
            assertExamples(spec, root)
            return { valid: [spec.name], invalid: [] as Array<{ name: string; error: string }> }
          }
          const all = listSpecs(c.specDirs)
          const invalid = all.flatMap((s) => {
            if (s.error) return [{ name: s.name, error: s.error }]
            const problems = exampleProblems(loadSpec(s.file, c.specDirs, c.cwd), root)
            return problems.length ? [{ name: s.name, error: problems.join("\n") }] : []
          })
          if (invalid.length) {
            throw new DecisionsError(
              "invalid-request",
              `${invalid.length} invalid spec(s): ${invalid.map((i) => i.name).join(", ")}`,
              { invalid },
            )
          }
          return { valid: all.map((s) => s.name), invalid }
        },
        (r, f) => (f === "brief" ? `valid: ${r.valid.join(", ") || "(none)"}` : undefined),
      )
    case "check":
      return check(argv.slice(1), io, format, ctx)
    default:
      return emit(io, "spec", format, () => {
        throw new DecisionsError(
          "invalid-request",
          `Unknown spec action "${action}". Use: list, show, validate, check`,
        )
      })
  }
}

/**
 * A mismatch is a result (`passed: false`, exit 0), not an error (0015).
 * `--strict` opts into exit 7 for it, so a CI step can gate on the exit code.
 */
async function check(
  argv: string[],
  io: Io,
  format: Format,
  ctx: () => ReturnType<typeof createContext>,
): Promise<ExitCode> {
  let failed = false
  const code = await emit<SpecCheckResult>(
    io,
    "spec",
    format,
    async () => {
      const result = await runSpecCheck(ctx(), checkInput(argv))
      failed = !result.passed
      return result
    },
    (r, f) => (f === "brief" ? briefSpecCheck(r) : undefined),
  )
  return code === EXIT.ok && failed && parse(argv).values.strict ? EXIT.checkFailed : code
}

/**
 * `spec check <name> [--live|--replay] [--confirm] [--model <id>] [--strict]`.
 * Replay is the default; `--live` records fresh answers into the spec's fixtures.
 */
function checkInput(argv: string[]): Record<string, unknown> {
  const { values, positionals } = parse(argv)
  const [spec, extra] = positionals
  if (!spec || extra !== undefined) {
    throw new DecisionsError(
      "invalid-request",
      "Usage: decide spec check <name|path> [--live] [--confirm] [--model <id>] [--strict]",
    )
  }
  if (values.live && values.replay) {
    throw new DecisionsError("invalid-request", "Pick one of --live, --replay")
  }
  return {
    spec,
    mode: values.live ? "record" : "replay",
    ...(values.confirm ? { confirm: true } : {}),
    ...(values.model ? { model: values.model } : {}),
  }
}

/** Flags of `spec check`. Exported so `docs/cli.md` can be checked against them. */
export const SPEC_OPTIONS = {
  live: { type: "boolean" },
  replay: { type: "boolean" },
  confirm: { type: "boolean" },
  model: { type: "string" },
  strict: { type: "boolean" },
} as const

function parse(argv: string[]) {
  return typedParse({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: SPEC_OPTIONS,
  })
}
