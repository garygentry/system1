/**
 * Runs the shadow harness for `route-hint` over the routing evals' `ask`
 * prompts, and writes their labels:
 *
 *   pnpm exec tsx tools/route-policy/capture.ts
 *
 * - `.system1/compare/route-hint/captured.jsonl`: one row per prompt, with the
 *   regex router's answer as `current`. The regex runs locally and sends
 *   nothing, so each row's cost is a measured 0.
 * - `.system1/labels/route-hint.jsonl`: `hint` is 1 for an `ask` positive (the
 *   skill must load) and 0 for a negative (it must not). Only `hint` is
 *   labelled; the trigger questions get agreement, not accuracy.
 *
 * Ids name the set they come from: `tuned:` is routing.yaml, which the
 * triggers were written against; the second version was also tuned on
 * `holdout:` (routing-holdout.yaml), and `holdout2:` was written blind but has
 * been read since (ROADMAP: "spent as a blind set").
 *
 * Ids are positions, so the capture is written afresh each run: a row kept
 * from an earlier run could sit under an id whose label is now another prompt's.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { ROUTE_DEFAULTS, route } from "../../packages/core/src/route/route.js"
import { SPEC } from "./policy.js"
import { CAPTURE_FILE, captureShadow } from "./shadow.js"

const REPO = fileURLToPath(new URL("../..", import.meta.url))
const SETS = [
  ["tuned", "tools/evals/routing.yaml"],
  ["holdout", "tools/evals/routing-holdout.yaml"],
  ["holdout2", "tools/evals/routing-holdout-2.yaml"],
] as const

export interface Sample {
  id: string
  prompt: string
  /** 1: the ask skill must load; 0: it must not. */
  hint: 0 | 1
}

export function samples(repo = REPO): Sample[] {
  const out: Sample[] = []
  for (const [set, file] of SETS) {
    const { ask } = parse(readFileSync(join(repo, file), "utf8")) as {
      ask: Record<"positive" | "negative", string[]>
    }
    for (const polarity of ["positive", "negative"] as const)
      ask[polarity].forEach((prompt, i) => {
        out.push({
          id: `${set}:${polarity.slice(0, 3)}:${i + 1}`,
          prompt,
          hint: polarity === "positive" ? 1 : 0,
        })
      })
  }
  return out
}

async function main() {
  const all = samples()
  const file = join(REPO, CAPTURE_FILE)
  rmSync(file, { force: true })
  const summary = await captureShadow(
    all,
    async (prompt) => ({ output: route(prompt, ROUTE_DEFAULTS), usage: { cost: 0 } }),
    { file },
  )
  const labels = join(REPO, ".system1", "labels", `${SPEC}.jsonl`)
  mkdirSync(dirname(labels), { recursive: true })
  writeFileSync(
    labels,
    all.map((s) => `${JSON.stringify({ id: s.id, labels: { hint: s.hint } })}\n`).join(""),
  )
  console.log(
    `captured ${summary.written} (skipped ${summary.skipped.length}, failed ${summary.failed.length}) → ${summary.file}; ${all.length} labels → ${labels}`,
  )
  if (summary.failed.length > 0) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
