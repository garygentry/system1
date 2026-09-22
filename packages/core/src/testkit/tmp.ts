import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach } from "vitest"

const dirs: string[] = []

/** Temp directories removed after each test. Call at module level. */
export function useTempDirs(): (files?: Record<string, string>) => string {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  return (files = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "decisions-test-"))
    dirs.push(dir)
    writeTree(dir, files)
    return dir
  }
}

export function writeTree(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}

/** A throwaway git repo with one commit of `files`. */
export function gitRepo(dir: string, files: Record<string, string>): string {
  writeTree(dir, files)
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-q", "-m", "init")
  return dir
}
