/**
 * Routing evals: drive real headless agent sessions with the prompts in
 * `routing.yaml` and record which of the plugin's skills each one loaded.
 *
 *   pnpm eval:routing [claude|codex|pi|all] [--only <skill>] [--concurrency N] [--repeat N]
 *
 * EVAL_ROUTING=<file> swaps the prompt set (e.g. routing-holdout.yaml);
 * EVAL_ROUTE=off turns the Claude routing hook off for a without-hook baseline.
 *
 * One run of 8 prompts cannot resolve a one-prompt change: the same Claude
 * description scored 5/8 to 7/8 across runs. `--repeat N` runs every prompt N
 * times and judges the mean, with a per-prompt hit rate for anything unsteady.
 *
 * Local only, like smoke: every prompt spends that harness's model tokens. No
 * decision calls are made (replay, no key). Workdirs live outside this repo,
 * because Codex and Pi read instruction files (AGENTS.md) from parent
 * directories, and this repo's plans would contaminate the run.
 */
import { spawn } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const EVALS = join(ROOT, "tools/evals")
const WORK = workDir(process.env.SYSTEM1_EVAL_DIR)
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 240_000)
const SKILLS = ["ask", "design", "setup"] as const
type Skill = (typeof SKILLS)[number]
type Harness = "claude" | "codex" | "pi"

/**
 * Resolved, and refused when it is empty or anywhere inside this repo: every
 * run deletes and recreates directories under it.
 */
export function workDir(raw: string | undefined, root = ROOT): string {
  const dir = resolve(raw?.trim() ? raw : join(homedir(), ".cache/system1-evals"))
  const rel = relative(root, dir)
  if (rel === "" || !(rel.startsWith("..") || resolve(rel) === rel)) {
    throw new Error(`SYSTEM1_EVAL_DIR must be outside ${root} (got ${dir})`)
  }
  return dir
}

export interface Case {
  skill: Skill
  polarity: "positive" | "negative"
  prompt: string
}

export const MINIMUMS: Record<Skill, { positive: number; negative: number }> = {
  ask: { positive: 8, negative: 8 },
  design: { positive: 4, negative: 4 },
  setup: { positive: 0, negative: 4 },
}

export function loadCases(file: string = join(EVALS, "routing.yaml")): Case[] {
  const doc = parse(readFileSync(file, "utf8")) as Record<
    string,
    { positive?: string[]; negative?: string[] }
  >
  return Object.entries(doc).flatMap(([skill, sets]) =>
    (["positive", "negative"] as const).flatMap((polarity) =>
      (sets[polarity] ?? []).map((prompt) => ({ skill: skill as Skill, polarity, prompt })),
    ),
  )
}

/** Which of this plugin's skills a session loaded, read from its JSON event stream. */
export function loadedSkills(harness: Harness, output: string): Set<Skill> {
  const found = new Set<Skill>()
  const events = output.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown]
    } catch {
      return []
    }
  })
  const failed = failedToolIds(events)
  for (const event of events) {
    for (const call of toolCalls(harness, event)) {
      if (call.id && failed.has(call.id)) continue // refused, e.g. a user-only skill
      if (call.name === "Skill") {
        // Only this plugin's skills: Claude also has built-ins such as `design`.
        const m = /^system1:(\w+)$/.exec(String((call.input as { skill?: string }).skill ?? ""))
        if (m && SKILLS.includes(m[1] as Skill)) found.add(m[1] as Skill)
        continue
      }
      for (const skill of SKILLS) if (reads(call, skill)) found.add(skill)
    }
  }
  return found
}

/**
 * A read of the skill's SKILL.md: a file-read tool on it, or a shell command
 * that prints it. A search that merely names the path (`grep … SKILL.md`)
 * doesn't count.
 */
function reads(call: { name: string; input: unknown }, skill: Skill): boolean {
  const path = `skills/${skill}/SKILL.md`
  if (call.name === "Read" || call.name === "read") {
    const input = call.input as { file_path?: string; path?: string }
    return String(input.file_path ?? input.path ?? "").endsWith(path)
  }
  if (call.name === "exec" || call.name === "bash" || call.name === "Bash") {
    const command = String(
      typeof call.input === "string"
        ? call.input
        : ((call.input as { command?: string }).command ?? ""),
    )
    return new RegExp(
      `\\b(cat|sed|head|less|nl|bat)\\b[^|;&]*${path.replace(/[/.]/g, "\\$&")}`,
    ).test(command)
  }
  return false
}

/** Claude tool calls whose result came back as an error. */
function failedToolIds(events: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const e of events as Array<{ type?: string; message?: { content?: unknown } }>) {
    if (e?.type !== "user" || !Array.isArray(e.message?.content)) continue
    for (const c of e.message.content as Array<{
      type?: string
      tool_use_id?: string
      is_error?: boolean
    }>) {
      if (c.type === "tool_result" && c.is_error && c.tool_use_id) ids.add(c.tool_use_id)
    }
  }
  return ids
}

/**
 * Whether the session ran to a clean end. Without this, a harness that fails
 * to start, or dies on an API error, "passes" every negative.
 */
export function completed(harness: Harness, output: string): boolean {
  const events = output.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>]
    } catch {
      return []
    }
  })
  if (harness === "claude") {
    return events.some((e) => e.type === "result" && e.subtype === "success" && e.is_error !== true)
  }
  if (harness === "codex") {
    const failed = events.some((e) => e.type === "turn.failed" || e.type === "error")
    return !failed && events.some((e) => e.type === "turn.completed")
  }
  const end = events.find((e) => e.type === "agent_end") as { stopReason?: string } | undefined
  const last = [...events].reverse().find((e) => e.type === "message_end") as
    | { message?: { stopReason?: string } }
    | undefined
  return end !== undefined && end.stopReason !== "error" && last?.message?.stopReason !== "error"
}

/** Tool calls only: a skill's path in a system prompt or a reply doesn't count. */
function toolCalls(
  harness: Harness,
  event: unknown,
): Array<{ id?: string; name: string; input: unknown }> {
  type Content = { type?: string; id?: string; name?: string; input?: unknown }
  type Event = {
    type?: string
    message?: { content?: Content[] }
    item?: { type?: string; command?: string }
    toolName?: string
    args?: unknown
  }
  const e = (event ?? {}) as Event
  if (harness === "claude" && e.type === "assistant") {
    return (e.message?.content ?? [])
      .filter((c) => c.type === "tool_use")
      .map((c) => ({ ...(c.id ? { id: c.id } : {}), name: String(c.name), input: c.input }))
  }
  if (harness === "codex" && e.item?.type === "command_execution" && e.type === "item.started") {
    return [{ name: "exec", input: e.item.command }]
  }
  if (harness === "pi" && e.type === "tool_execution_start") {
    return [{ name: String(e.toolName), input: e.args }]
  }
  return []
}

async function prepare(dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(EVALS, "fixture-repo"), dir, { recursive: true })
  const git = (...args: string[]) =>
    run("git", ["-c", "user.email=eval@local", "-c", "user.name=eval", ...args], dir)
  await git("init", "-q")
  await git("add", "-A")
  await git("commit", "-qm", "fixture")
  // An uncommitted change, so "the current diff" means something.
  cpSync(join(EVALS, "fixture-changes"), dir, { recursive: true })
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout also kills whatever it spawned
    // (a grandchild holding stdout open would otherwise keep us waiting).
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true })
    let out = ""
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(out)
    }
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), "SIGKILL")
      } catch {}
      finish()
    }, timeoutMs)
    child.on("close", finish)
  })
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  // Nothing from a parent harness (session ids, effort, entrypoints) leaks in.
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|CODEX_|PI_|AI_AGENT$|OPENROUTER_API_KEY$|SYSTEM1_)/.test(k)) continue
    env[k] = v
  }
  env.SYSTEM1_REPLAY = "1"
  // EVAL_ROUTE=off measures Claude without the routing hook (decision 0018),
  // on the same staged plugin.
  if (process.env.EVAL_ROUTE) env.SYSTEM1_ROUTE = process.env.EVAL_ROUTE
  // The shim runs this checkout's CLI without its path leading back here.
  env.SYSTEM1_CLI = join(ROOT, "packages/cli/dist/bundle/decide.mjs")
  env.PATH = `${join(PKG, "plugins/system1/bin")}:${env.PATH}`
  return env
}

/**
 * A copy of the plugin outside the repo. Pointing harnesses at the checkout
 * let agents wander from the skill's path into this repo's plans and source.
 */
const PKG = join(WORK, "pkg")
function stagePlugin(): void {
  rmSync(PKG, { recursive: true, force: true })
  cpSync(join(ROOT, "plugins/system1"), join(PKG, "plugins/system1"), { recursive: true })
  cpSync(join(ROOT, ".agents"), join(PKG, ".agents"), { recursive: true })
  writeFileSync(
    join(PKG, "package.json"),
    JSON.stringify({
      name: "system1-eval",
      private: true,
      pi: { skills: ["./plugins/system1/skills"] },
    }),
  )
}

/** Pi reads packages from its agent dir: give it one with only auth and the model. */
function setupPiAgent(): string {
  const dir = join(WORK, "pi-agent")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const real = join(homedir(), ".pi/agent")
  for (const f of ["auth.json", "models-store.json"]) {
    if (existsSync(join(real, f))) symlinkSync(join(real, f), join(dir, f))
  }
  const settings = JSON.parse(readFileSync(join(real, "settings.json"), "utf8")) as Record<
    string,
    unknown
  >
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
    }),
  )
  return dir
}

async function setupCodexHome(): Promise<string> {
  const home = join(WORK, "codex-home")
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, "rules"), { recursive: true })
  symlinkSync(join(homedir(), ".codex/auth.json"), join(home, "auth.json"))
  writeFileSync(
    join(home, "rules/system1.rules"),
    'prefix_rule(pattern = ["decide"], decision = "allow")\n',
  )
  const env = { ...baseEnv(), CODEX_HOME: home }
  await run("codex", ["plugin", "marketplace", "add", PKG], WORK, env)
  await run("codex", ["plugin", "add", "system1@system1"], WORK, env)
  return home
}

async function drive(harness: Harness, dir: string, prompt: string, home?: string) {
  const env = baseEnv()
  if (harness === "claude") {
    return run(
      "claude",
      [
        "-p",
        "--plugin-dir",
        join(PKG, "plugins/system1"),
        // User settings are skipped by default: their plugins crowd the skill
        // list, and their hooks can rewrite commands past --allowedTools (an
        // `rtk git diff` rewrite once blocked every git call). Set
        // EVAL_CLAUDE_USER_SETTINGS=1 to measure inside your own setup.
        ...(process.env.EVAL_CLAUDE_USER_SETTINGS ? [] : ["--setting-sources", "project,local"]),
        "--output-format",
        "stream-json",
        "--verbose",
        "--allowedTools",
        "Skill",
        "Read",
        "Grep",
        "Glob",
        "Bash(decide *)",
        "Bash(git *)",
        "Bash(grep *)",
        "Bash(tail *)",
        // --allowedTools is variadic: a flag must end it before the prompt.
        "--model",
        process.env.EVAL_CLAUDE_MODEL ?? "sonnet",
        prompt,
      ],
      dir,
      env,
      TIMEOUT_MS,
    )
  }
  // Codex and Pi don't put plugin bin/ on PATH: baseEnv's PATH stands in for
  // a global install.
  if (harness === "codex") {
    return run(
      "codex",
      ["exec", "--json", "--skip-git-repo-check", prompt],
      dir,
      { ...env, CODEX_HOME: home },
      TIMEOUT_MS,
    )
  }
  const piEnv = { ...env, PI_CODING_AGENT_DIR: home }
  await run("pi", ["install", "-l", PKG], dir, piEnv)
  return run(
    "pi",
    ["-p", "--mode", "json", "--approve", "--no-session", prompt],
    dir,
    piEnv,
    TIMEOUT_MS,
  )
}

async function pool<T, R>(items: T[], width: number, fn: (item: T, i: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i] as T, i)
      }
    }),
  )
  return results
}

export interface Row extends Case {
  rep: number
  loaded: Skill[]
  ran: boolean
  pass: boolean
}

export interface Score {
  skill: Skill
  polarity: Case["polarity"]
  /** Prompts in the set, and runs of each. */
  size: number
  repeat: number
  passed: number
  met: boolean
  /** Prompts that did not pass every run, with how many runs they passed. */
  unsteady: Array<{ prompt: string; passed: number }>
}

/**
 * Bar, per skill: on average at most one missed positive per run (so N misses
 * in total over N runs), and every negative holds in every run.
 */
export function score(rows: Row[], repeat: number): Score[] {
  const scores: Score[] = []
  for (const skill of SKILLS) {
    for (const polarity of ["positive", "negative"] as const) {
      const set = rows.filter((r) => r.skill === skill && r.polarity === polarity)
      if (set.length === 0) continue
      const passed = set.filter((r) => r.pass).length
      const misses = set.length - passed
      const byPrompt = new Map<string, number>()
      for (const r of set) byPrompt.set(r.prompt, (byPrompt.get(r.prompt) ?? 0) + (r.pass ? 1 : 0))
      scores.push({
        skill,
        polarity,
        size: byPrompt.size,
        repeat,
        passed,
        met: polarity === "positive" ? misses <= repeat : misses === 0,
        unsteady: [...byPrompt]
          .filter(([, n]) => n < repeat)
          .map(([prompt, n]) => ({ prompt, passed: n })),
      })
    }
  }
  return scores
}

async function evaluate(harness: Harness, cases: Case[], width: number, repeat: number) {
  const home =
    harness === "codex" ? await setupCodexHome() : harness === "pi" ? setupPiAgent() : undefined
  const logs = join(WORK, harness)
  mkdirSync(logs, { recursive: true })
  const jobs = Array.from({ length: repeat }, (_, rep) => cases.map((c) => ({ ...c, rep }))).flat()
  const rows = await pool(jobs, width, async (c, i): Promise<Row> => {
    const dir = join(WORK, "runs", `${harness}-${i}`)
    await prepare(dir)
    const output = await drive(harness, dir, c.prompt, home)
    writeFileSync(join(logs, `${i}-${c.skill}-${c.polarity}.jsonl`), output)
    const loaded = loadedSkills(harness, output)
    const ran = completed(harness, output)
    const pass = ran && (c.polarity === "positive" ? loaded.has(c.skill) : !loaded.has(c.skill))
    const mark = !ran ? "ERROR" : pass ? "pass" : "FAIL"
    const nth = repeat > 1 ? ` #${c.rep + 1}` : ""
    console.log(
      `${harness}${nth} ${mark} ${c.skill} ${c.polarity}: ${c.prompt.slice(0, 70)}  [loaded: ${[...loaded].join(",") || "-"}]`,
    )
    return { ...c, loaded: [...loaded], ran, pass }
  })
  writeFileSync(join(WORK, `results-${harness}.json`), JSON.stringify(rows, null, 2))
  return rows
}

function summarise(harness: Harness, rows: Row[], repeat: number): boolean {
  let ok = true
  for (const s of score(rows, repeat)) {
    ok &&= s.met
    const mean =
      repeat > 1 ? ` (mean ${(s.passed / repeat).toFixed(1)}/${s.size} over ${repeat} runs)` : ""
    console.log(
      `${harness.padEnd(6)} ${s.skill.padEnd(6)} ${s.polarity.padEnd(8)} ${s.passed}/${s.size * repeat}${mean} ${s.met ? "ok" : "BELOW BAR"}`,
    )
    if (repeat > 1) {
      for (const u of s.unsteady)
        console.log(`         ${u.passed}/${repeat}  ${u.prompt.slice(0, 70)}`)
    }
  }
  return ok
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args.splice(i, 2)[1] : undefined
  }
  const only = flag("--only")
  const width = Number(flag("--concurrency") ?? 3)
  const repeat = Number(flag("--repeat") ?? 1)
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error("--repeat must be a positive integer")
  const target = args[0] ?? "all"
  const harnesses: Harness[] = target === "all" ? ["claude", "codex", "pi"] : [target as Harness]
  const cases = loadCases(process.env.EVAL_ROUTING).filter((c) => !only || c.skill === only)
  mkdirSync(WORK, { recursive: true })
  stagePlugin()
  let ok = true
  const summaries: Array<[Harness, Row[]]> = []
  for (const h of harnesses) summaries.push([h, await evaluate(h, cases, width, repeat)])
  console.log("\nsummary")
  for (const [h, rows] of summaries) ok = summarise(h, rows, repeat) && ok
  console.log(`\nlogs: ${WORK}`)
  process.exitCode = ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && existsSync(ROOT)) {
  await main()
}
