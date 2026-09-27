import { execFile } from "node:child_process"
import { DecisionsError } from "../errors.js"

export interface GitOptions {
  /** Aborts the git process: the hook's deadline. */
  signal?: AbortSignal
  maxBuffer?: number
}

/**
 * Run git in `cwd` and resolve with stdout. The engine spawns only git (0014).
 * Asynchronous so the hook's deadline can interrupt it: a slow git (a huge
 * repo, a network filesystem) must not hold the Stop past `latencyMs`.
 * A failure is a `source-error`, which a guard hook reports and fails open on.
 */
export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (error.name === "AbortError") return reject(error)
        const detail =
          String(stderr || error.message)
            .trim()
            .split("\n")[0] ?? ""
        reject(
          Object.assign(new DecisionsError("source-error", `git ${args[0]} failed: ${detail}`), {
            exitCode: typeof error.code === "number" ? error.code : undefined,
          }),
        )
      },
    )
  })
}

/** HEAD's commit, or `null` in a repo with no commits yet. */
export async function headCommit(cwd: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const out = await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
      ...(signal ? { signal } : {}),
    })
    return out.trim() || null
  } catch (error) {
    // `--verify --quiet` exits 1 with no output when there is no commit yet.
    if ((error as { exitCode?: number }).exitCode === 1) return null
    throw error
  }
}
