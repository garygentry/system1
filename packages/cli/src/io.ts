import type { ContextOptions } from "@garygentry/system1-core"

/** Everything the CLI touches in the outside world, injectable for tests. */
export interface Io extends ContextOptions {
  out: (text: string) => void
  err: (text: string) => void
  env: NodeJS.ProcessEnv
  /** Reads all of stdin. Only called when a flag asks for it. */
  readStdin?: () => string
  /** Whether a human is at the terminal (consent needs one, or --confirm). */
  interactive?: boolean
  /**
   * End the process once stdout is flushed, even if work is still pending.
   * `decide hook` uses it: after the harness has its answer, a check that ran
   * past its deadline must not keep the Stop waiting.
   */
  exitWhenFlushed?: () => void
}
