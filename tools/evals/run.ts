/**
 * Routing evals: drive real headless agent sessions with the prompts in
 * `routing.yaml` and record which of the plugin's skills each one loaded.
 *
 *   pnpm eval:routing [claude|codex|pi|all] [--only <skill>] [--concurrency N]
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
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const EVALS = join(ROOT, "tools/evals")
const WORK = process.env.DECISIONS_EVAL_DIR ?? join(homedir(), ".cache/decisions-evals")
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 240_000)
const SKILLS = ["ask", "design", "setup"] as const
type Skill = (typeof SKILLS)[number]
type Harness = "claude" | "codex" | "pi"

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

/** Which plugin skills a session loaded, read from its JSON event stream. */
export function loadedSkills(harness: Harness, output: string): Set<Skill> {
  const found = new Set<Skill>()
  const byPath = (text: string) => {
    for (const s of SKILLS) if (text.includes(`skills/${s}/SKILL.md`)) found.add(s)
  }
  for (const line of output.split("\n")) {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    for (const call of toolCalls(harness, event)) {
      if (call.name === "Skill") {
        const name = String((call.input as { skill?: string }).skill ?? "")
          .split(":")
          .pop()
        if (SKILLS.includes(name as Skill)) found.add(name as Skill)
      }
      byPath(JSON.stringify(call.input))
    }
  }
  return found
}

/**
 * Whether the session actually ran to an end. Without this, a harness that
 * fails to start (a bad flag, no auth) "passes" every negative.
 */
export function completed(harness: Harness, output: string): boolean {
  const marker = {
    claude: '"type":"result"',
    codex: '"type":"turn.completed"',
    pi: '"type":"agent_end"',
  }[harness]
  return output.includes(marker)
}

/** Tool calls only: a skill's path in a system prompt or a reply doesn't count. */
function toolCalls(harness: Harness, event: unknown): Array<{ name: string; input: unknown }> {
  type Content = { type?: string; name?: string; input?: unknown }
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
      .map((c) => ({ name: String(c.name), input: c.input }))
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
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.on("close", () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DECISIONS_REPLAY: "1" }
  delete env.OPENROUTER_API_KEY
  // Parent-harness session ids would mislabel the runs.
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CLAUDECODE
  return env
}

async function setupCodexHome(): Promise<string> {
  const home = join(WORK, "codex-home")
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, "rules"), { recursive: true })
  symlinkSync(join(homedir(), ".codex/auth.json"), join(home, "auth.json"))
  writeFileSync(
    join(home, "rules/decisions.rules"),
    'prefix_rule(pattern = ["decide"], decision = "allow")\n',
  )
  const env = { ...baseEnv(), CODEX_HOME: home }
  await run("codex", ["plugin", "marketplace", "add", ROOT], WORK, env)
  await run("codex", ["plugin", "add", "decisions@decisions"], WORK, env)
  return home
}

async function drive(harness: Harness, dir: string, prompt: string, codexHome?: string) {
  const env = baseEnv()
  if (harness === "claude") {
    return run(
      "claude",
      [
        "-p",
        "--plugin-dir",
        join(ROOT, "plugins/decisions"),
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
  // Codex and Pi don't put plugin bin/ on PATH; stand in for a global install.
  env.PATH = `${join(ROOT, "plugins/decisions/bin")}:${env.PATH}`
  if (harness === "codex") {
    return run(
      "codex",
      ["exec", "--json", "--skip-git-repo-check", prompt],
      dir,
      { ...env, CODEX_HOME: codexHome },
      TIMEOUT_MS,
    )
  }
  await run("pi", ["install", "-l", ROOT], dir, env)
  return run(
    "pi",
    ["-p", "--mode", "json", "--approve", "--no-session", prompt],
    dir,
    env,
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

async function evaluate(harness: Harness, cases: Case[], width: number) {
  const codexHome = harness === "codex" ? await setupCodexHome() : undefined
  const logs = join(WORK, harness)
  mkdirSync(logs, { recursive: true })
  const rows = await pool(cases, width, async (c, i) => {
    const dir = join(WORK, "runs", `${harness}-${i}`)
    await prepare(dir)
    const output = await drive(harness, dir, c.prompt, codexHome)
    writeFileSync(join(logs, `${i}-${c.skill}-${c.polarity}.jsonl`), output)
    const loaded = loadedSkills(harness, output)
    const ran = completed(harness, output)
    const pass = ran && (c.polarity === "positive" ? loaded.has(c.skill) : !loaded.has(c.skill))
    const mark = !ran ? "ERROR" : pass ? "pass" : "FAIL"
    console.log(
      `${harness} ${mark} ${c.skill} ${c.polarity}: ${c.prompt.slice(0, 70)}  [loaded: ${[...loaded].join(",") || "-"}]`,
    )
    return { ...c, loaded: [...loaded], ran, pass }
  })
  writeFileSync(join(WORK, `results-${harness}.json`), JSON.stringify(rows, null, 2))
  return rows
}

function summarise(harness: Harness, rows: Awaited<ReturnType<typeof evaluate>>): boolean {
  let ok = true
  for (const skill of SKILLS) {
    for (const polarity of ["positive", "negative"] as const) {
      const set = rows.filter((r) => r.skill === skill && r.polarity === polarity)
      if (set.length === 0) continue
      const passed = set.filter((r) => r.pass).length
      // Bar: at most one missed positive per skill; every negative must hold.
      const bar = polarity === "positive" ? set.length - 1 : set.length
      const met = passed >= bar
      ok &&= met
      console.log(
        `${harness.padEnd(6)} ${skill.padEnd(6)} ${polarity.padEnd(8)} ${passed}/${set.length} ${met ? "ok" : "BELOW BAR"}`,
      )
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
  const target = args[0] ?? "all"
  const harnesses: Harness[] = target === "all" ? ["claude", "codex", "pi"] : [target as Harness]
  const cases = loadCases(process.env.EVAL_ROUTING).filter((c) => !only || c.skill === only)
  mkdirSync(WORK, { recursive: true })
  if (WORK.startsWith(ROOT)) throw new Error(`DECISIONS_EVAL_DIR must be outside ${ROOT}`)
  let ok = true
  const summaries: Array<[Harness, Awaited<ReturnType<typeof evaluate>>]> = []
  for (const h of harnesses) summaries.push([h, await evaluate(h, cases, width)])
  console.log("\nsummary")
  for (const [h, rows] of summaries) ok = summarise(h, rows) && ok
  console.log(`\nlogs: ${WORK}`)
  process.exitCode = ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && existsSync(ROOT)) {
  await main()
}
