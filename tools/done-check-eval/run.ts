/**
 * The done-check evaluation (M10 §8): a labelled set of stop events, each run
 * through the real hook in a real git repo.
 *
 *   pnpm eval:done-check                 replay every scenario; print the scorecard
 *   … --write                            and rewrite results.json (after a threshold change)
 *   pnpm eval:done-check --record        live, once: re-record the fixtures and results.json
 *   pnpm eval:done-check --latency N     live, through the built CLI: N stops per scenario,
 *                                        p50/p95 added latency and cost (records nothing)
 *   pnpm eval:done-check --fit           sweep the thresholds over the recorded answers
 *   … --holdout                          the holdout set (holdout.yaml) instead; never fitted on
 *   … --only <id>                        one scenario
 *   pnpm eval:done-check --messages      the question check alone, over labelled last messages
 *                                        (messages.yaml; with --holdout, messages-holdout.yaml):
 *                                        replay, or live with --record; a threshold sweep
 *                                        on the fitted set only
 *
 * Replay needs no key and runs in CI (`done-check-eval.test.ts`). Live modes
 * take OPENROUTER_API_KEY from the environment or the user's credentials file
 * and spend about $0.00003 per call. The key is never printed.
 */
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { allProfiles } from "../../packages/core/src/config/load.js"
import type { DecideMode } from "../../packages/core/src/decide.js"
import {
  ASKS_QUESTIONS,
  ASKS_THRESHOLD,
  ASKS_USER_MESSAGE,
  DONE_CHECK_TAG,
  DONE_CHECK_THRESHOLDS,
  judge,
  messageState,
  type Thresholds,
} from "../../packages/core/src/guard/check.js"
import { DEFAULT_UNDECIDED_FLOOR, undecidedNames } from "../../packages/core/src/model/answers.js"
import { resolveProfile } from "../../packages/core/src/model/profiles.js"
import type { Answers } from "../../packages/core/src/model/types.js"
import { SpendLedger } from "../../packages/core/src/run/spend.js"
import { createContext, deciderFor } from "../../packages/core/src/tools/context.js"
import { type HookOutput, runHook } from "../../packages/core/src/tools/hook.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "../..")
const FIXTURES = join(HERE, "fixtures")
const SETS = {
  scenarios: { file: join(HERE, "scenarios.yaml"), results: join(HERE, "results.json") },
  holdout: { file: join(HERE, "holdout.yaml"), results: join(HERE, "holdout-results.json") },
} as const
export type SetName = keyof typeof SETS
const NAMESPACE = "guard-done-check"

/**
 * Git without this machine's config: no global or system file and no global
 * excludes. A global `*.log` ignore once hid a test log from the runner's
 * `git add` but not from the hook, and the scenario measured the harness.
 */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.excludesFile",
  GIT_CONFIG_VALUE_0: "/dev/null",
}

/** Applied before any scenario runs; `process.env` because the in-process hook spawns git too. */
function isolateGit(): void {
  Object.assign(process.env, GIT_ENV)
}

export type Label = "met" | "unmet" | "unjudgeable" | "self"
export type Kind = "completion" | "question" | "oversize"

export interface Scenario {
  id: string
  about?: string
  kind: Kind
  /** The agent's last message at the stop, sent as the event's `last_assistant_message`. */
  message: string
  from?: "evals"
  commit?: boolean
  /** A generated word list: new and untracked, or with `tracked`, committed and then rewritten. */
  generate?: { path: string; bytes: number; tracked?: boolean }
  criteria: {
    file?: string
    intro?: string
    /** Use the fixture's own criteria file as it is (`from: evals`). */
    keep?: boolean
    items: Array<{ text: string; label: Label }>
  }
  change?: Record<string, string | null>
}

export function loadScenarios(set: SetName = "scenarios"): Scenario[] {
  const { file } = SETS[set]
  const doc = parse(readFileSync(file, "utf8"), { maxAliasCount: -1 }) as { scenarios: Scenario[] }
  return doc.scenarios
}

export function criteriaFile(s: Scenario): string {
  return s.criteria.file ?? "TASK.md"
}

/** What a careful reviewer would want: block naming exactly the unmet criteria, or allow. */
export function expected(s: Scenario): { outcome: "block" | "allow"; unmet: string[] } {
  const unmet = s.criteria.items.filter((c) => c.label === "unmet").map((c) => c.text)
  return s.kind === "completion" && unmet.length > 0
    ? { outcome: "block", unmet }
    : { outcome: "allow", unmet: [] }
}

const git = (dir: string, ...args: string[]) => {
  const run = spawnSync(
    "git",
    ["-c", "user.email=eval@local", "-c", "user.name=eval", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, encoding: "utf8" },
  )
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`)
  return run.stdout
}

function write(dir: string, files: Record<string, string | null>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, path)
    if (content === null) {
      rmSync(file, { force: true })
      continue
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}

/**
 * A deterministic word list of about `bytes` bytes: the generated file of the
 * oversize and big-log scenarios. Real words joined in pairs, so it tokenizes
 * like text: random letters run near 2 characters a token, under the size
 * check's 3, and the provider refused them (max_tokens_exceeded).
 */
function wordList(bytes: number, start = 7): string {
  const vocab = (
    "apple river stone cloud maple ember harbor lantern meadow orbit pepper quartz " +
    "saddle timber velvet willow anchor basket candle dragon falcon garden hollow island " +
    "jungle kettle ladder marble needle oyster pillow rocket silver tunnel violet wagon"
  ).split(" ")
  const words: string[] = []
  let seed = start
  let size = 0
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return vocab[seed % vocab.length] as string
  }
  while (size < bytes) {
    const w = `${next()}-${next()}`
    words.push(`  "${w}",`)
    size += w.length + 6
  }
  return `/** Words for readable slugs. */\nexport const WORDS = [\n${words.join("\n")}\n]\n`
}

/** The repo at the session's start, committed: base project, criteria file and config. */
export function buildRepo(s: Scenario, dir: string): void {
  isolateGit()
  const base = s.from === "evals" ? join(ROOT, "tools/evals/fixture-repo") : join(HERE, "base")
  cpSync(base, dir, { recursive: true })
  const file = criteriaFile(s)
  if (!s.criteria.keep) {
    const bullets = s.criteria.items.map((c) => `- [ ] ${c.text}`).join("\n")
    write(dir, { [file]: `${s.criteria.intro ? `${s.criteria.intro}\n\n` : ""}${bullets}\n` })
  }
  if (s.generate?.tracked) write(dir, { [s.generate.path]: wordList(s.generate.bytes) })
  write(dir, {
    ".system1/config.yaml": [
      "egress:",
      "  consent: { granted: true }",
      "guard:",
      "  packs:",
      "    done-check:",
      "      enabled: true",
      `      criteria: [${JSON.stringify(file)}]`,
      "",
    ].join("\n"),
  })
  git(dir, "init", "-q")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "session start")
}

/** The agent's work: what changes between SessionStart and Stop. */
export function applyChange(s: Scenario, dir: string): void {
  if (s.from === "evals")
    cpSync(join(ROOT, "tools/evals/fixture-changes"), dir, { recursive: true })
  write(dir, s.change ?? {})
  if (s.generate)
    write(dir, { [s.generate.path]: wordList(s.generate.bytes, s.generate.tracked ? 11 : 7) })
  if (s.commit) {
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "the agent's work")
  }
}

export interface Probabilities {
  judgeable: number
  met: number
  undecided: string[]
}

export interface Run {
  id: string
  kind: Kind
  outcome: "block" | "allow"
  /** The criteria a block named. */
  named: string[]
  message: string
  latencyMs: number
  calls: number
  cost: number
  /** Per criterion text, the model's answers (from the calls this run made or replayed). */
  answers: Record<string, Probabilities>
}

function fixtureDir(id: string): string {
  return join(FIXTURES, id)
}

/** The bullets of a block reason's "look unmet" list. */
export function namedInBlock(reason: string): string[] {
  const lines = reason.split("\n")
  const start = lines.findIndex((l) => l.includes("look unmet"))
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break
    out.push(line.slice(2))
  }
  return out
}

/** Each criterion's answers, read from the fixtures a run recorded or replayed. */
export function answersFrom(dir: string, fixtureKeys?: Set<string>): Record<string, Probabilities> {
  const out: Record<string, Probabilities> = {}
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    if (fixtureKeys && !fixtureKeys.has(name.replace(/\.json$/, ""))) continue
    const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
      request: { questions: Record<string, { instructions: string }> }
      response: { answers: Answers }
    }
    const { questions } = record.request
    const { answers } = record.response
    const undecided = undecidedNames(answers, DEFAULT_UNDECIDED_FLOOR)
    for (const [q, spec] of Object.entries(questions)) {
      if (!q.startsWith("j")) continue
      const text = JSON.parse(
        spec.instructions.slice(spec.instructions.indexOf("Criterion: ") + 11),
      )
      const i = q.slice(1)
      const j = answers[q]
      const m = answers[`m${i}`]
      if (j?.type !== "noul" || m?.type !== "noul") continue
      out[text] = {
        judgeable: j.noul,
        met: m.noul,
        undecided: undecided.filter((n) => n === q || n === `m${i}`).map((n) => n[0] as string),
      }
    }
  }
  return out
}

/**
 * The question check's answer, read from a scenario's fixtures: the `asks`
 * probability, or undefined when there was no message call or it was undecided.
 */
export function asksFrom(dir: string): number | undefined {
  if (!existsSync(dir)) return undefined
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
      request: { questions: Record<string, unknown> }
      response: { answers: Answers }
    }
    if (!("asks" in record.request.questions)) continue
    const a = record.response.answers.asks
    const undecided = undecidedNames(record.response.answers, DEFAULT_UNDECIDED_FLOOR)
    return a?.type === "noul" && !undecided.includes("asks") ? a.noul : undefined
  }
  return undefined
}

/** Run one scenario through the hook in process: replay, or record live. */
export async function runScenario(
  s: Scenario,
  opts: { mode: "replay" | "record"; key?: string },
): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), `done-check-${s.id}-`))
  const home = mkdtempSync(join(tmpdir(), "done-check-home-"))
  try {
    buildRepo(s, dir)
    const store = join(dir, ".system1/fixtures", NAMESPACE)
    if (opts.mode === "replay" && existsSync(fixtureDir(s.id))) {
      mkdirSync(store, { recursive: true })
      cpSync(fixtureDir(s.id), store, { recursive: true })
    }
    const env: NodeJS.ProcessEnv =
      opts.mode === "replay" ? { SYSTEM1_REPLAY: "1" } : { OPENROUTER_API_KEY: opts.key ?? "" }
    const mode: DecideMode = opts.mode === "record" ? "record" : "auto"
    const event = { session_id: `eval-${s.id}`, cwd: dir }
    const options = { env, home, mode }
    await runHook(
      "done-check",
      { ...event, hook_event_name: "SessionStart", source: "startup" },
      options,
    )
    applyChange(s, dir)
    const started = performance.now()
    const output: HookOutput = await runHook(
      "done-check",
      { ...event, hook_event_name: "Stop", last_assistant_message: s.message },
      options,
    )
    const latencyMs = performance.now() - started
    if (opts.mode === "record") {
      rmSync(fixtureDir(s.id), { recursive: true, force: true })
      if (existsSync(store)) cpSync(store, fixtureDir(s.id), { recursive: true })
    }
    const usage = new SpendLedger(join(dir, ".system1/usage.jsonl")).summary()
    const block = "decision" in output ? output.reason : undefined
    return {
      id: s.id,
      kind: s.kind,
      outcome: block !== undefined ? "block" : "allow",
      named: block !== undefined ? namedInBlock(block) : [],
      message: block ?? ("systemMessage" in output ? output.systemMessage : ""),
      latencyMs,
      calls: usage.calls,
      cost: usage.cost,
      answers: answersFrom(fixtureDir(s.id)),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

export type Grade =
  | "correct"
  | "false-block" // blocked a completed task, or named a criterion that is met
  | "missed-block" // allowed a task with an unmet criterion
  | "partial-block" // blocked, naming only some of the unmet criteria
  | "question-block" // blocked a stop that asked the user something
  | "not-checked" // the hook failed open (replay miss, timeout, provider): no verdict at all

export function grade(
  s: Scenario,
  outcome: "block" | "allow",
  named: string[],
  message = "",
): Grade {
  if (message.includes(": not checked:")) return "not-checked"
  const want = expected(s)
  if (s.kind === "question") return outcome === "block" ? "question-block" : "correct"
  if (outcome === "allow") return want.outcome === "block" ? "missed-block" : "correct"
  if (want.outcome === "allow") return "false-block"
  if (named.some((n) => !want.unmet.includes(n))) return "false-block"
  return named.length < want.unmet.length ? "partial-block" : "correct"
}

export interface Scorecard {
  scenarios: number
  criteria: number
  grades: Record<Grade, string[]>
  /** Completion stops whose work is done, and how many were blocked. */
  falseBlock: { n: number; blocked: number }
  /** Completion stops with an unmet criterion, and how many were let through. */
  missedBlock: { n: number; missed: number }
  /** Stops to ask the user something: reported, never fitted against (decision 2). */
  questionBlock: { n: number; blocked: number }
  /** Changes too large to show whole: by design they never block, so a block is a bug. */
  oversizeBlock: { n: number; blocked: number }
  /**
   * Stops the question check let through unchecked: question stops (wanted),
   * and the ids of other stops (each one never checked).
   */
  askSkip: { questions: number; completions: string[] }
}

export function score(
  scenarios: Scenario[],
  runs: Array<Pick<Run, "id" | "outcome" | "named"> & { message?: string }>,
): Scorecard {
  const grades: Record<Grade, string[]> = {
    correct: [],
    "false-block": [],
    "missed-block": [],
    "partial-block": [],
    "question-block": [],
    "not-checked": [],
  }
  const skippedIds = runs.filter((r) => r.message === ASKS_USER_MESSAGE).map((r) => r.id)
  let done = 0
  let notDone = 0
  let questions = 0
  let oversize = 0
  for (const run of runs) {
    const s = scenarios.find((x) => x.id === run.id)
    if (!s) throw new Error(`no scenario ${run.id}`)
    grades[grade(s, run.outcome, run.named, run.message)].push(s.id)
    if (s.kind === "question") questions++
    else if (s.kind === "oversize") oversize++
    else if (expected(s).outcome === "block") notDone++
    else done++
  }
  return {
    scenarios: runs.length,
    criteria: scenarios
      .filter((s) => runs.some((r) => r.id === s.id))
      .reduce((n, s) => n + s.criteria.items.length, 0),
    grades,
    falseBlock: {
      n: done,
      blocked: grades["false-block"].filter((id) => {
        const s = byId(scenarios, id)
        return s.kind === "completion" && expected(s).outcome === "allow"
      }).length,
    },
    missedBlock: { n: notDone, missed: grades["missed-block"].length },
    questionBlock: { n: questions, blocked: grades["question-block"].length },
    oversizeBlock: {
      n: oversize,
      blocked: grades["false-block"].filter((id) => byId(scenarios, id).kind === "oversize").length,
    },
    askSkip: {
      questions: skippedIds.filter((id) => byId(scenarios, id).kind === "question").length,
      completions: skippedIds.filter((id) => byId(scenarios, id).kind !== "question"),
    },
  }
}

function byId(scenarios: Scenario[], id: string): Scenario {
  const s = scenarios.find((x) => x.id === id)
  if (!s) throw new Error(`no scenario ${id}`)
  return s
}

/**
 * The outcome each scenario would have at other thresholds, from its recorded
 * answers: a stop blocks when any criterion the model saw whole is unmet. An
 * oversize change is seen in parts, which never block, and a stop whose message
 * the model read as asking the user something isn't checked. It mirrors `decideDone`
 * only for the paths this set exercises: a completion event that went partial,
 * or a criterion lint or a withheld file kept from the model, isn't modelled.
 */
export function simulate(
  s: Scenario,
  answers: Record<string, Probabilities>,
  t: Thresholds,
  asks?: number,
): { outcome: "block" | "allow"; named: string[]; message?: string } {
  if (asks !== undefined && asks >= ASKS_THRESHOLD)
    return { outcome: "allow", named: [], message: ASKS_USER_MESSAGE }
  if (s.kind === "oversize") return { outcome: "allow", named: [] }
  const named = s.criteria.items
    .map((c) => c.text)
    .filter((text) => {
      const a = answers[text]
      if (!a) return false
      const verdict = judge(
        { text, file: "", line: 0 },
        0,
        { j0: { type: "noul", noul: a.judgeable }, m0: { type: "noul", noul: a.met } },
        a.undecided.map((q) => `${q}0`),
        t,
      ).verdict
      return verdict === "unmet"
    })
  return named.length > 0 ? { outcome: "block", named } : { outcome: "allow", named: [] }
}

export interface FitRow {
  t: Thresholds
  card: Scorecard
}

export function fitThresholds(
  scenarios: Scenario[],
  answers: Record<string, Record<string, Probabilities>>,
  asks: Record<string, number | undefined> = {},
): FitRow[] {
  const rows: FitRow[] = []
  for (let j = 30; j <= 95; j += 5) {
    for (let u = 55; u <= 95; u += 5) {
      const t = { judgeable: j / 100, unmet: u / 100 }
      const runs = scenarios.map((s) => ({
        id: s.id,
        ...simulate(s, answers[s.id] ?? {}, t, asks[s.id]),
      }))
      rows.push({ t, card: score(scenarios, runs) })
    }
  }
  return rows
}

// ─── Live latency, through the built CLI ─────────────────────────────────────

function cliStop(
  s: Scenario,
  key: string,
): {
  ms: number
  cost: number
  calls: number
  outcome: "block" | "allow"
  named: string[]
  message: string
} {
  const dir = mkdtempSync(join(tmpdir(), `done-check-${s.id}-`))
  const home = mkdtempSync(join(tmpdir(), "done-check-home-"))
  try {
    buildRepo(s, dir)
    const bin = join(ROOT, "packages/cli/dist/bundle/decide.mjs")
    const env = {
      ...GIT_ENV,
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      OPENROUTER_API_KEY: key,
    }
    const hook = (name: string) => {
      const input = JSON.stringify({
        hook_event_name: name,
        session_id: `eval-${s.id}`,
        cwd: dir,
        ...(name === "SessionStart"
          ? { source: "startup" }
          : { last_assistant_message: s.message }),
      })
      const started = performance.now()
      const run = spawnSync("node", [bin, "hook", "done-check", "--harness", "claude"], {
        cwd: dir,
        env,
        input,
        encoding: "utf8",
      })
      return { ms: performance.now() - started, out: run.stdout }
    }
    hook("SessionStart")
    applyChange(s, dir)
    const stop = hook("Stop")
    const usage = new SpendLedger(join(dir, ".system1/usage.jsonl")).summary()
    const output = JSON.parse(stop.out || "{}") as HookOutput
    const block = "decision" in output ? output.reason : undefined
    return {
      ms: stop.ms,
      cost: usage.cost,
      calls: usage.calls,
      outcome: block !== undefined ? "block" : "allow",
      named: block !== undefined ? namedInBlock(block) : [],
      message: block ?? ("systemMessage" in output ? output.systemMessage : ""),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const file = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "system1/credentials",
  )
  const doc = existsSync(file)
    ? (parse(readFileSync(file, "utf8")) as { openrouter_api_key?: string })
    : {}
  if (!doc?.openrouter_api_key)
    throw new Error("a live run needs OPENROUTER_API_KEY or ~/.config/system1/credentials")
  return doc.openrouter_api_key
}

function printCard(card: Scorecard): void {
  const pct = (a: number, n: number) => (n ? `${((100 * a) / n).toFixed(0)}%` : "-")
  console.log(`scenarios ${card.scenarios}, criteria ${card.criteria}`)
  console.log(
    `  false blocks   ${card.falseBlock.blocked}/${card.falseBlock.n} done stops (${pct(card.falseBlock.blocked, card.falseBlock.n)})`,
  )
  console.log(
    `  missed blocks  ${card.missedBlock.missed}/${card.missedBlock.n} not-done stops (${pct(card.missedBlock.missed, card.missedBlock.n)})`,
  )
  console.log(`  question stops blocked ${card.questionBlock.blocked}/${card.questionBlock.n}`)
  console.log(`  oversize stops blocked ${card.oversizeBlock.blocked}/${card.oversizeBlock.n}`)
  console.log(
    `  let through as questions: ${card.askSkip.questions}/${card.questionBlock.n} question stops, ${card.askSkip.completions.length} completion stops${card.askSkip.completions.length ? ` (${card.askSkip.completions.join(", ")})` : ""}`,
  )
  for (const [g, ids] of Object.entries(card.grades))
    if (g !== "correct" && ids.length) console.log(`  ${g}: ${ids.join(", ")}`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const only = flag("--only")
  const set: SetName = args.includes("--holdout") ? "holdout" : "scenarios"
  if (args.includes("--messages")) {
    await messagesMain(set === "holdout" ? "holdout" : "messages", args.includes("--record"))
    return
  }
  const all = loadScenarios(set)
  const scenarios = only ? all.filter((s) => s.id === only) : all
  if (scenarios.length === 0) throw new Error(`no scenario ${only}`)

  if (args.includes("--fit")) {
    if (set === "holdout") throw new Error("the holdout is never fitted on")
    const answers = Object.fromEntries(all.map((s) => [s.id, answersFrom(fixtureDir(s.id))]))
    const asks = Object.fromEntries(all.map((s) => [s.id, asksFrom(fixtureDir(s.id))]))
    const rows = fitThresholds(all, answers, asks)
    const now = rows.find(
      (r) =>
        r.t.judgeable === DONE_CHECK_THRESHOLDS.judgeable &&
        r.t.unmet === DONE_CHECK_THRESHOLDS.unmet,
    )
    console.log(`current ${JSON.stringify(DONE_CHECK_THRESHOLDS)}:`)
    if (now) printCard(now.card)
    // Question stops are reported, not fitted against (maintainer decision 2).
    const bad = (c: Scorecard) => c.grades["false-block"].length
    const best = rows
      .filter((r) => bad(r.card) === 0)
      .sort((a, b) => a.card.missedBlock.missed - b.card.missedBlock.missed)
    console.log("\njudgeable × unmet → missed blocks (x = any false block)")
    const js = [...new Set(rows.map((r) => r.t.judgeable))]
    const us = [...new Set(rows.map((r) => r.t.unmet))]
    console.log(`      ${us.map((u) => u.toFixed(2)).join(" ")}`)
    for (const j of js) {
      const cells = us.map((u) => {
        const r = rows.find((x) => x.t.judgeable === j && x.t.unmet === u)
        return r && bad(r.card) > 0 ? "   x" : `${r?.card.missedBlock.missed ?? "?"}`.padStart(4)
      })
      console.log(`${j.toFixed(2)} ${cells.join(" ")}`)
    }
    console.log(
      `\nfewest missed with no false block: ${best[0] ? `${best[0].card.missedBlock.missed} missed at ${JSON.stringify(best[0].t)}` : "none"}`,
    )
    return
  }

  if (args.includes("--latency")) {
    const n = Number(flag("--latency") ?? 3)
    const key = apiKey()
    const times: number[] = []
    const costs: number[] = []
    const live: Array<{
      id: string
      outcome: "block" | "allow"
      named: string[]
      message: string
    }> = []
    let calls = 0
    for (const s of scenarios) {
      for (let i = 0; i < n; i++) {
        const r = cliStop(s, key)
        live.push({ id: s.id, ...r })
        // A stop that sends nothing (no change) adds no model latency: keep it out of p50/p95.
        if (r.calls > 0) times.push(r.ms)
        costs.push(r.cost)
        calls += r.calls
        const g = grade(s, r.outcome, r.named, r.message)
        console.log(
          `${s.id.padEnd(26)} ${r.ms.toFixed(0).padStart(6)} ms  ${r.calls} call(s)  $${r.cost.toFixed(6)}  ${r.outcome} ${g === "correct" ? "" : g}`,
        )
      }
    }
    console.log(`\nlive, ${n} run(s) per scenario:`)
    printCard(score(scenarios, live))
    const sorted = [...times].sort((a, b) => a - b)
    const total = costs.reduce((a, b) => a + b, 0)
    console.log(
      `Stop, through the CLI, when it calls the model: n ${sorted.length}, p50 ${percentile(sorted, 50).toFixed(0)} ms, p95 ${percentile(sorted, 95).toFixed(0)} ms, max ${sorted.at(-1)?.toFixed(0)} ms`,
    )
    console.log(
      `cost: ${calls} calls, $${total.toFixed(6)} total, $${(total / live.length).toFixed(6)} per stop`,
    )
    return
  }

  const record = args.includes("--record")
  const key = record ? apiKey() : undefined
  const runs: Run[] = []
  for (const s of scenarios) {
    const run = await runScenario(s, {
      mode: record ? "record" : "replay",
      ...(key ? { key } : {}),
    })
    runs.push(run)
    const g = grade(s, run.outcome, run.named, run.message)
    console.log(
      `${g === "correct" ? "ok  " : "FAIL"} ${s.id.padEnd(26)} ${run.outcome.padEnd(5)} ${g === "correct" ? "" : g} ${run.message.split("\n")[0]?.slice(0, 90)}`,
    )
  }
  printCard(score(scenarios, runs))
  if (!only && (record || args.includes("--write"))) {
    const results = runs.map(({ id, outcome, named, calls }) => ({ id, outcome, named, calls }))
    writeFileSync(SETS[set].results, `${JSON.stringify(results, null, 2)}\n`)
    console.log(`wrote ${SETS[set].results}`)
  }
  if (record) {
    const cost = runs.reduce((n, r) => n + r.cost, 0)
    console.log(`recorded ${runs.reduce((n, r) => n + r.calls, 0)} calls, $${cost.toFixed(6)}`)
  }
}

// ─── The question check alone, over labelled last messages ───────────────────

const MESSAGE_SETS = {
  messages: join(HERE, "messages.yaml"),
  holdout: join(HERE, "messages-holdout.yaml"),
} as const
export type MessageSetName = keyof typeof MESSAGE_SETS

export interface LabelledMessage {
  id: string
  /** `question`: the agent needs the user's answer to carry on. `completion`: it reports its work. */
  label: "question" | "completion"
  text: string
}

export function loadMessages(set: MessageSetName): LabelledMessage[] {
  return (parse(readFileSync(MESSAGE_SETS[set], "utf8")) as { messages: LabelledMessage[] })
    .messages
}

export interface MessageRun {
  id: string
  label: LabelledMessage["label"]
  /** The `asks` probability; undefined when undecided or not asked (too large, withheld). */
  asks: number | undefined
}

/** Ask the question check about each message: replayed from fixtures, or recorded live. */
export async function runMessages(
  set: MessageSetName,
  opts: { mode: "replay" | "record"; key?: string },
): Promise<MessageRun[]> {
  const dir = mkdtempSync(join(tmpdir(), "done-check-messages-"))
  const home = mkdtempSync(join(tmpdir(), "done-check-home-"))
  const fixtures = join(FIXTURES, set === "holdout" ? "messages-holdout" : "messages")
  try {
    write(dir, { ".system1/config.yaml": "egress:\n  consent: { granted: true }\n" })
    git(dir, "init", "-q")
    const store = join(dir, ".system1/fixtures", NAMESPACE)
    if (opts.mode === "replay" && existsSync(fixtures)) {
      mkdirSync(store, { recursive: true })
      cpSync(fixtures, store, { recursive: true })
    }
    const env: NodeJS.ProcessEnv =
      opts.mode === "replay" ? { SYSTEM1_REPLAY: "1" } : { OPENROUTER_API_KEY: opts.key ?? "" }
    const tool = createContext({ cwd: dir, env, home })
    const profile = resolveProfile(tool.config.model, allProfiles(tool.config))
    const mode: DecideMode = opts.mode === "record" ? "record" : "auto"
    const decider = deciderFor(tool, profile, mode, { tag: DONE_CHECK_TAG })
    const out: MessageRun[] = []
    for (const m of loadMessages(set)) {
      const prepared = await messageState(m.text, {
        profile,
        cwd: dir,
        exclude: tool.config.egress.exclude,
      })
      let asks: number | undefined
      if (prepared) {
        const r = await decider.decide({
          state: prepared.state,
          questions: ASKS_QUESTIONS,
          namespace: NAMESPACE,
        })
        const a = r.answers.asks
        asks = a?.type === "noul" && !r.undecided.includes("asks") ? a.noul : undefined
      }
      out.push({ id: m.id, label: m.label, asks })
    }
    if (opts.mode === "record") {
      rmSync(fixtures, { recursive: true, force: true })
      if (existsSync(store)) cpSync(store, fixtures, { recursive: true })
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

/** At threshold `t`: question stops let through, and completion stops skipped (never checked). */
export function messageCard(runs: MessageRun[], t = ASKS_THRESHOLD) {
  const skipped = (r: MessageRun) => r.asks !== undefined && r.asks >= t
  const questions = runs.filter((r) => r.label === "question")
  const completions = runs.filter((r) => r.label === "completion")
  return {
    questions: { n: questions.length, skipped: questions.filter(skipped).map((r) => r.id) },
    completions: { n: completions.length, skipped: completions.filter(skipped).map((r) => r.id) },
  }
}

async function messagesMain(set: MessageSetName, record: boolean): Promise<void> {
  const runs = await runMessages(set, {
    mode: record ? "record" : "replay",
    ...(record ? { key: apiKey() } : {}),
  })
  for (const r of runs) {
    const p = r.asks === undefined ? "undecided" : r.asks.toFixed(2)
    const wrong = (r.label === "question") !== (r.asks !== undefined && r.asks >= ASKS_THRESHOLD)
    console.log(`${wrong ? "FAIL" : "ok  "} ${r.id.padEnd(34)} ${r.label.padEnd(10)} asks ${p}`)
  }
  const card = messageCard(runs)
  console.log(`\nat asks >= ${ASKS_THRESHOLD}:`)
  console.log(`  question stops let through  ${card.questions.skipped.length}/${card.questions.n}`)
  console.log(
    `  completion stops skipped    ${card.completions.skipped.length}/${card.completions.n}${card.completions.skipped.length ? ` (${card.completions.skipped.join(", ")})` : ""}`,
  )
  // The blind holdout is scored at the fixed bar only: a sweep over it invites refitting.
  if (set === "holdout") return
  console.log("\nthreshold  questions let through  completions skipped")
  for (let t = 50; t <= 95; t += 5) {
    const c = messageCard(runs, t / 100)
    console.log(
      `  ${(t / 100).toFixed(2)}     ${`${c.questions.skipped.length}/${c.questions.n}`.padStart(8)}  ${`${c.completions.skipped.length}/${c.completions.n}`.padStart(18)}`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(`eval:done-check: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
