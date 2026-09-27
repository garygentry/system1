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

// The guard hooks (M10): Claude and Codex run `decide hook` at SessionStart and
// Stop. Whatever decide does, the harness gets one JSON object and exit 0.
const pluginDir = join(import.meta.dirname, "../plugins/system1")
const read = (path: string) => JSON.parse(readFileSync(join(pluginDir, path), "utf8"))
const guard = [
  { harness: "claude", file: "hooks/claude-hooks.json", root: "CLAUDE_PLUGIN_ROOT" },
  { harness: "codex", file: "hooks/codex-hooks.json", root: "PLUGIN_ROOT" },
] as const

function runGuard(commandText: string, root: string, script: string) {
  const dir = mkdtempSync(join(tmpdir(), "system1-guard-"))
  dirs.push(dir)
  mkdirSync(join(dir, "bin"))
  writeFileSync(join(dir, "bin/decide"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(dir, "bin/decide"), 0o755)
  const r = spawnSync("sh", ["-c", commandText], {
    input: JSON.stringify({ hook_event_name: "Stop", session_id: "s", cwd: dir }),
    env: { PATH: process.env.PATH, [root]: dir },
    encoding: "utf8",
  })
  return { ...r, dir }
}

describe.each(guard)("$file guard hooks", ({ harness, file, root }) => {
  const hooksFile = read(file)
  const commands = ["SessionStart", "Stop"].map((e) => hooksFile.hooks[e][0].hooks[0])

  it("runs decide hook done-check at SessionStart and Stop, Stop outlasting latencyMs", () => {
    expect(commands.map((c) => c.timeout)).toEqual([10, 60])
    for (const c of commands) expect(c.command).toContain(`hook done-check --harness ${harness}`)
  })

  it("forwards the event and never lets the shim download", () => {
    const r = runGuard(
      commands[1].command,
      root,
      'cat > "$(dirname "$0")/event.json"; printf \'{"systemMessage":"%s %s"}\' "$SYSTEM1_NO_NPX" "$*"',
    )
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      systemMessage: `1 hook done-check --harness ${harness}`,
    })
    expect(JSON.parse(readFileSync(join(r.dir, "bin/event.json"), "utf8"))).toMatchObject({
      hook_event_name: "Stop",
      session_id: "s",
    })
  })

  it("passes a block through", () => {
    const r = runGuard(
      commands[1].command,
      root,
      'cat >/dev/null; printf \'{"decision":"block","reason":"r"}\'',
    )
    expect(r).toMatchObject({ status: 0, stdout: '{"decision":"block","reason":"r"}' })
  })

  it.each([
    ["not installed", "exit 127"],
    ["a crash with no output", "exit 1"],
    ["exit 2 (a blocking error to Claude)", "exit 2"],
    [
      "a CLI too old to know `hook` (an error envelope, exit 2)",
      'printf \'{"v":1,"ok":false,"command":"hook","error":{"code":"invalid-request"}}\'; exit 2',
    ],
  ])("%s: prints {} and exits 0", (_, script) => {
    expect(runGuard(commands[1].command, root, script)).toMatchObject({ status: 0, stdout: "{}" })
  })
})

describe("the Codex manifest", () => {
  it("names the Codex hooks, which carry no routing hint (0018)", () => {
    expect(read(".codex-plugin/plugin.json").hooks).toBe("./hooks/codex-hooks.json")
    expect(Object.keys(read("hooks/codex-hooks.json").hooks)).toEqual(["SessionStart", "Stop"])
  })
})
