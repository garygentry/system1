import { createContext, DecisionsError, listSpecs, loadSpec } from "@garygentry/decisions-core"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/** `decide spec list | show <name> | validate [name|path]`. */
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
          if (ref) {
            const spec = loadSpec(ref, c.specDirs, c.cwd)
            return { valid: [spec.name], invalid: [] as Array<{ name: string; error: string }> }
          }
          const all = listSpecs(c.specDirs)
          const invalid = all
            .filter((s) => s.error)
            .map((s) => ({ name: s.name, error: s.error as string }))
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
    default:
      return emit(io, "spec", format, () => {
        throw new DecisionsError(
          "invalid-request",
          `Unknown spec action "${action}". Use: list, show, validate`,
        )
      })
  }
}
