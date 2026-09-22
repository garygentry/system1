/**
 * Which agent session a call belongs to, so the spend ledger can answer
 * "what has this session cost" across separate `decide` invocations.
 *
 * `SYSTEM1_SESSION` always wins. Otherwise the id comes from the harness
 * running the shell. Harnesses leak their variables into child harnesses (a
 * Pi or Codex run started from Claude Code still sees
 * `CLAUDE_CODE_SESSION_ID`), so the order below picks the innermost one:
 *
 * 1. `AI_AGENT=pi`: Pi overwrites `AI_AGENT`, so this is Pi even if a parent
 *    harness's id is present.
 * 2. `AI_AGENT=claude-code…` with no Codex id: Claude also overwrites
 *    `AI_AGENT`, so a leaked Pi id belongs to a parent.
 * 3. `CODEX_THREAD_ID`: Codex leaves `AI_AGENT` alone, but no other harness
 *    sets this.
 * 4. `PI_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`.
 *
 * Known limits: Claude Code started inside Codex resolves to Codex, and Codex
 * started inside Pi resolves to Pi (Codex inherits the parent's `AI_AGENT`).
 * The environment cannot tell these apart. Set `SYSTEM1_SESSION` to override.
 */
export type Harness = "claude" | "codex" | "pi"

export interface DetectedSession {
  /** `<harness>:<id>`, or the `SYSTEM1_SESSION` value verbatim. */
  id: string
  origin: Harness | "env"
}

export function detectSession(env: NodeJS.ProcessEnv): DetectedSession | undefined {
  const explicit = nonEmpty(env.SYSTEM1_SESSION)
  if (explicit) return { id: explicit, origin: "env" }
  const found = innermost(env)
  return found?.id ? { id: `${found.harness}:${found.id}`, origin: found.harness } : undefined
}

/** The harness running this shell, by the same rule; also known without a session id. */
export function detectHarness(env: NodeJS.ProcessEnv): Harness | undefined {
  return innermost(env)?.harness
}

function innermost(env: NodeJS.ProcessEnv): { harness: Harness; id?: string } | undefined {
  const pi = nonEmpty(env.PI_SESSION_ID)
  const codex = nonEmpty(env.CODEX_THREAD_ID) ?? nonEmpty(env.CODEX_SESSION_ID)
  const claude = nonEmpty(env.CLAUDE_CODE_SESSION_ID)
  const agent = env.AI_AGENT ?? ""
  const claudeMarked = env.CLAUDECODE === "1" || claude !== undefined

  if (agent === "pi") return found("pi", pi)
  if (agent.startsWith("claude-code") && claudeMarked && !codex) return found("claude", claude)
  if (codex) return found("codex", codex)
  if (pi || env.PI_CODING_AGENT === "true") return found("pi", pi)
  if (claudeMarked) return found("claude", claude)
  return undefined
}

function found(harness: Harness, id: string | undefined): { harness: Harness; id?: string } {
  return id ? { harness, id } : { harness }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined
}
