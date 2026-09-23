/**
 * Draw the calibration labelling sample from recorded sweeps (M7 §1 step 2).
 *
 *   tsx tools/calibration-sample.ts --run system1=runs/system1.json --run jev-poc=runs/jev-poc.json \
 *     --group checkable=io,errors --group judgement=defect,standalone \
 *     --cap 25 --seed 7 --out evidence/labels/sample-v1
 *
 * **The sampling rule is the whole game.** Every noul answer of every recorded
 * row is in the population — kept and undecided alike, never a `--keep`
 * survivor list. The population is stratified by (group, 0.1 probability
 * bucket); each stratum yields a seeded random draw of up to `--cap` pairs, or
 * all of it when smaller. Within a bucket the draw is uniform, so the per-bucket
 * observed frequency is unbiased; any pooled figure must be reweighted by the
 * stratum populations, which the manifest records.
 *
 * Writes two files and nothing else:
 *   <out>.worksheet.jsonl — shuffled {n, corpus, id, question}, NO model answer:
 *                           the labeller reads each item blind (§1 step 3).
 *   <out>.manifest.json   — seed, cap, groups, strata {population, sampled}.
 *
 * Deterministic: population sorted before drawing, PRNG seeded, no clock.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { BUCKET_WIDTH, bucketIndex } from "./calibration.js"

export interface PopulationPair {
  corpus: string
  id: string
  question: string
  group: string
  predicted: number
}

export interface Stratum {
  group: string
  bucket: number
  population: number
  sampled: number
}

/** mulberry32: small, fast, seedable. Quality is ample for sampling. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates, in place, driven by `rand`. */
export function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j] as T, xs[i] as T]
  }
  return xs
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Every noul answer in a `many` run, for questions assigned to a group. Accepts
 * the envelope `{result: …}` or the bare result. Rows appear in `kept` and/or
 * `undecided`; each (id, question) is counted once.
 */
export function population(
  corpus: string,
  runText: string,
  groupOf: Map<string, string>,
): PopulationPair[] {
  let data: unknown = JSON.parse(runText)
  if (isRecord(data) && isRecord(data.result)) data = data.result
  if (!isRecord(data)) throw new Error(`${corpus}: not a many result`)
  const rows = [
    ...(Array.isArray(data.kept) ? data.kept : []),
    ...(Array.isArray(data.undecided) ? data.undecided : []),
  ]
  const out: PopulationPair[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.answers)) continue
    for (const [question, answer] of Object.entries(row.answers)) {
      const group = groupOf.get(question)
      if (!group || !isRecord(answer) || answer.type !== "noul") continue
      if (typeof answer.noul !== "number") continue
      const key = `${row.id}\u0000${question}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ corpus, id: row.id, question, group, predicted: answer.noul })
    }
  }
  if (out.length === 0) throw new Error(`${corpus}: no noul answers for the grouped questions`)
  return out
}

export function draw(
  pop: PopulationPair[],
  cap: number,
  seed: number,
): { sample: PopulationPair[]; strata: Stratum[] } {
  const rand = prng(seed)
  const byStratum = new Map<string, PopulationPair[]>()
  const sorted = [...pop].sort((a, b) =>
    `${a.corpus}\u0000${a.id}\u0000${a.question}` < `${b.corpus}\u0000${b.id}\u0000${b.question}`
      ? -1
      : 1,
  )
  for (const p of sorted) {
    const key = `${p.group}\u0000${bucketIndex(p.predicted)}`
    const list = byStratum.get(key) ?? []
    list.push(p)
    byStratum.set(key, list)
  }
  const strata: Stratum[] = []
  const sample: PopulationPair[] = []
  for (const key of [...byStratum.keys()].sort()) {
    const list = byStratum.get(key) as PopulationPair[]
    const picked = shuffle([...list], rand).slice(0, cap)
    sample.push(...picked)
    const first = list[0] as PopulationPair
    strata.push({
      group: first.group,
      bucket: bucketIndex(first.predicted),
      population: list.length,
      sampled: picked.length,
    })
  }
  // Present in random order so neither bucket nor group can be read off position.
  return { sample: shuffle(sample, rand), strata }
}

function main(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string", multiple: true },
      group: { type: "string", multiple: true },
      cap: { type: "string", default: "25" },
      seed: { type: "string" },
      out: { type: "string" },
    },
  })
  if (!values.run?.length || !values.group?.length || !values.seed || !values.out) {
    throw new Error("need --run corpus=path… --group name=q1,q2… --seed N --out <prefix>")
  }
  const groupOf = new Map<string, string>()
  const groups: Record<string, string[]> = {}
  for (const g of values.group) {
    const [name, qs] = g.split("=")
    if (!name || !qs) throw new Error(`bad --group ${g}`)
    groups[name] = qs.split(",")
    for (const q of groups[name]) groupOf.set(q, name)
  }
  const runs: Record<string, string> = {}
  const pop: PopulationPair[] = []
  for (const r of values.run) {
    const [corpus, path] = r.split("=")
    if (!corpus || !path) throw new Error(`bad --run ${r}`)
    runs[corpus] = path
    pop.push(...population(corpus, readFileSync(path, "utf8"), groupOf))
  }
  const cap = Number(values.cap)
  const seed = Number(values.seed)
  const { sample, strata } = draw(pop, cap, seed)
  writeFileSync(
    `${values.out}.worksheet.jsonl`,
    sample
      .map((p, i) => JSON.stringify({ n: i + 1, corpus: p.corpus, id: p.id, question: p.question }))
      .join("\n") + "\n",
  )
  writeFileSync(
    `${values.out}.manifest.json`,
    `${JSON.stringify({ seed, cap, bucketWidth: BUCKET_WIDTH, runs, groups, populationTotal: pop.length, sampledTotal: sample.length, strata }, null, 2)}\n`,
  )
  console.log(`population ${pop.length} · sampled ${sample.length} across ${strata.length} strata`)
  for (const s of strata) {
    console.log(
      `  ${s.group.padEnd(10)} ${(s.bucket / 10).toFixed(1)}  ${s.sampled}/${s.population}`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
