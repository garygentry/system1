/**
 * Build the second-labeller check: a self-contained HTML page that shows each
 * pair of an agreement worksheet blind (the excerpt, the proposition and its
 * rubric, no model answer and no first-labeller label) and records True/False.
 *
 *   tsx tools/calibration-agreement.ts \
 *     --worksheet evidence/labels/agreement-v1.worksheet.jsonl \
 *     --questions evidence/questions/code-v1.yaml \
 *     --pin system1=.@baf4eb5 --pin jev-poc=../jev-poc@3111ae9 \
 *     --out agreement-check.html
 *
 * Excerpts are read from each corpus at its pinned commit (`git show`), so the
 * page shows exactly the lines the model saw. Publish the page as an Artifact
 * with the `db` capability: answers land in its `agreement` collection, one
 * document per item (`k01`…), as `{k, id, question, corpus, label, note}`.
 * Convert those to label JSONL and compare with the first labeller's file to
 * get the agreement rate.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { parse } from "yaml"

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../evidence/agreement/check.template.html",
)

interface WorksheetRow {
  k: number
  corpus: string
  id: string
  question: string
}

interface NoulQuestion {
  instructions: string
  criteria: { true: string; false: string }
}

export function excerptRange(id: string): { path: string; start: number; end: number } {
  const m = /^(.*):(\d+)-(\d+)$/.exec(id)
  if (!m?.[1]) throw new Error(`not a line-range id: ${id}`)
  return { path: m[1], start: Number(m[2]), end: Number(m[3]) }
}

/** `</` inside the embedded JSON would close the script element early. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/")
}

function main(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      worksheet: { type: "string" },
      questions: { type: "string" },
      pin: { type: "string", multiple: true },
      out: { type: "string" },
    },
  })
  if (!values.worksheet || !values.questions || !values.pin?.length || !values.out) {
    throw new Error("need --worksheet, --questions, --pin corpus=dir@commit…, --out")
  }
  const pins = new Map<string, { dir: string; commit: string }>()
  for (const p of values.pin) {
    const m = /^([^=]+)=(.+)@([^@]+)$/.exec(p)
    if (!m?.[1] || !m[2] || !m[3]) throw new Error(`bad --pin ${p} (want corpus=dir@commit)`)
    pins.set(m[1], { dir: m[2], commit: m[3] })
  }
  const questions = parse(readFileSync(values.questions, "utf8")) as Record<string, NoulQuestion>
  const rows = readFileSync(values.worksheet, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WorksheetRow)

  const items = rows.map((row) => {
    const pin = pins.get(row.corpus)
    if (!pin) throw new Error(`no --pin for corpus ${row.corpus}`)
    const { path, start, end } = excerptRange(row.id)
    const file = execFileSync("git", ["-C", pin.dir, "show", `${pin.commit}:${path}`], {
      encoding: "utf8",
    }).split("\n")
    return { ...row, start, code: file.slice(start - 1, end).join("\n") }
  })
  const rubric = Object.fromEntries(
    Object.entries(questions).map(([name, q]) => [
      name,
      { text: q.instructions, t: q.criteria.true, f: q.criteria.false },
    ]),
  )
  const html = readFileSync(TEMPLATE, "utf8").replace("__DATA__", () =>
    embedJson({ items, rubric }),
  )
  writeFileSync(values.out, html)
  console.log(`${items.length} items → ${values.out}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
