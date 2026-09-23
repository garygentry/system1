import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs } from "../testkit/tmp.js"
import { VERSION } from "../version.js"
import { CODEX_RULE, type DoctorResult, runDoctor, which } from "./doctor.js"

const temp = useTempDirs()
const SECRET = "sk-or-TESTSECRET-doctor"
const CONSENT = { ".system1/config.yaml": "egress:\n  consent: { granted: true }\n" }
const reachable = (async () =>
  Response.json({ data: { endpoints: [{ context_length: 32000 }] } })) as typeof fetch
const noDns = (async () => {
  throw new TypeError("fetch failed", { cause: new Error("getaddrinfo EAI_AGAIN openrouter.ai") })
}) as typeof fetch
const status404 = (async () => new Response("", { status: 404 })) as typeof fetch
const status503 = (async () => new Response("", { status: 503 })) as typeof fetch

function binDir(): string {
  const dir = temp({ decide: "#!/bin/sh\n" })
  chmodSync(join(dir, "decide"), 0o755)
  return dir
}

function doctor(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, repoFiles = {}) {
  const cwd = temp({ ".git/HEAD": "ref: refs/heads/main\n", ...repoFiles })
  return runDoctor({ cwd, home: temp(), env, fetch: fetchImpl })
}

const status = (r: DoctorResult) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]))
const check = (r: DoctorResult, name: string) => r.checks.find((c) => c.name === name)

describe("doctor", () => {
  it("is healthy and live with the CLI on PATH, a key, consent and network", async () => {
    const env = { PATH: binDir(), OPENROUTER_API_KEY: SECRET, CLAUDE_CODE_SESSION_ID: "s1" }
    const r = await doctor(env, reachable, CONSENT)
    expect(r).toMatchObject({ healthy: true, live: true, harness: "claude", session: "claude:s1" })
    expect(status(r)).toEqual({ cli: "ok", path: "ok", key: "ok", consent: "ok", network: "ok" })
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })

  it("is healthy but not live without a key or consent, and not live in forced replay", async () => {
    const noKey = await doctor({ PATH: binDir() }, reachable, CONSENT)
    expect(noKey).toMatchObject({ healthy: true, live: false })
    const noConsent = await doctor({ OPENROUTER_API_KEY: SECRET }, reachable)
    expect(noConsent).toMatchObject({ healthy: true, live: false })
    const replay = await doctor(
      { OPENROUTER_API_KEY: SECRET, SYSTEM1_REPLAY: "1" },
      reachable,
      CONSENT,
    )
    expect(replay.live).toBe(false)
  })

  it("points the key fix at the credentials file this shell would read", async () => {
    const r = await doctor({ PATH: binDir(), XDG_CONFIG_HOME: "/xdg" }, reachable, CONSENT)
    expect(r.checks.find((c) => c.name === "key")?.fix).toContain("/xdg/system1/credentials")
  })

  it("gives a sandboxed Codex shell the exact rule", async () => {
    const env = {
      PATH: "",
      CODEX_THREAD_ID: "t1",
      CODEX_SANDBOX_NETWORK_DISABLED: "1",
      CODEX_HOME: "/home/u/.codex",
    }
    const r = await doctor(env, noDns)
    expect(r).toMatchObject({ healthy: false, live: false })
    expect(status(r)).toMatchObject({ path: "warn", key: "warn", consent: "warn", network: "fail" })
    expect(check(r, "network")?.detail).toMatch(/EAI_AGAIN.*Codex sandbox/)
    expect(check(r, "network")?.fix).toContain(CODEX_RULE)
    expect(check(r, "network")?.fix).toContain("/home/u/.codex/rules/system1.rules")
    expect(check(r, "path")?.fix).toMatch(/^npm i -g @garygentry\/system1@\d+\.\d+\.\d+$/)
  })

  it("trusts the sandbox flag over nesting, and gives the rule only when sandboxed", async () => {
    const codexInPi = await doctor(
      {
        AI_AGENT: "pi",
        PI_SESSION_ID: "p1",
        CODEX_THREAD_ID: "t1",
        CODEX_SANDBOX_NETWORK_DISABLED: "1",
      },
      noDns,
    )
    expect(check(codexInPi, "network")?.fix).toContain(CODEX_RULE)
    const unsandboxed = await doctor({ CODEX_THREAD_ID: "t1" }, noDns)
    expect(check(unsandboxed, "network")?.fix).toMatch(/proxy, firewall, DNS/)
  })

  it("blames the request, not the network, when the endpoint answers with an error", async () => {
    const missing = await doctor({ CLAUDECODE: "1", SYSTEM1_MODEL: "bad/model" }, status404)
    expect(check(missing, "network")?.fix).toMatch(/does not know this model/)
    const down = await doctor({ CLAUDECODE: "1" }, status503)
    expect(check(down, "network")?.fix).toMatch(/HTTP 503: retry later/)
  })

  it("names each harness's network fix, and only warns in replay", async () => {
    const replay = await doctor({ SYSTEM1_REPLAY: "1", AI_AGENT: "pi" }, noDns)
    expect(replay).toMatchObject({ healthy: true, harness: "pi" })
    expect(status(replay).network).toBe("warn")
    const claude = await doctor({ CLAUDECODE: "1" }, noDns)
    expect(check(claude, "network")?.fix).toMatch(/Claude Code's sandbox/)
    expect(check(claude, "path")?.fix).toMatch(/--plugin-dir/)
    const bare = await doctor({}, noDns)
    expect(bare.harness).toBeNull()
    expect(check(bare, "network")?.fix).toMatch(/proxy, firewall, DNS/)
  })

  it("reports a broken config as a failed check instead of throwing", async () => {
    const badUrl = await doctor({ SYSTEM1_ENDPOINT: "notaurl" }, reachable)
    expect(badUrl).toMatchObject({ healthy: false, live: false })
    expect(check(badUrl, "config")).toMatchObject({ status: "fail" })
    const badYaml = await doctor({}, reachable, { ".system1/config.yaml": "egress: [unclosed\n" })
    expect(badYaml.healthy).toBe(false)
    expect(check(badYaml, "config")?.detail).toBeTruthy()
  })
})

describe("which", () => {
  it("finds the first executable file and skips empty, missing and directory entries", () => {
    const dir = binDir()
    const shadow = temp()
    mkdirSync(join(shadow, "decide"))
    expect(which("decide", ["", "/nonexistent", shadow, dir].join(":"))).toBe(join(dir, "decide"))
    expect(which("decide", temp({ decide: "not executable" }))).toBeUndefined()
  })

  it("compares the version of the decide on PATH, when given a probe", async () => {
    const PATH = binDir()
    const run = (probe: (p: string) => Promise<string | undefined>) =>
      runDoctor({ cwd: temp(), home: temp(), env: { PATH }, fetch: reachable, probeVersion: probe })
    const same = await run(async () => VERSION)
    expect(check(same, "path-version")).toMatchObject({ status: "ok" })
    const other = await run(async () => "9.9.9\n")
    expect(check(other, "path-version")).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("decide on PATH is 9.9.9"),
    })
    const broken = await run(async () => {
      throw new Error("ENOENT")
    })
    expect(check(broken, "path-version")).toMatchObject({ status: "warn" })
    const silent = await run(async () => "")
    expect(check(silent, "path-version")).toMatchObject({ status: "warn" })
    const codex = await runDoctor({
      cwd: temp(),
      home: temp(),
      env: { PATH, CODEX_SANDBOX_NETWORK_DISABLED: "1" },
      fetch: reachable,
      probeVersion: async () => "",
    })
    expect(check(codex, "path-version")).toMatchObject({
      status: "ok",
      detail: expect.stringContaining("Codex sandbox"),
    })
    expect(broken.healthy).toBe(true)
    // No probe, or nothing on PATH: no check.
    expect(check(await doctor({ PATH }, reachable), "path-version")).toBeUndefined()
    const none = await runDoctor({
      cwd: temp(),
      home: temp(),
      env: { PATH: "" },
      fetch: reachable,
      probeVersion: async () => "x",
    })
    expect(check(none, "path-version")).toBeUndefined()
  })
})
