import type {
  Answer,
  Answers,
  AskResult,
  CompareResult,
  CompareSide,
  LintFinding,
  ManyResult,
  Projection,
  ResultRow,
  SkippedSummary,
  SpecCheckResult,
  SpecLintResult,
  Usage,
} from "@garygentry/system1-core"

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

/** Piped rows have no file to point at, so their text follows the answers. */
function quoted(row: Pick<ResultRow, "excerpt">): string {
  return row.excerpt ? `  "${row.excerpt}"` : ""
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
      for (const row of r.kept)
        lines.push(`  ${where(row)}  ${briefAnswers(row.answers, row.undecided)}${quoted(row)}`)
    }
    if (r.undecided.length) {
      lines.push("undecided (too flat to judge; read these yourself):")
      for (const row of r.undecided)
        lines.push(`  ${where(row)}  ${briefAnswers(row.answers, row.questions)}${quoted(row)}`)
    }
    if (r.failed.length) {
      lines.push("failed:")
      for (const f of r.failed) lines.push(`  ${f.id}  ${f.code}: ${firstLine(f.message)}`)
    }
  }
  lines.push(...withheld(r.skipped, r.redactions))
  if (r.unsaved) {
    const what = [
      r.unsaved.ledger ? `${r.unsaved.ledger} spend line(s)` : "",
      r.unsaved.fixture ? `${r.unsaved.fixture} fixture(s)` : "",
    ].filter(Boolean)
    lines.push(`not saved (${r.unsaved.reason}): ${what.join(", ")}; the answers stand`)
  }
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
  for (const u of r.unsaved ?? [])
    lines.push(
      `not saved (${u.reason}): the ${u.what === "ledger" ? "spend line" : "fixture"}; the answer stands`,
    )
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
  if (r.lint.length) {
    lines.push(
      `lint: ${r.lint.length} finding(s), not part of PASSED/FAILED (decide spec lint ${r.spec})`,
    )
    lines.push(...r.lint.map(briefFinding))
  }
  const lost = (what: "ledger" | "fixture") => r.unsaved?.filter((u) => u.what === what) ?? []
  const fixtures = lost("fixture")
  if (fixtures.length)
    lines.push(
      `NOT RECORDED (${fixtures[0]?.reason}): ${fixtures.length} answer(s) couldn't be written, so the check fails`,
    )
  const ledger = lost("ledger")
  if (ledger.length) lines.push(`not saved (${ledger[0]?.reason}): ${ledger.length} spend line(s)`)
  return lines.join("\n")
}

export function briefSpecLint(r: SpecLintResult): string {
  const c = r.counts
  const lines = [
    `decide spec lint: ${r.passed ? "PASSED" : "FAILED"} · ${c.specs} spec(s) · ${c.errors} error(s) · ${c.warnings} warning(s)${c.invalid ? ` · ${c.invalid} invalid` : ""}`,
  ]
  for (const s of r.specs) {
    if (s.invalid) lines.push(`  INVALID  ${s.name}  ${s.invalid.split("\n")[0]}`)
    else if (s.findings.length === 0) lines.push(`  ok  ${s.name}`)
    else {
      lines.push(`  ${s.name}  (${s.file})`)
      lines.push(...s.findings.map(briefFinding))
    }
  }
  return lines.join("\n")
}

function briefFinding(f: LintFinding): string {
  return `    ${f.severity} ${f.check}: ${f.message}\n      fix: ${f.fix}`
}

function distribution(probabilities: Record<string, number>): string {
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([k, p]) => `${k} ${fix(p)}`)
    .join(" · ")
}

function withheld(skipped: SkippedSummary, redactions: { total: number; items: number }): string[] {
  const lines: string[] = []
  // `--exclude` is the caller's choice, not something held back: its own line.
  const filtered = skipped.byReason.filtered ?? 0
  const held = skipped.total - filtered
  if (held > 0) {
    const reasons = Object.entries(skipped.byReason)
      .filter(([k]) => k !== "filtered")
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")
    const excluded = skipped.sample.filter((s) => s.reason === "excluded").map((s) => s.path)
    lines.push(
      `withheld: ${held} (${reasons})${excluded.length ? ` e.g. ${excluded.join(", ")}` : ""}`,
    )
  }
  if (filtered > 0) lines.push(`left out by --exclude: ${filtered}`)
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
  return u.reported === false
    ? `$${u.cost.toFixed(6)} measured (incomplete: at least one attempt was billed at a cost the provider didn't report)`
    : `$${u.cost.toFixed(6)} measured`
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

export function briefCompare(r: CompareResult): string {
  if ("dryRun" in r) {
    const p = r.projection
    return [
      `decide compare: ${r.spec} (dry run) · ${r.rows.captured} rows · baseline ${r.baselineKind}`,
      `  jev: ${projected(p.jev)}`,
      ...(p.baseline ? [`  baseline: ${projected(p.baseline)}`] : []),
      `  total: ${projected(p.total)}`,
      ...(r.rows.withheld.length ? [`  withheld: ${r.rows.withheld.length}`] : []),
      ...(r.rows.invalid.length ? [`  invalid lines: ${r.rows.invalid.length}`] : []),
    ].join("\n")
  }
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`)
  const usd = (c: CompareSide["cost"]) =>
    c.perCall === null
      ? "unknown"
      : `$${c.perCall.toFixed(6)}/call${c.complete ? "" : " (incomplete: some cost unknown)"}`
  const ms = (l: CompareSide["latency"]) =>
    l.p50Ms === null ? "n/a" : `p50 ${l.p50Ms} ms · p95 ${l.p95Ms} ms`
  const a = r.signals.agreement
  const lines = [
    `decide compare: ${r.spec} · ${r.rows.compared} of ${r.rows.captured} rows compared · baseline ${r.baseline.model}`,
    `  cost:     jev ${usd(r.jev.cost)} · baseline ${usd(r.baseline.cost)}`,
    `  latency:  jev ${ms(r.jev.latency)} · baseline ${ms(r.baseline.latency)}`,
    `  agree:    ${pct(a.overall.rate)} of ${a.overall.n} decided answers`,
    ...Object.entries(a.byQuestion).map(
      ([name, q]) =>
        `    ${name} (${q.type}): ${pct(q.rate)} of ${q.n}${q.jevUndecided ? ` · ${q.jevUndecided} jev undecided` : ""}`,
    ),
    `  undecided (jev): ${pct(r.signals.undecidedShare.rate)} · baseline parsed: ${pct(r.baseline.parsed.rate)} of ${r.baseline.parsed.n}`,
  ]
  if (r.labels) {
    const acc = r.labels.accuracy
    lines.push(
      `  accuracy: jev ${pct(acc.jev.overall.rate)} of ${acc.jev.overall.n} · baseline ${pct(acc.baseline.overall.rate)} of ${acc.baseline.overall.n} (${r.labels.matched} labelled rows)`,
    )
  }
  lines.push(`  ${r.verdict}`)
  if (r.disagreements.total)
    lines.push(
      `  disagreements: ${r.disagreements.total}`,
      ...r.disagreements.sample
        .slice(0, 10)
        .map((d) => `    ${d.id} · ${d.question}: jev ${d.jev} · baseline ${d.baseline}`),
    )
  const failed = (f: CompareSide["failed"]) =>
    Object.entries(f)
      .map(([code, n]) => `${n} ${code}`)
      .join(", ")
  if (Object.keys(r.jev.failed).length) lines.push(`  jev failed: ${failed(r.jev.failed)}`)
  if (Object.keys(r.baseline.failed).length)
    lines.push(`  baseline failed: ${failed(r.baseline.failed)}`)
  if (r.rows.withheld.length) lines.push(`  withheld: ${r.rows.withheld.length} (too large)`)
  if (r.rows.invalid.length) lines.push(`  invalid capture lines: ${r.rows.invalid.length}`)
  lines.push(`  spent: ${measured(r.usage)}`)
  lines.push(r.reportUnsaved ? `  report NOT written (${r.reportUnsaved})` : `  report: ${r.file}`)
  return lines.join("\n")
}
