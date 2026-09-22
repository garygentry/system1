import { type DoctorResult, runDoctor } from "@garygentry/decisions-core"
import type { Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

/**
 * Report whether `decide` works from this shell. A failed check is a finding,
 * not a command failure: the envelope is ok and the exit code 0, and
 * `healthy` says whether anything failed.
 */
export function runDoctorCommand(io: Io, format: Format): Promise<ExitCode> {
  return emit(
    io,
    "doctor",
    format,
    () =>
      runDoctor({
        ...io,
        cwd: io.cwd ?? process.cwd(),
        env: io.env,
        ...(process.argv[1] ? { cliPath: process.argv[1] } : {}),
      }),
    (r, f) => (f === "brief" ? brief(r) : undefined),
  )
}

function brief(r: DoctorResult): string {
  const lines = [
    `decide doctor: ${r.healthy ? "healthy" : "PROBLEMS FOUND"} · ${r.live ? "live ready" : "replay only"} · harness ${r.harness ?? "none"} · session ${r.session ?? "none"}`,
  ]
  for (const c of r.checks) {
    lines.push(`  ${c.status.padEnd(4)} ${c.name}: ${c.detail}`)
    if (c.fix && c.status !== "ok") lines.push(`       fix: ${c.fix}`)
  }
  return lines.join("\n")
}
