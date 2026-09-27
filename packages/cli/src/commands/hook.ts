import { readFileSync } from "node:fs"
import { type HookOutput, runHook } from "@garygentry/system1-core/hook"
import { typedParse } from "../args.js"
import { EXIT, type ExitCode } from "../exit-codes.js"
import type { Io } from "../io.js"

/** Flags of `hook`. Exported so `docs/cli.md` can be checked against them. */
export const HOOK_OPTIONS = { harness: { type: "string" } } as const

/** A hook event is small; anything larger is not one. */
const MAX_EVENT_BYTES = 1024 * 1024

/**
 * `decide hook <pack> [--harness claude|codex]`: a guard pack on a harness hook
 * event (M10). The harness's hook JSON on stdout, never the envelope, and
 * **always exit 0**: to Claude Code, exit 2 is a blocking error, so a usage
 * mistake must not become a block. Problems come back as a `systemMessage`.
 */
export async function runHookCommand(argv: string[], io: Io): Promise<ExitCode> {
  io.out(JSON.stringify(await respond(argv, io)))
  io.exitWhenFlushed?.()
  return EXIT.ok
}

async function respond(argv: string[], io: Io): Promise<HookOutput> {
  let pack: string | undefined
  let harness: string | undefined
  try {
    const { values, positionals } = typedParse({
      args: argv,
      allowPositionals: true,
      options: HOOK_OPTIONS,
    })
    pack = positionals[0]
    harness = values.harness
  } catch (error) {
    return { systemMessage: `System 1 hook: not run: ${(error as Error).message}` }
  }
  if (!pack) return { systemMessage: "System 1 hook: not run: name a guard pack" }
  if (harness !== undefined && harness !== "claude" && harness !== "codex") {
    return { systemMessage: `System 1 ${pack}: not run: --harness must be claude or codex` }
  }
  let event: unknown
  try {
    const text = (io.readStdin ?? (() => readFileSync(0, "utf8")))()
    if (Buffer.byteLength(text) > MAX_EVENT_BYTES) throw new Error("too large")
    event = JSON.parse(text)
  } catch {
    // runHook decides whether to say anything: a dormant pack stays silent.
    event = undefined
  }
  return runHook(pack, event, {
    env: io.env,
    ...(io.cwd ? { cwd: io.cwd } : {}),
    ...(io.home ? { home: io.home } : {}),
    ...(harness ? { harness } : {}),
  })
}
