import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// The generated Claude Code hook (decision 0018) must never get in the way of a
// prompt: whatever decide does, the hook exits 0 and prints only a real hint.
const hooks = JSON.parse(
  readFileSync(join(import.meta.dirname, "../plugins/system1/hooks/claude-hooks.json"), "utf8"),
)
const command: string = hooks.hooks.UserPromptSubmit[0].hooks[0].command
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Run the hook command against a stand-in decide that prints `out` and exits `code`. */
function runHook(script: string) {
  const root = mkdtempSync(join(tmpdir(), "system1-hook-"))
  dirs.push(root)
  mkdirSync(join(root, "bin"))
  writeFileSync(join(root, "bin/decide"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(root, "bin/decide"), 0o755)
  return spawnSync("sh", ["-c", command], {
    input: JSON.stringify({ prompt: "x", cwd: root }),
    env: { PATH: process.env.PATH, CLAUDE_PLUGIN_ROOT: root },
    encoding: "utf8",
  })
}

describe("claude-hooks.json UserPromptSubmit", () => {
  it("is referenced from the Claude manifest only", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../plugins/system1/.claude-plugin/plugin.json"),
        "utf8",
      ),
    )
    expect(manifest.hooks).toBe("./hooks/claude-hooks.json")
  })

  it("passes the hint through when decide succeeds", () => {
    const r = runHook('cat >/dev/null; echo "use the ask skill"')
    expect(r).toMatchObject({ status: 0, stdout: "use the ask skill" })
  })

  it("forwards the event and never lets the shim download", () => {
    const r = runHook('echo "$SYSTEM1_NO_NPX $*"; cat')
    const [args, event] = r.stdout.split("\n")
    expect(args).toBe("1 route --hook --format brief")
    expect(JSON.parse(event ?? "")).toMatchObject({ prompt: "x" })
  })

  it.each([
    [
      "usage error (exit 2 would block the prompt)",
      'echo "decide route: error invalid-request"; exit 2',
    ],
    ["config error", "echo oops >&2; exit 2"],
    ["not installed", "exit 127"],
    ["a crash", "exit 1"],
  ])("%s: exits 0 and prints nothing", (_, script) => {
    const r = runHook(script)
    expect(r).toMatchObject({ status: 0, stdout: "" })
  })
})
