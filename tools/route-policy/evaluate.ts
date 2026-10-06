/**
 * Scores the `route-hint` policy as it would run, two bars and the regex
 * fallback included, against the routing evals' labels, split by set:
 *
 *   pnpm exec tsx tools/route-policy/evaluate.ts
 *
 * It replays the answers `decide compare route-hint --record` kept in
 * `.system1/compare/route-hint/fixtures/`, so it sends nothing and needs no
 * key. `decide compare` scores the raw answers; this scores the policy's
 * decisions, where an answer between the bars keeps the regex's.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { ROUTE_DEFAULTS, route } from "../../packages/core/src/route/route.js"
import { samples } from "./capture.js"
import { routeHint, SPEC } from "./policy.js"

const REPO = fileURLToPath(new URL("../..", import.meta.url))
const root = join(REPO, ".system1", "compare", SPEC)
const existing = (prompt: string) => route(prompt, ROUTE_DEFAULTS)

type Tally = {
  n: number
  regex: number
  policy: number
  byModel: number
  fellBack: Record<string, number>
}
const tallies = new Map<string, Tally>()
const wrong: string[] = []
for (const s of samples(REPO)) {
  const set = s.id.split(":")[0] as string
  for (const key of [set, "all"]) {
    if (!tallies.has(key)) tallies.set(key, { n: 0, regex: 0, policy: 0, byModel: 0, fellBack: {} })
  }
  const outcome = await routeHint(s.prompt, existing, { enabled: true, mode: "replay", root })
  const regexRight = Number(existing(s.prompt).matched) === s.hint
  const policyRight = Number(outcome.value.matched) === s.hint
  for (const key of [set, "all"]) {
    const t = tallies.get(key) as Tally
    t.n++
    if (regexRight) t.regex++
    if (policyRight) t.policy++
    if (outcome.by === "model") t.byModel++
    else t.fellBack[outcome.reason] = (t.fellBack[outcome.reason] ?? 0) + 1
  }
  if (regexRight !== policyRight)
    wrong.push(
      `${policyRight ? "policy" : "regex "} right  ${s.id.padEnd(16)} ${outcome.by === "model" ? "" : `(${outcome.by === "existing" ? outcome.reason : ""}) `}${s.prompt.slice(0, 80)}`,
    )
}
for (const [key, t] of tallies) {
  const pct = (x: number) => `${((100 * x) / t.n).toFixed(1)}%`
  const fb =
    Object.entries(t.fellBack)
      .map(([r, c]) => `${r} ${c}`)
      .join(", ") || "none"
  console.log(
    `${key.padEnd(9)} n=${t.n}  regex ${t.regex}/${t.n} ${pct(t.regex)}  policy ${t.policy}/${t.n} ${pct(t.policy)}  model decided ${t.byModel}  fell back: ${fb}`,
  )
}
for (const line of wrong) console.log(line)
