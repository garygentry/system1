import type {
  Answer,
  Answers,
  AskResult,
  ManyResult,
  Projection,
  ResultRow,
  SkippedSummary,
  SpecCheckResult,
  Usage,
} from "@garygentry/decisions-core"

/**
 * The `brief` format: what an agent reads. One line per result, undecided
 * listed separately, measured and projected figures labelled, and nothing the
 * agent won't act on.
 */

export function briefAnswer(name: string, answer: Answer, undecided: boolean): string {
  const flag = undecided ? " UNDECIDED" : ""
  switch (answer.type) {
    case "noul":
      return `${name}=${fix(answer.noul)}${flag}`
    case "choice":
      return `${name}=${answer.choice}(${fix(answer.confidence)})${flag}`
    case "score": {
      const top = answer.legend ? Object.keys(answer.legend).length - 1 : undefined
      return `${name}=${fix(answer.score)}${top !== undefined ? `/${top}` : ""}(${fix(answer.confidence)})${flag}`
    }
  }
}

export function briefAnswers(answers: Answers, undecided: readonly string[] = []): string {
  return Object.entries(answers)
    .map(([name, a]) => briefAnswer(name, a, undecided.includes(name)))
    .join("  ")
}

function where(row: Pick<ResultRow, "id">): string {
  return row.id
}

export function briefMany(r: ManyResult): string {
  const lines: string[] = []
  if (r.dryRun) {
    lines.push(
      `decide many (dry run): would send ${r.counts.items} item(s) to ${r.model} · ${projected(r.projection)} · no calls made`,
    )
    if (r.sampleIds?.length) lines.push(`first: ${r.sampleIds.join(", ")}`)
  } else {
    const c = r.counts
    lines.push(
      `decide many: ${c.kept}${c.keptTotal > c.kept ? ` (of ${c.keptTotal})` : ""} kept of ${c.items}` +
        ` · ${c.undecided} undecided · ${c.dropped} dropped${c.failed ? ` · ${c.failed} FAILED` : ""}` +
        ` · ${r.source} ${r.model} · ${measured(r.usage)} · ${seconds(r.wallClockMs)}`,
    )
    if (r.kept.length) {
      lines.push("kept:")
      for (const row of r.kept) lines.push(`  ${where(row)}  ${briefAnswers(row.answers)}`)
    }
    if (r.undecided.length) {
      lines.push("undecided (too flat to judge; read these yourself):")
      for (const row of r.undecided)
        lines.push(`  ${where(row)}  ${briefAnswers(row.answers, row.questions)}`)
    }
    if (r.failed.length) {
      lines.push("failed:")
      for (const f of r.failed) lines.push(`  ${f.id}  ${f.code}: ${firstLine(f.message)}`)
    }
  }
  lines.push(...withheld(r.skipped, r.redactions))
  return lines.join("\n")
}

export function briefAsk(r: AskResult): string {
  const lines = [
    `decide ask: ${r.id} · ${r.source} ${r.servedBy} · ${r.latencyMs} ms · ${measured(r.usage)}`,
    ...Object.entries(r.answers).map(
      ([name, a]) => `  ${briefAnswer(name, a, r.undecided.includes(name))}`,
    ),
  ]
  if (r.verdict) lines.push(`verdict: ${r.verdict}`)
  lines.push(...withheld(r.skipped, r.redactions))
  return lines.join("\n")
}

/**
 * `spec check`: one line per example. Anything short of a pass also shows the
 * full distributions, because reading them is how a question gets repaired.
 */
export function briefSpecCheck(r: SpecCheckResult): string {
  const c = r.counts
  const parts = [`${c.pass} pass`, `${c.fail} fail`, `${c.undecided} undecided`]
  if (c.captured) parts.push(`${c.captured} captured`)
  if (c.withheld) parts.push(`${c.withheld} withheld`)
  const lines = [
    `decide spec check: ${r.spec} ${r.passed ? "PASSED" : "FAILED"} · ${parts.join(" · ")} · ${r.source} ${r.model} · ${measured(r.usage)}`,
  ]
  for (const e of r.examples) {
    const label = e.status === "pass" ? "pass" : e.status.toUpperCase()
    if (e.status === "withheld") {
      lines.push(`  ${label}  ${e.id}  ${e.reason ?? ""}`)
      continue
    }
    lines.push(`  ${label}  ${e.id}  ${e.answers ? briefAnswers(e.answers, e.undecided) : ""}`)
    for (const f of e.failures ?? []) lines.push(`      expected ${f.question}: ${f.expected}`)
    if (e.status !== "pass" && e.answers) {
      for (const [name, a] of Object.entries(e.answers)) {
        if (a.type !== "noul") lines.push(`      ${name}: ${distribution(a.probabilities)}`)
      }
    }
  }
  lines.push(...withheld(r.skipped, { total: 0, items: 0 }))
  return lines.join("\n")
}

function distribution(probabilities: Record<string, number>): string {
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => `${k} ${fix(p)}`)
    .join(" · ")
}

function withheld(skipped: SkippedSummary, redactions: { total: number; items: number }): string[] {
  const lines: string[] = []
  if (skipped.total > 0) {
    const reasons = Object.entries(skipped.byReason)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")
    const excluded = skipped.sample.filter((s) => s.reason === "excluded").map((s) => s.path)
    lines.push(
      `withheld: ${skipped.total} (${reasons})${excluded.length ? ` e.g. ${excluded.join(", ")}` : ""}`,
    )
  }
  if (redactions.total > 0)
    lines.push(
      `redacted: ${redactions.total} secret(s) in ${redactions.items} item(s) before sending`,
    )
  return lines
}

export function projected(p: Projection): string {
  return `projected $${p.projectedUsd.toFixed(6)} (~${p.estimatedInputTokens} tokens, price as of ${p.priceAsOf})`
}

function measured(u: Usage): string {
  return `$${u.cost.toFixed(6)} measured`
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function fix(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text
}
