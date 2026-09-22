/**
 * Measures `decide` startup: the median wall-clock of N runs per command, and
 * the overhead over bare `node -e 0`, which is what the CLI controls. No
 * network, no key, no spend.
 *
 *   pnpm bench:startup            # 15 runs each
 *   pnpm bench:startup -- 40      # 40 runs each
 *
 * Absolute times swing with machine load, so compare the overhead column.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const BUNDLE = join(ROOT, "packages/cli/dist/bundle/decide.mjs")
const RUNS = Number(process.argv[2] ?? 15)
const TARGET_MS = 150

if (!existsSync(BUNDLE)) {
  console.error("bench: run `pnpm build` first")
  process.exit(2)
}

const cases: { name: string; args: string[]; gated: boolean }[] = [
  { name: "node -e 0", args: ["-e", "0"], gated: false },
  { name: "decide version", args: [BUNDLE, "version"], gated: true },
  { name: "decide help", args: [BUNDLE, "help"], gated: true },
  { name: "decide config", args: [BUNDLE, "config"], gated: false },
  {
    name: "decide many --dry-run",
    args: [
      BUNDLE,
      "many",
      "--glob",
      "packages/core/src/config/*.ts",
      "--question",
      "q:noul:The file handles secrets.",
      "--dry-run",
    ],
    gated: false,
  },
]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] as number
}

function time(args: string[]): number {
  const start = process.hrtime.bigint()
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "ignore" })
  if (r.status !== 0) throw new Error(`bench: \`node ${args.join(" ")}\` exited ${r.status}`)
  return Number(process.hrtime.bigint() - start) / 1e6
}

// One warm-up run each fills the OS file cache and Node's compile cache.
for (const c of cases) time(c.args)
const results = cases.map((c) => ({
  ...c,
  ms: median(Array.from({ length: RUNS }, () => time(c.args))),
}))
const base = results[0]?.ms ?? 0
let failed = false
console.log(`median of ${RUNS} runs (overhead = median − node -e 0; target < ${TARGET_MS} ms)`)
for (const r of results) {
  const over = r.ms - base
  const verdict = r.gated ? (over < TARGET_MS ? "ok" : "OVER") : ""
  if (verdict === "OVER") failed = true
  console.log(
    `${r.name.padEnd(24)} ${r.ms.toFixed(0).padStart(5)} ms   +${over.toFixed(0).padStart(4)} ms  ${verdict}`,
  )
}
process.exit(failed ? 1 : 0)
