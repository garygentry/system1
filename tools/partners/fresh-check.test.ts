import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

// tools/partners/fresh-check.sh, offline, against this checkout's bundle. The
// partner-facing promise is that it reports a key's presence and nothing else,
// and never grants consent.
const SCRIPT = join(import.meta.dirname, "fresh-check.sh")
const BUNDLE = join(import.meta.dirname, "../../packages/cli/dist/bundle/decide.mjs")
const SECRET = "sk-or-v1-fresh-check-test-0123456789abcdef"
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "system1-fresh-test-"))
  dirs.push(root)
  // A user profile with a key in both places the check looks.
  const xdg = join(root, "xdg")
  mkdirSync(join(xdg, "system1"), { recursive: true })
  writeFileSync(join(xdg, "system1/credentials"), `openrouter_api_key: ${SECRET}\n`, {
    mode: 0o600,
  })
  const r = spawnSync("sh", [SCRIPT, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: xdg, OPENROUTER_API_KEY: SECRET, TMPDIR: root, ...env },
    encoding: "utf8",
    timeout: 60_000,
  })
  return { ...r, root, out: `${r.stdout}${r.stderr}` }
}

describe("fresh-check.sh", () => {
  it("passes on a clean profile, offline, without using or printing the key", () => {
    const r = run(["--decide", BUNDLE, "--offline"])
    expect(r.out).toContain("fresh-check: PASS")
    expect(r.status).toBe(0)
    expect(r.out).toContain("present (environment), and a credentials file")
    expect(r.out).toMatch(
      /fresh-check\[doctor\]: PASS — decide doctor: .* · replay only · harness none/,
    )
    expect(r.out).toContain("fresh-check[replay]: PASS — decide many: 1 kept of 3")
    expect(r.out).toContain("fresh-check[untouched]: PASS")
    expect(r.out).toContain("warn key: no API key")
    expect(r.out).not.toContain(SECRET)
    expect(r.out).not.toContain("fresh-check-test")
  }, 60_000)

  it("fails, and keeps the work dir, when decide doesn't work", () => {
    const fake = join(mkdtempSync(join(tmpdir(), "system1-fresh-fake-")), "decide")
    dirs.push(join(fake, ".."))
    writeFileSync(fake, "#!/bin/sh\nexit 1\n")
    chmodSync(fake, 0o755)
    const r = run(["--decide", fake, "--offline"])
    expect(r.status).toBe(1)
    expect(r.out).toContain("fresh-check[doctor]: FAIL — no JSON from doctor")
    expect(r.out).toContain("fresh-check[replay]: FAIL")
    expect(r.out).toMatch(/work dir kept at .*system1-fresh\./)
  }, 60_000)

  it("refuses --offline without --decide, since npm would need the network", () => {
    const r = run(["--offline"])
    expect(r.status).toBe(2)
    expect(r.out).toContain("--offline needs --decide")
  })

  it("never grants consent or writes a key", () => {
    const code = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n")
    expect(code).not.toMatch(/egress\s+allow/)
    expect(code).not.toContain("--confirm")
    expect(code).not.toContain("openrouter_api_key:")
    // The key's presence is tested with -f; the file is never read or written.
    expect(code).not.toMatch(/(cat|read|head|grep|>)[^\n]*\$CREDS/)
  })
})
