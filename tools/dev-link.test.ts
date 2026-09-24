import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// tools/dev-link.sh against a scratch Claude config dir, with a fake `claude`
// whose `plugin list --json` prints whatever the test hands it.
const SCRIPT = join(import.meta.dirname, "dev-link.sh")
const PLUGIN = realpathSync(join(import.meta.dirname, "../plugins/system1"))
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(plugins: unknown = [], { claude = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "system1-dev-link-"))
  dirs.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  writeFileSync(
    join(root, "plugins.json"),
    typeof plugins === "string" ? plugins : JSON.stringify(plugins),
  )
  // A `claude` that prints the canned list, or, with claude: false, one that
  // doesn't exist (a PATH entry of our own shadows any real one either way).
  const claudeBin = claude
    ? `#!/bin/sh\ncat '${join(root, "plugins.json")}'\n`
    : "#!/bin/sh\nexit 127\n"
  writeFileSync(join(bin, "claude"), claudeBin)
  chmodSync(join(bin, "claude"), 0o755)
  const config = join(root, "claude")
  const link = join(config, "skills/system1")
  const run = (command: string) =>
    spawnSync("sh", [SCRIPT, command], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config },
      encoding: "utf8",
    })
  return { root, link, run }
}

describe("dev-link.sh", () => {
  it("links and unlinks this checkout's plugin", () => {
    const { link, run } = setup([{ id: "system1@skills-dir", enabled: true }])
    const linked = run("link")
    expect(linked.status).toBe(0)
    expect(realpathSync(link)).toBe(PLUGIN)
    expect(linked.stdout).toContain("claude: system1@skills-dir enabled")
    expect(run("link").stdout).toContain("already linked")
    expect(run("unlink").status).toBe(0)
    expect(existsSync(link)).toBe(false)
    expect(run("unlink").stdout).toContain("not linked")
  })

  it("leaves a real directory or another checkout's link alone", () => {
    const { root, link, run } = setup()
    mkdirSync(link, { recursive: true })
    expect(run("link").status).toBe(1)
    expect(run("unlink").status).toBe(1)
    expect(lstatSync(link).isDirectory()).toBe(true)

    rmSync(link, { recursive: true })
    symlinkSync(root, link)
    expect(run("link").status).toBe(1)
    expect(run("unlink").status).toBe(1)
    expect(realpathSync(link)).toBe(realpathSync(root))
    expect(run("status").stdout).toContain("(not this checkout)")
  })

  it("says when an installed plugin shadows the link, and how to remove it", () => {
    const { run } = setup([
      { id: "system1@system1", scope: "user", enabled: false },
      {
        id: "system1@skills-dir",
        enabled: false,
        errors: [
          'Not loaded — the name "system1" is already taken by an installed plugin. Give the plugin a different "name" (in plugin.json) to load this copy.',
        ],
      },
    ])
    const r = run("link")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("claude: system1@system1 disabled")
    expect(r.stdout).toContain(
      'system1@skills-dir not loaded: the name "system1" is already taken by an installed plugin\n',
    )
    // plugin.json is generated: never pass on advice to edit it.
    expect(r.stdout).not.toContain("plugin.json")
    expect(r.stdout).toContain("claude plugin uninstall system1@system1 --scope user")
    expect(r.stdout).toContain("won't load it until")
    expect(r.stdout).not.toContain("Start a new Claude Code session")
  })

  it("gives no uninstall advice while the link is the one loaded", () => {
    const { run } = setup([
      { id: "system1@system1", scope: "project", enabled: false },
      { id: "system1@skills-dir", enabled: true },
    ])
    const out = run("link").stdout
    expect(out).toContain("claude: system1@system1 (project scope) disabled")
    expect(out).not.toContain("uninstall")
    expect(out).toContain("Start a new Claude Code session")
  })

  it.each([
    ["not JSON", "warning: something\n"],
    ["not a list", '{"plugins":[]}'],
    ["odd entries", '[{"enabled":true},{"id":"system1@skills-dir","errors":[{"x":1}]}]'],
  ])("copes with `claude plugin list` output that is %s", (_, output) => {
    const { run } = setup(output)
    const r = run("status")
    expect(r.status).toBe(0)
    expect(r.stderr).toBe("")
  })

  it("still links when claude isn't available", () => {
    const { link, run } = setup([], { claude: false })
    expect(run("link").status).toBe(0)
    expect(realpathSync(link)).toBe(PLUGIN)
  })

  it("treats a dangling link as someone else's", () => {
    const { root, link, run } = setup()
    mkdirSync(join(root, "claude/skills"), { recursive: true })
    symlinkSync(join(root, "gone"), link)
    expect(run("link").status).toBe(1)
    expect(run("unlink").status).toBe(1)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it("rejects anything but link, unlink or status", () => {
    const { run } = setup()
    expect(run("").status).toBe(2)
    expect(run("remove").status).toBe(2)
  })
})
