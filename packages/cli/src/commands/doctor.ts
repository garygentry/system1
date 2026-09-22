import { execFile } from "node:child_process"
import { type DoctorResult, runDoctor } from "@garygentry/system1-core"
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
        probeVersion: (path) => probeVersion(path, io.env),
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

/**
 * `<path> version`, bounded: a hung or broken install must not hang doctor.
 * `SYSTEM1_NO_NPX` stops the plugin shim from falling back to `npx`, which
 * would download a package just to answer a version check.
 */
export function probeVersion(
  path: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 2000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: string | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = execFile(
      path,
      ["version"],
      { env: { ...env, SYSTEM1_NO_NPX: "1" }, timeout: timeoutMs, killSignal: "SIGKILL" },
      // Empty output is passed on as "": doctor tells it apart from a failure.
      (error, stdout) => done(error ? undefined : (stdout.trim().split("\n")[0] ?? "")),
    )
    // Don't wait for a child that ignores its kill to actually exit.
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      done(undefined)
    }, timeoutMs + 200)
  })
}
