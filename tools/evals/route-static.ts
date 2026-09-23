/**
 * Static check of the routing triggers (decision 0018) over prompt sets:
 * which `ask` positives get a hint and which negatives stay quiet. Offline and
 * free; it runs the built-in triggers from source, with no config.
 *
 *   pnpm exec tsx tools/evals/route-static.ts [--all] <routing.yaml>…
 *
 * This measures the hook alone. Whether the agent then loads the skill is what
 * `pnpm eval:routing` measures. Don't tune the triggers against a held-out set.
 */
import { readFileSync } from "node:fs"
import { parse } from "yaml"
import { ROUTE_DEFAULTS, route } from "../../packages/core/src/route/route.js"

const args = process.argv.slice(2)
const all = args.includes("--all")
let wrong = 0
for (const file of args.filter((a) => a !== "--all")) {
  const { ask } = parse(readFileSync(file, "utf8")) as {
    ask: Record<"positive" | "negative", string[]>
  }
  const tally = { positive: 0, negative: 0 }
  for (const polarity of ["positive", "negative"] as const) {
    for (const prompt of ask[polarity]) {
      const r = route(prompt, ROUTE_DEFAULTS)
      const ok = polarity === "positive" ? r.matched : r.triggers.length === 0
      if (ok) tally[polarity]++
      else wrong++
      if (!ok || all) {
        const names = r.triggers.map((t) => t.name).join(",") || "-"
        console.log(
          `${ok ? "ok  " : "MISS"} ${polarity.slice(0, 3)} ${names.padEnd(30)} ${prompt.slice(0, 90)}`,
        )
      }
    }
  }
  console.log(
    `${file}: hinted ${tally.positive}/${ask.positive.length} positives, quiet on ${tally.negative}/${ask.negative.length} negatives`,
  )
}
process.exitCode = wrong ? 1 : 0
