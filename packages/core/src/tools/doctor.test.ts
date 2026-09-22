import { chmodSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs } from "../testkit/tmp.js"
import { createContext } from "./context.js"
import { CODEX_RULE, runDoctor, which } from "./doctor.js"

const temp = useTempDirs()
const reachable = (async () =>
  Response.json({ data: { endpoints: [{ context_length: 32000 }] } })) as typeof fetch
const noDns = (async () => {
  throw new TypeError("fetch failed", { cause: new Error("getaddrinfo EAI_AGAIN openrouter.ai") })
}) as typeof fetch

function binDir(): string {
  const dir = temp({ decide: "#!/bin/sh\n" })
  chmodSync(join(dir, "decide"), 0o755)
  return dir
}

function doctor(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, repoFiles = {}) {
  const cwd = temp({ ".git/HEAD": "ref: refs/heads/main\n", ...repoFiles })
  const ctx = createContext({ cwd, home: temp(), env, fetch: fetchImpl })
  return runDoctor(ctx, { env })
}

const status = (r: Awaited<ReturnType<typeof runDoctor>>) =>
  Object.fromEntries(r.checks.map((c) => [c.name, c.status]))

describe("doctor", () => {
  it("is all ok with the CLI on PATH, a key, consent and network", async () => {
    const env = { PATH: binDir(), OPENROUTER_API_KEY: "sk-x", CLAUDE_CODE_SESSION_ID: "s1" }
    const r = await doctor(env, reachable, {
      ".decisions/config.yaml": "egress:\n  consent: { granted: true }\n",
    })
    expect(r).toMatchObject({ healthy: true, harness: "claude", session: "claude:s1" })
    expect(status(r)).toEqual({ cli: "ok", path: "ok", key: "ok", consent: "ok", network: "ok" })
    expect(JSON.stringify(r)).not.toContain("sk-x")
  })

  it("gives Codex the exact rule when the sandbox blocks the network", async () => {
    const env = {
      PATH: "",
      CODEX_THREAD_ID: "t1",
      CODEX_SANDBOX_NETWORK_DISABLED: "1",
      CODEX_HOME: "/home/u/.codex",
    }
    const r = await doctor(env, noDns)
    expect(r.healthy).toBe(false)
    expect(status(r)).toMatchObject({ path: "warn", key: "warn", consent: "warn", network: "fail" })
    const net = r.checks.find((c) => c.name === "network")
    expect(net?.detail).toMatch(/EAI_AGAIN.*Codex sandbox/)
    expect(net?.fix).toContain(CODEX_RULE)
    expect(net?.fix).toContain("/home/u/.codex/rules/decisions.rules")
    expect(r.checks.find((c) => c.name === "path")?.fix).toMatch(
      /^npm i -g @garygentry\/decisions@/,
    )
  })

  it("only warns about the network in replay, and names each harness's fix", async () => {
    const replay = await doctor({ DECISIONS_REPLAY: "1", AI_AGENT: "pi" }, noDns)
    expect(replay).toMatchObject({ healthy: true, harness: "pi" })
    expect(status(replay).network).toBe("warn")
    const claude = await doctor({ CLAUDECODE: "1" }, noDns)
    expect(claude.checks.find((c) => c.name === "network")?.fix).toMatch(/Claude Code's sandbox/)
    const bare = await doctor({}, noDns)
    expect(bare.harness).toBeNull()
    expect(bare.checks.find((c) => c.name === "network")?.fix).toMatch(/proxy, firewall, DNS/)
  })
})

describe("which", () => {
  it("finds the first executable and skips empty and missing entries", () => {
    const dir = binDir()
    expect(which("decide", ["", "/nonexistent", dir].join(":"))).toBe(join(dir, "decide"))
    expect(which("decide", temp({ decide: "not executable" }))).toBeUndefined()
  })
})
