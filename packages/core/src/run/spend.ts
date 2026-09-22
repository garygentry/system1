import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Usage } from "../model/types.js"

export type AnswerSource = "live" | "replay"

/** One ledger line. Every figure comes from an upstream `usage` block; nothing is estimated. */
export interface SpendEntry extends Usage {
  ts: string
  session?: string
  model: string
  source: AnswerSource
  calls: number
}

export interface SpendSummary extends Usage {
  calls: number
  liveCalls: number
  replayCalls: number
}

export function sumUsage(usages: ReadonlyArray<Usage | undefined>): Usage {
  return usages.reduce<Usage>(
    (total, u) => ({
      input_tokens: total.input_tokens + (u?.input_tokens ?? 0),
      output_tokens: total.output_tokens + (u?.output_tokens ?? 0),
      cost: total.cost + (u?.cost ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cost: 0 },
  )
}

/**
 * Measured spend, persisted as append-only JSONL (default `.decisions/usage.jsonl`).
 *
 * A file rather than process memory because the CLI is a fresh process per call:
 * "what has this session cost" has to survive between invocations. Replayed
 * calls are logged at zero cost so the call count stays honest.
 */
export class SpendLedger {
  constructor(readonly file: string) {}

  append(entry: SpendEntry): void {
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`)
  }

  entries(): SpendEntry[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SpendEntry]
        } catch {
          return [] // a torn last line from a crash is skipped, not fatal
        }
      })
  }

  summary(filter: { session?: string; since?: Date } = {}): SpendSummary {
    const rows = this.entries().filter(
      (e) =>
        (filter.session === undefined || e.session === filter.session) &&
        (filter.since === undefined || new Date(e.ts) >= filter.since),
    )
    const count = (source: AnswerSource) =>
      rows.filter((e) => e.source === source).reduce((n, e) => n + e.calls, 0)
    return {
      ...sumUsage(rows),
      calls: rows.reduce((n, e) => n + e.calls, 0),
      liveCalls: count("live"),
      replayCalls: count("replay"),
    }
  }
}
