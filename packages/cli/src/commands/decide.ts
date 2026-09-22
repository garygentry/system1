import { readFileSync } from "node:fs"
import {
  type AskResult,
  createContext,
  DecisionsError,
  type ManyResult,
  runAsk,
  runMany,
} from "@garygentry/decisions-core"
import { buildInput, parseDecideFlags } from "../args.js"
import { ENVELOPE_VERSION, type Format } from "../envelope.js"
import type { ExitCode } from "../exit-codes.js"
import { briefAsk, briefMany } from "../format.js"
import type { Io } from "../io.js"
import { emit } from "../run.js"

export function runAskCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit<AskResult>(
    io,
    "ask",
    format,
    () => runAsk(context(io), input(argv, io)),
    (r, f) => (f === "brief" ? briefAsk(r) : undefined),
  )
}

export function runManyCommand(argv: string[], io: Io, format: Format): Promise<ExitCode> {
  return emit<ManyResult>(
    io,
    "many",
    format,
    () => runMany(context(io), input(argv, io)),
    (r, f) => (f === "brief" ? briefMany(r) : f === "jsonl" ? jsonlMany(r) : undefined),
  )
}

/**
 * `jsonl`: one line per result for streaming into other tools. Each line is
 * tagged with its `status`, and a final `summary` line carries the counts and
 * usage.
 */
function jsonlMany(r: ManyResult): string {
  const lines = [
    ...r.kept.map((row) => ({ status: "kept", ...row })),
    ...r.undecided.map((row) => ({ status: "undecided", ...row })),
    ...r.failed.map((f) => ({ status: "failed", ...f })),
  ].map((l) => JSON.stringify(l))
  const { kept: _k, undecided: _u, failed: _f, ...summary } = r
  lines.push(JSON.stringify({ v: ENVELOPE_VERSION, status: "summary", ...summary }))
  return lines.join("\n")
}

function context(io: Io) {
  return createContext({ ...io, cwd: io.cwd ?? process.cwd(), env: io.env })
}

function input(argv: string[], io: Io) {
  const { values, positionals } = parseDecideFlags(argv)
  if (positionals.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `Unexpected argument "${positionals[0]}". Did you mean --text "${positionals[0]}"?`,
    )
  }
  return buildInput(values, io.readStdin ?? (() => readFileSync(0, "utf8")))
}
