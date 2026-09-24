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

function setup(plugins: object[] = []) {
  const root = mkdtempSync(join(tmpdir(), "system1-dev-link-"))
  dirs.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  writeFileSync(join(root, "plugins.json"), JSON.stringify(plugins))
  writeFileSync(join(bin, "claude"), `#!/bin/sh\ncat '${join(root, "plugins.json")}'\n`)
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

  it("says when a marketplace install shadows the link", () => {
    const { run } = setup([
      { id: "system1@system1", enabled: false },
      {
        id: "system1@skills-dir",
        enabled: false,
        errors: ['Not loaded — the name "system1" is already taken'],
      },
    ])
    const out = run("link").stdout
    expect(out).toContain("claude: system1@system1 disabled")
    expect(out).toContain('system1@skills-dir not loaded: the name "system1" is already taken')
    expect(out).toContain("claude plugin uninstall system1@system1")
  })

  it("rejects anything but link, unlink or status", () => {
    const { run } = setup()
    expect(run("").status).toBe(2)
    expect(run("remove").status).toBe(2)
  })
})
