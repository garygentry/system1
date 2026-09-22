import type { ContextOptions } from "@garygentry/decisions-core"

/** Everything the CLI touches in the outside world, injectable for tests. */
export interface Io extends ContextOptions {
  out: (text: string) => void
  err: (text: string) => void
  env: NodeJS.ProcessEnv
  /** Reads all of stdin. Only called when a flag asks for it. */
  readStdin?: () => string
  /** Whether a human is at the terminal (consent needs one, or --confirm). */
  interactive?: boolean
}
