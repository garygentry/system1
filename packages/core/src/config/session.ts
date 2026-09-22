/**
 * Which agent session a call belongs to, so the spend ledger can answer
 * "what has this session cost" across separate `decide` invocations.
 *
 * `DECISIONS_SESSION` always wins. Otherwise the id comes from the harness
 * running the shell. Harnesses leak their variables into child harnesses (a
 * Pi or Codex run started from Claude Code still sees
 * `CLAUDE_CODE_SESSION_ID`), so the order below picks the innermost one:
 *
 * 1. `AI_AGENT=pi`: Pi overwrites `AI_AGENT`, so this is Pi even if a parent
 *    harness's id is present.
 * 2. `CODEX_THREAD_ID`: Codex leaves `AI_AGENT` alone, but no other harness
 *    sets this.
 * 3. `PI_SESSION_ID`
 * 4. `CLAUDE_CODE_SESSION_ID`
 *
 * Known limits: Claude Code started inside Codex resolves to Codex, and Codex
 * started inside Pi resolves to Pi (Codex inherits `AI_AGENT=pi`). The
 * environment cannot tell these apart. Set `DECISIONS_SESSION` to override.
 */
export type Harness = "claude" | "codex" | "pi"

export interface DetectedSession {
  /** `<harness>:<id>`, or the `DECISIONS_SESSION` value verbatim. */
  id: string
  origin: Harness | "env"
}

export function detectSession(env: NodeJS.ProcessEnv): DetectedSession | undefined {
  const explicit = nonEmpty(env.DECISIONS_SESSION)
  if (explicit) return { id: explicit, origin: "env" }

  const pi = nonEmpty(env.PI_SESSION_ID)
  const codex = nonEmpty(env.CODEX_THREAD_ID) ?? nonEmpty(env.CODEX_SESSION_ID)
  const claude = nonEmpty(env.CLAUDE_CODE_SESSION_ID)
  if (pi && env.AI_AGENT === "pi") return harness("pi", pi)
  if (codex) return harness("codex", codex)
  if (pi) return harness("pi", pi)
  if (claude) return harness("claude", claude)
  return undefined
}

/**
 * The harness running this shell, by the same innermost-first rule. Also
 * true without a session id, from each harness's own marker.
 */
export function detectHarness(env: NodeJS.ProcessEnv): Harness | undefined {
  if (env.AI_AGENT === "pi" || env.PI_CODING_AGENT === "true") return "pi"
  if (nonEmpty(env.CODEX_THREAD_ID) || nonEmpty(env.CODEX_SESSION_ID)) return "codex"
  if (nonEmpty(env.PI_SESSION_ID)) return "pi"
  if (env.CLAUDECODE === "1" || nonEmpty(env.CLAUDE_CODE_SESSION_ID)) return "claude"
  return undefined
}

function harness(origin: Harness, id: string): DetectedSession {
  return { id: `${origin}:${id}`, origin }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined
}
