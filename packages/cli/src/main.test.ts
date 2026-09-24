import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { probeVersion } from "./commands/doctor.js"
import { main } from "./main.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const SECRET = "sk-or-TESTSECRET-cli"

/** A temp repo plus a fake endpoint: "auth" → 0.95, "maybe" → 0.5, else 0.05. */
function rig(
  files: Record<string, string> = {},
  { consent = true, key = true, stdin = "", interactive = false } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "decide-cli-"))
  const home = mkdtempSync(join(tmpdir(), "decide-home-"))
  dirs.push(cwd, home)
  mkdirSync(join(cwd, ".system1"), { recursive: true })
  if (consent)
    writeFileSync(join(cwd, ".system1/config.yaml"), "egress:\n  consent: { granted: true }\n")
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(cwd, p, ".."), { recursive: true })
    writeFileSync(join(cwd, p), c)
  }
  const out: string[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    // `ping` / `doctor` probe the public model listing with a GET.
    if (!init?.body) return Response.json({ data: { endpoints: [{ context_length: 32000 }] } })
    const body = JSON.parse(String(init.body)) as {
      state: string
      questions: Record<string, unknown>
    }
    const noul = body.state.includes("auth") ? 0.95 : body.state.includes("maybe") ? 0.5 : 0.05
    return Response.json({
      model: "typesafe/jev-1.13-20260917",
      answers: Object.fromEntries(
        Object.keys(body.questions).map((q) => [q, { type: "noul", noul }]),
      ),
      usage: { input_tokens: 50, output_tokens: 5, cost: 0.000002 },
    })
  }) as unknown as typeof fetch
  const io = {
    out: (t: string) => out.push(t),
    err: () => {},
    env: key ? { OPENROUTER_API_KEY: SECRET } : {},
    cwd,
    home,
    fetch: fetchImpl,
    readStdin: () => stdin,
    interactive,
  }
  return { cwd, io, out, json: () => JSON.parse(out.at(-1) ?? "null") }
}

const Q = "relevant:noul:The file handles authentication"

describe("decide (general)", () => {
  it("prints help with no command", async () => {
    const { io, out } = rig()
    expect(await main([], io)).toBe(0)
    expect(out.join("")).toContain("Usage: decide")
  })

  it("rejects unknown commands as invalid-request, exit 2", async () => {
    const { io, json } = rig()
    expect(await main(["frobnicate"], io)).toBe(2)
    expect(json()).toMatchObject({ v: 1, ok: false, error: { code: "invalid-request" } })
  })

  it("rejects an unknown format in the default envelope", async () => {
    const { io, json } = rig()
    expect(await main(["many", "--format", "xml"], io)).toBe(2)
    expect(json().error.message).toMatch(/--format/)
  })

  it("prints the bare version, or an envelope with --format json", async () => {
    const plain = rig()
    expect(await main(["version"], plain.io)).toBe(0)
    expect(plain.out[0]).toMatch(/^\d+\.\d+\.\d+/)
    const env = rig()
    await main(["version", "--format", "json"], env.io)
    expect(env.json()).toMatchObject({ ok: true, result: { version: expect.any(String) } })
  })

  it("prints each tool's input schema", async () => {
    const { io, json } = rig()
    expect(await main(["schema", "many"], io)).toBe(0)
    expect(json().result).toMatchObject({ type: "object", properties: { keep: { type: "array" } } })
  })
})

describe("decide many", () => {
  const files = {
    "src/auth.ts": "auth code",
    "src/maybe.ts": "maybe",
    "src/util.ts": "util",
    ".env": "X=1",
  }

  it("filters in the engine and returns a v1 envelope", async () => {
    const { io, json } = rig(files)
    expect(
      await main(["many", "--glob", "**/*", "--question", Q, "--keep", "relevant>=0.7"], io),
    ).toBe(0)
    const r = json()
    expect(r).toMatchObject({ v: 1, ok: true, command: "many" })
    expect(r.result.kept.map((k: { id: string }) => k.id)).toEqual(["src/auth.ts"])
    expect(r.result.counts).toMatchObject({
      items: 3,
      kept: 1,
      undecided: 1,
      dropped: 1,
      skipped: 1,
    })
  })

  it("brief: one line per result, undecided listed apart, withheld summarised", async () => {
    const { io, out } = rig(files)
    await main(
      ["many", "--glob", "**/*", "--question", Q, "--keep", "relevant>=0.7", "--format", "brief"],
      io,
    )
    const text = out.join("\n")
    expect(text).toMatch(
      /^decide many: 1 kept of 3 · 1 undecided · 1 dropped · live typesafe\/jev-1.13 · \$0\.000006 measured/,
    )
    expect(text).toContain("  src/auth.ts  relevant=0.95")
    expect(text).toContain(
      "undecided (too flat to judge; read these yourself):\n  src/maybe.ts  relevant=0.50 UNDECIDED",
    )
    expect(text).toContain("withheld: 1 (excluded 1) e.g. .env")
  })

  it("jsonl: tagged result lines and a closing summary", async () => {
    const { io, out } = rig(files)
    await main(
      ["many", "--glob", "src/*", "--question", Q, "--keep", "relevant>=0.7", "--format", "jsonl"],
      io,
    )
    const lines = out
      .join("\n")
      .split("\n")
      .map((l) => JSON.parse(l))
    expect(lines.map((l) => l.status)).toEqual(["kept", "undecided", "summary"])
    expect(lines.at(-1)).toMatchObject({ v: 1, counts: { items: 3 } })
  })

  it("reads piped content with --stdin and splits it", async () => {
    const { io, json } = rig({}, { stdin: "line about auth\nplain line\n\nmaybe line" })
    expect(
      await main(
        ["many", "--stdin", "--split", "row", "--question", Q, "--keep", "relevant>=0.7"],
        io,
      ),
    ).toBe(0)
    expect(json().result.kept.map((k: { id: string }) => k.id)).toEqual(["stdin:1"])
    // Piped rows have no file to point at, so each carries its text.
    expect(json().result.kept[0].excerpt).toBe("line about auth")
    expect(json().result.undecided[0].excerpt).toBe("maybe line")
  })

  it("brief shows a piped row's text; file rows carry no excerpt", async () => {
    const piped = rig({}, { stdin: "line about auth\nplain line" })
    await main(
      [
        "many",
        "--stdin",
        "--split",
        "row",
        "--question",
        Q,
        "--keep",
        "relevant>=0.7",
        "--format",
        "brief",
      ],
      piped.io,
    )
    expect(piped.out.at(-1)).toContain('stdin:1  relevant=0.95  "line about auth"')
    const files = rig({ "src/auth.ts": "auth code" })
    await main(["many", "--glob", "src/*", "--question", Q], files.io)
    expect(files.json().result.kept[0]).not.toHaveProperty("excerpt")
    const rows = rig({ "hits.txt": "src/a.ts:3: auth check\nsrc/b.ts:9: plain" })
    await main(["many", "--file", "hits.txt", "--split", "row", "--question", Q], rows.io)
    expect(rows.json().result.kept[0]).toMatchObject({
      id: "hits.txt:1",
      excerpt: "src/a.ts:3: auth check",
    })
  })

  it.each([
    [{ consent: false }, ["many", "--glob", "src/*", "--question", Q], 3, "egress-refused"],
    [{ key: false }, ["many", "--glob", "src/*", "--question", Q], 6, "replay-miss"],
    [{ key: false }, ["many", "--glob", "src/*", "--question", Q, "--live"], 2, "no-key"],
    [{}, ["many", "--glob", "src/*", "--question", "bad"], 2, "invalid-request"],
    [
      {},
      ["many", "--glob", "src/*", "--question", Q, "--record", "--replay"],
      2,
      "invalid-request",
    ],
  ])("exit codes: %j %j → %i (%s)", async (opts, argv, code, errorCode) => {
    const { io, json } = rig(files, opts)
    expect(await main(argv, io)).toBe(code)
    expect(json().error.code).toBe(errorCode)
  })

  it("budget guard: exit 4 with the projection in details", async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.txt`, "x"]))
    const { cwd, io, json } = rig(many)
    writeFileSync(
      join(cwd, ".system1/config.yaml"),
      "egress:\n  consent: { granted: true }\nbudget: { maxCalls: 2 }\n",
    )
    expect(await main(["many", "--glob", "*.txt", "--question", Q], io)).toBe(4)
    expect(json().error.details.projection).toMatchObject({ basis: "projected", calls: 5 })
    expect(await main(["many", "--glob", "*.txt", "--question", Q, "--confirm"], io)).toBe(0)
  })

  it("--exclude leaves paths out, reported as filtered, and re-anchored like --glob", async () => {
    const { io, json, out } = rig({
      "src/auth.ts": "auth",
      "src/auth.test.ts": "auth test",
      "src/fixtures/f.ts": "auth fixture",
    })
    const { cwd } = io
    const sub = { ...io, cwd: join(cwd, "src") }
    expect(
      await main(
        [
          "many",
          "--glob",
          "**/*.ts",
          "--question",
          Q,
          "--exclude",
          "**/*.test.ts",
          "--exclude",
          "fixtures/**",
          "--dry-run",
        ],
        sub,
      ),
    ).toBe(0)
    const r = json().result
    expect(r.counts.items).toBe(1)
    expect(r.skipped.byReason).toEqual({ filtered: 2 })
    expect(
      await main(
        [
          "many",
          "--glob",
          "**/*.ts",
          "--question",
          Q,
          "--exclude",
          "**/*.test.ts",
          "--dry-run",
          "--format",
          "brief",
        ],
        sub,
      ),
    ).toBe(0)
    expect(out.at(-1)).toContain("left out by --exclude: 1")
    expect(out.at(-1)).not.toContain("withheld")
  })

  it("--exclude refuses negation and a path outside the repo, and takes an absolute one inside", async () => {
    const { io, json } = rig({ "src/a.ts": "a", "src/b.ts": "b" })
    const run = (pattern: string) =>
      main(["many", "--glob", "src/*", "--question", Q, "--exclude", pattern, "--dry-run"], io)
    expect(await run("!src/a.ts")).toBe(2)
    expect(json().error.message).toMatch(/negation/)
    expect(await run("/etc/*")).toBe(2)
    expect(json().error.message).toMatch(/outside the repo/)
    expect(await run(join(io.cwd, "src/a.ts"))).toBe(0)
    expect(json().result.counts.items).toBe(1)
  })

  it("dry run: no calls, no consent needed", async () => {
    const { io, out } = rig(files, { consent: false })
    expect(
      await main(
        ["many", "--glob", "src/*", "--question", Q, "--dry-run", "--format", "brief"],
        io,
      ),
    ).toBe(0)
    expect(out.join("")).toMatch(/would send 3 item\(s\).*projected \$/)
  })
})

describe("decide ask", () => {
  it("answers one file and reports a verdict", async () => {
    const { io, out } = rig({ "a.ts": "auth" })
    expect(
      await main(
        ["ask", "--file", "a.ts", "--question", Q, "--keep", "relevant>=0.7", "--format", "brief"],
        io,
      ),
    ).toBe(0)
    expect(out.join("\n")).toMatch(
      /^decide ask: a\.ts · live typesafe\/jev-1\.13-20260917 · \d+ ms/,
    )
    expect(out.join("\n")).toContain("verdict: kept")
  })

  it("rejects flags that only apply to many", async () => {
    const { io, json } = rig({ "src/auth.ts": "auth code" })
    for (const flag of ["--dry-run", "--confirm"]) {
      expect(await main(["ask", "--file", "src/auth.ts", "--question", Q, flag], io)).toBe(2)
      expect(json().error.message).toMatch(/applies to `decide many`/)
    }
    expect(await main(["ask", "--file", "src/auth.ts", "--question", Q, "--limit", "1"], io)).toBe(
      2,
    )
    expect(json().error.message).toMatch(/--limit applies/)
  })

  it("rejects a stray positional, suggesting --text", async () => {
    const { io, json } = rig()
    expect(await main(["ask", "hello", "--question", Q], io)).toBe(2)
    expect(json().error.message).toContain('--text "hello"')
  })
})

describe("decide config egress", () => {
  it("refuses a non-interactive allow without --confirm: consent is the user's", async () => {
    const { io, json } = rig({}, { consent: false })
    expect(await main(["config", "egress", "allow"], io)).toBe(3)
    expect(json().error.message).toMatch(/user's decision/)
  })

  it("tells the agent not to grant it, and the user how to without a terminal", async () => {
    const { io, json } = rig({}, { consent: false })
    await main(["config", "egress", "allow"], io)
    const message: string = json().error.message
    expect(message).toMatch(/An agent must not grant it, with or without --confirm/)
    expect(message).toMatch(/shell escape instead \(not as a chat message\)/)
    // `!` prompts have no TTY, so the user needs --confirm there. But agents read
    // this, and in a shell `! cmd` runs cmd, so the envelope never carries that form.
    expect(message).toContain("--confirm")
    expect(message).not.toContain("! decide")
  })

  it("grants on --confirm without a terminal, and records that route", async () => {
    const { cwd, io } = rig({}, { consent: false })
    expect(await main(["config", "egress", "allow", "--confirm"], io)).toBe(0)
    const written = readFileSync(join(cwd, ".system1/config.yaml"), "utf8")
    expect(written).toContain("granted: true")
    expect(written).toContain("by: decide config --confirm")
  })

  it("grants when a human is at the terminal, and reports status", async () => {
    const { cwd, io, out } = rig({}, { consent: false, interactive: true })
    expect(await main(["config", "egress", "allow"], io)).toBe(0)
    const written = readFileSync(join(cwd, ".system1/config.yaml"), "utf8")
    expect(written).toContain("granted: true")
    expect(written).toContain("by: decide config\n")
    await main(["config", "egress", "status", "--format", "brief"], io)
    expect(out.at(-1)).toMatch(/^egress consent: granted/)
  })

  it("config show never prints the key", async () => {
    const { io, out } = rig()
    await main(["config"], io)
    expect(out.join("")).not.toContain(SECRET)
    expect(JSON.parse(out[0] ?? "").result.apiKey).toBe("present (env)")
  })

  it("config show includes the timeout, config profiles, routing and ignored keys", async () => {
    const { io, json, out } = rig({
      ".system1/config.yaml": [
        "egress: { consent: { granted: true } }",
        "timeoutMs: 9000",
        "concurency: 2",
        "profiles:",
        "  - { id: acme/judge-1, maxStateTokens: 8000, usdPerInputToken: 0.0000001, undecidedFloor: 0.2 }",
        "route: { triggers: [{ name: deploy, pattern: 'is it safe to deploy' }] }",
      ].join("\n"),
    })
    expect(await main(["config"], io)).toBe(0)
    const r = json().result
    expect(r.timeoutMs).toBe(9000)
    expect(r.profiles.map((p: { id: string }) => p.id)).toEqual(["acme/judge-1"])
    expect(r.route.triggers).toEqual([{ name: "deploy", pattern: "is it safe to deploy" }])
    expect(r.warnings).toEqual([expect.stringMatching(/unknown key concurency$/)])

    expect(await main(["config", "--format", "brief"], io)).toBe(0)
    const brief = out.at(-1) ?? ""
    expect(brief).toContain("timeout 9000 ms")
    expect(brief).toContain("profiles: acme/judge-1")
    expect(brief).toMatch(/route: on · .*deploy/)
    expect(brief).toMatch(/ignored: .*unknown key concurency/)
  })

  it("config show never prints an unknown profile field, and --format brief survives a bad route", async () => {
    const { io, out } = rig({
      ".system1/config.yaml": [
        "egress: { consent: { granted: true } }",
        "profiles:",
        "  - { id: typesafe/jev-1.13, maxStateTokens: 8000, usdPerInputToken: 0, undecidedFloor: 0.2, apiKey: sk-profile-secret }",
        "route: { disable: [nope] }",
      ].join("\n"),
    })
    expect(await main(["config"], io)).toBe(0)
    expect(out.join("")).not.toContain("sk-profile-secret")
    expect(JSON.parse(out.at(-1) ?? "").result.profiles).toHaveLength(1)
    expect(await main(["config", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/^route: invalid \(.*nope/m)
    expect(out.at(-1)).toMatch(/^profiles: typesafe\/jev-1\.13$/m)
  })
})

describe("decide spec", () => {
  it("lists, shows and validates repo specs", async () => {
    const spec =
      "description: Auth.\nquestions:\n  relevant: { type: noul, instructions: Handles auth. }\n"
    const { io, json } = rig({
      ".system1/specs/auth.yaml": spec,
      ".system1/specs/broken.yaml": "questions: {}\n",
    })
    await main(["spec", "list"], io)
    expect(json().result.specs.map((s: { name: string }) => s.name)).toEqual(["auth", "broken"])
    expect(await main(["spec", "show", "auth"], io)).toBe(0)
    expect(json().result.questions.relevant.type).toBe("noul")
    expect(await main(["spec", "validate"], io)).toBe(2)
    expect(json().error.details.invalid[0].name).toBe("broken")
  })
})

describe("decide --questions", () => {
  const QS = `relevant:
  type: noul
  instructions: The file handles authentication.
  criteria:
    true: It checks credentials or sessions.
    false: It does not.
`
  const files = { "src/auth.ts": "auth code", "src/util.ts": "util", "q.yaml": QS }

  it("reads a question set from a file", async () => {
    const { io, json } = rig(files)
    expect(
      await main(
        ["many", "--glob", "src/*", "--questions", "q.yaml", "--keep", "relevant>=0.7"],
        io,
      ),
    ).toBe(0)
    expect(json().result.kept.map((k: { id: string }) => k.id)).toEqual(["src/auth.ts"])
  })

  it("reads a question set from stdin (a heredoc)", async () => {
    const { io, json } = rig(files, { stdin: QS })
    expect(await main(["ask", "--file", "src/auth.ts", "--questions", "-"], io)).toBe(0)
    expect(json().result.answers.relevant.noul).toBe(0.95)
  })

  it("takes the set inline, leaving stdin for the content", async () => {
    const { io, json } = rig(files, { stdin: "auth token check" })
    expect(await main(["ask", "--stdin", "--questions", QS], io)).toBe(0)
    expect(json().result.answers.relevant.noul).toBe(0.95)
    const one = '{"relevant":{"type":"noul","instructions":"Handles auth."}}'
    expect(await main(["ask", "--stdin", "--questions", one], io)).toBe(0)
  })

  it("rejects mixing question sources, and two readers of stdin", async () => {
    const { io, json } = rig(files)
    const cases: Array<[string[], RegExp]> = [
      [["--questions", "q.yaml", "--spec", "x"], /--questions and --spec/],
      [["--questions", "q.yaml", "--question", Q], /--questions and --question/],
      [["--questions", "-", "--stdin"], /both want stdin/],
    ]
    for (const [flags, message] of cases) {
      expect(await main(["many", "--glob", "src/*", ...flags], io)).toBe(2)
      expect(json().error.message).toMatch(message)
    }
  })

  it("reports an unreadable file or an invalid set as a usage error", async () => {
    const { io, json } = rig({ ...files, "bad.yaml": "relevant: { type: noul }\n" })
    expect(await main(["many", "--glob", "src/*", "--questions", "nope.yaml"], io)).toBe(2)
    expect(json().error.message).toMatch(/--questions: cannot read nope.yaml/)
    expect(await main(["many", "--glob", "src/*", "--questions", "bad.yaml"], io)).toBe(2)
    expect(json().error.message).toMatch(/--questions bad.yaml:/)
  })
})

describe("decide ping", () => {
  it("probes the model and endpoint from the config file, env over file", async () => {
    const { io, json } = rig({
      ".system1/config.yaml":
        "model: acme/judge-1\nendpoint: https://example.test/api/v1/decisions\n",
    })
    const probed: string[] = []
    const fetchImpl = (async (url: string) => {
      probed.push(url)
      return Response.json({ data: { endpoints: [] } })
    }) as unknown as typeof fetch
    expect(await main(["ping"], { ...io, fetch: fetchImpl })).toBe(0)
    expect(json().result).toMatchObject({ model: "acme/judge-1", keyPresent: true })
    expect(probed.at(-1)).toBe("https://example.test/api/v1/models/acme/judge-1/endpoints")

    const env = { ...io.env, SYSTEM1_MODEL: "acme/judge-2" }
    expect(await main(["ping"], { ...io, env, fetch: fetchImpl })).toBe(0)
    expect(json().result.model).toBe("acme/judge-2")
  })

  it("still pings from the environment when the config file is broken, and says so", async () => {
    const { io, json, out } = rig({ ".system1/config.yaml": "egress: [unclosed\n" })
    expect(await main(["ping"], io)).toBe(0)
    expect(json().result).toMatchObject({
      ok: true,
      model: "typesafe/jev-1.13",
      configError: expect.stringMatching(/not valid YAML/),
    })
    expect(await main(["ping", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/\nconfig not loaded, so this used the environment only: /)
  })

  it("an endpoint that isn't a URL is a usage error, not a bug", async () => {
    const { io, json } = rig()
    const env = { ...io.env, SYSTEM1_ENDPOINT: "openrouter.ai/api" }
    expect(await main(["ping"], { ...io, env })).toBe(2)
    expect(json().error).toMatchObject({ code: "config-error" })
  })
})

describe("decide spec check", () => {
  const spec = `description: Auth.
questions:
  relevant: { type: noul, instructions: Handles auth. }
examples:
  - { id: login, state: "auth flow", expect: { relevant: true } }
  - { id: helper, state: "string helper", expect: { relevant: true } }
`
  it("records with --live, then replays offline; a mismatch is exit 0 with passed false", async () => {
    const live = rig({ ".system1/specs/auth.yaml": spec })
    expect(await main(["spec", "check", "auth", "--live"], live.io)).toBe(0)
    expect(live.json().result).toMatchObject({
      source: "live",
      passed: false,
      counts: { pass: 1, fail: 1 },
    })

    const offline = { ...live.io, env: {} }
    expect(await main(["spec", "check", "auth", "--format", "brief"], offline)).toBe(0)
    const brief = live.out.at(-1) ?? ""
    expect(brief).toMatch(
      /^decide spec check: auth FAILED · 1 pass · 1 fail · 0 undecided · replay /,
    )
    expect(brief).toContain("FAIL  helper  relevant=0.05")
    expect(brief).toContain("expected relevant: true")

    // --strict turns the same result into exit 7, for a CI gate; the envelope is unchanged.
    expect(await main(["spec", "check", "auth", "--strict"], offline)).toBe(7)
    expect(live.json()).toMatchObject({ ok: true, result: { passed: false } })
  })

  it("--strict still exits 0 when every example passes", async () => {
    const live = rig({
      ".system1/specs/auth.yaml": spec.replace(
        '{ id: helper, state: "string helper", expect: { relevant: true } }',
        '{ id: helper, state: "string helper", expect: { relevant: false } }',
      ),
    })
    expect(await main(["spec", "check", "auth", "--live", "--strict"], live.io)).toBe(0)
    expect(live.json().result.passed).toBe(true)
  })

  it("a replay miss is exit 6; no examples or bad usage is exit 2", async () => {
    const { io, json } = rig(
      {
        ".system1/specs/auth.yaml": spec,
        ".system1/specs/bare.yaml":
          "description: x\nquestions:\n  a: { type: noul, instructions: A. }\n",
      },
      { key: false },
    )
    expect(await main(["spec", "check", "auth"], io)).toBe(6)
    expect(json().error.message).toContain("--live")
    // --strict never hides an error behind exit 7.
    expect(await main(["spec", "check", "auth", "--strict", "--format", "brief"], io)).toBe(6)
    expect(await main(["spec", "check", "bare"], io)).toBe(2)
    expect(await main(["spec", "check"], io)).toBe(2)
    expect(await main(["spec", "check", "auth", "--live", "--replay"], io)).toBe(2)
  })
})

describe("probeVersion", () => {
  const script = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "decide-probe-"))
    dirs.push(dir)
    const file = join(dir, "decide")
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return file
  }

  it("reads the first line, and never lets the shim fall back to npx", async () => {
    expect(await probeVersion(script('echo "1.2.3"'), {})).toBe("1.2.3")
    expect(await probeVersion(script('echo "no_npx=$SYSTEM1_NO_NPX"'), {})).toBe("no_npx=1")
  })

  it("gives up on a child that ignores its timeout", async () => {
    const started = Date.now()
    expect(await probeVersion(script("trap '' TERM; sleep 5"), {}, 300)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe("strict input", () => {
  it("refuses an unknown property instead of ignoring it", async () => {
    const { io, json } = rig({
      "in.json": JSON.stringify({
        questions: { q: { type: "noul", instructions: "Is it?" } },
        sources: [{ kind: "text", text: "x" }],
        dryRun: true,
      }),
    })
    expect(await main(["ask", "--input", "in.json"], io)).toBe(2)
    expect(json().error.message).toMatch(/dryRun/)
  })

  it("refuses a question that isn't a valid question", async () => {
    const { io, json } = rig({
      "in.json": JSON.stringify({
        questions: { q: { type: "noul" } },
        sources: [{ kind: "text", text: "x" }],
      }),
    })
    expect(await main(["ask", "--input", "in.json"], io)).toBe(2)
    expect(json().error.message).toMatch(/instructions|questions/)
  })
})

describe("decide spec lint", () => {
  const clean = `description: Clean.
questions:
  relevant: { type: noul, instructions: The file handles auth. }
`
  const warns = `description: Warns.
questions:
  sev: { type: score, instructions: How bad it is., criteria: [low, medium, high] }
`
  const errs = `description: Errs.
questions:
  a: { type: noul, instructions: The file handles auth. }
policy: { thresholds: { b: { value: 0.5, why: x } } }
`

  it("runs offline and gates: errors exit 7, warnings only with --strict", async () => {
    const { io, json, out } = rig(
      { ".system1/specs/clean.yaml": clean, ".system1/specs/warns.yaml": warns },
      { consent: false, key: false },
    )
    expect(await main(["spec", "lint"], io)).toBe(0)
    expect(json().result).toMatchObject({
      passed: true,
      counts: { specs: 2, errors: 0, warnings: 1, invalid: 0 },
    })
    expect(await main(["spec", "lint", "--strict"], io)).toBe(7)
    expect(await main(["spec", "lint", "clean", "--strict", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/^decide spec lint: PASSED · 1 spec\(s\)/)
  })

  it("reports a named spec that doesn't parse as invalid, exit 7; a missing one is exit 2", async () => {
    const { io, json } = rig(
      { ".system1/specs/broken.yaml": "description: x\n" },
      { consent: false, key: false },
    )
    expect(await main(["spec", "lint", "broken"], io)).toBe(7)
    expect(json().result).toMatchObject({ passed: false, counts: { invalid: 1 } })
    expect(await main(["spec", "lint", "nosuch"], io)).toBe(2)
  })

  it("reports each spec's own origin", async () => {
    const { io, json } = rig({ ".system1/specs/clean.yaml": clean }, { consent: false, key: false })
    expect(await main(["spec", "lint"], io)).toBe(0)
    expect(json().result.specs[0].origin).toBe("repo")
  })

  it("fails on an error-level finding, and reports an unparseable spec as invalid", async () => {
    const { io, json } = rig(
      { ".system1/specs/errs.yaml": errs, ".system1/specs/broken.yaml": "description: x\n" },
      { consent: false, key: false },
    )
    expect(await main(["spec", "lint", "errs"], io)).toBe(7)
    expect(json()).toMatchObject({ ok: true, result: { passed: false, counts: { errors: 1 } } })
    expect(await main(["spec", "lint"], io)).toBe(7)
    expect(json().result.counts).toMatchObject({ invalid: 1 })
  })

  it("spec check carries lint findings without changing passed or --strict", async () => {
    // Two sentences in one instruction: a merged-question warning. The fake
    // provider answers nouls only.
    const spec = `description: Merged.
questions:
  m: { type: noul, instructions: "The file handles auth. It also logs every token." }
examples:
  - { id: one, state: "auth", expect: { m: true } }
`
    const live = rig({ ".system1/specs/w.yaml": spec })
    expect(await main(["spec", "check", "w", "--live", "--strict"], live.io)).toBe(0)
    expect(live.json().result).toMatchObject({ passed: true, lint: [{ check: "merged-question" }] })
  })
})

describe("decide opportunities", () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    mode: "code",
    location: { path: "src/route.ts" },
    mechanism: "regex list classifying prompt intent",
    shape: "single",
    benefit: "cost",
    evidence: "const TRIGGERS = [/classify/]",
    questions: { intent: { type: "noul", instructions: "The prompt asks for a verdict." } },
    projected: {
      volume: 100,
      per: "day",
      currentCostPerItemUsd: 0.001,
      decisionCostPerItemUsd: 0.00003,
    },
    risk: { level: "low", note: "a miss skips a hint" },
    next: "save the spec with design",
    source: { sweep: "s1", answers: "live" },
    ...over,
  })

  it("adds from a file, lists with record filters, and checks, all offline", async () => {
    const { cwd, io, json, out } = rig({}, { consent: false, key: false })
    writeFileSync(
      join(cwd, "c.json"),
      JSON.stringify([
        candidate(),
        candidate({
          evidence: "chat.completions.create({ response_format })",
          location: { path: "src/baseline.ts" },
          status: "rejected",
          statusReason: "kept on purpose as the comparison baseline",
        }),
      ]),
    )
    expect(await main(["opportunities", "add", "--file", "c.json"], io)).toBe(0)
    expect(json().result).toMatchObject({ total: 2, updated: [], staled: [] })
    expect(json().result.added).toHaveLength(2)

    expect(await main(["opportunities", "list", "--keep", "status=new"], io)).toBe(0)
    expect(json().result).toMatchObject({ total: 2, matched: 1, basis: "projected" })
    expect(json().result.opportunities[0].projected.savingUsd).toBe(0.097)

    expect(
      await main(["opportunities", "list", "--fields", "status", "--format", "brief"], io),
    ).toBe(0)
    expect(out.at(-1)).toMatch(
      /^decide opportunities list: 2 shown · 2 matched · 2 total · savings projected/,
    )

    expect(await main(["opportunities", "check", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/valid · 2 entries \(1 new, 1 rejected\)/)
  })

  it("refuses bad input and a malformed backlog with exit 2, without touching the file", async () => {
    const { cwd, io, json } = rig({}, { consent: false, key: false })
    writeFileSync(join(cwd, "bad.json"), JSON.stringify([candidate({ status: "rejected" })]))
    expect(await main(["opportunities", "add", "--file", "bad.json"], io)).toBe(2)
    expect(json().error.message).toMatch(/statusReason is required/)
    writeFileSync(join(cwd, "extra.json"), JSON.stringify([candidate({ colour: "red" })]))
    expect(await main(["opportunities", "add", "--file", "extra.json"], io)).toBe(2)
    expect(await main(["opportunities", "add"], io)).toBe(2)
    writeFileSync(join(cwd, "keys.json"), JSON.stringify({ candidates: [candidate()], junk: 1 }))
    expect(await main(["opportunities", "add", "--file", "keys.json"], io)).toBe(2)
    expect(json().error.message).toMatch(/unknown key\(s\) junk/)
    writeFileSync(join(cwd, "blank.json"), JSON.stringify([candidate({ evidence: "   " })]))
    expect(await main(["opportunities", "add", "--file", "blank.json"], io)).toBe(2)
    expect(await main(["opportunities", "list", "--fields", "nosuch"], io)).toBe(2)
    expect(await main(["opportunities", "list", "--fields", "toString"], io)).toBe(2)
    expect(await main(["opportunities", "list", "--file", "x"], io)).toBe(2)

    const backlog = join(cwd, ".system1/opportunities.json")
    writeFileSync(backlog, '{"version":1,"opportunities":[{"id":"nope"}]}')
    expect(await main(["opportunities", "check"], io)).toBe(2)
    expect(json().error.code).toBe("invalid-request")
    expect(await main(["opportunities", "list"], io)).toBe(2)
    expect(readFileSync(backlog, "utf8")).toBe('{"version":1,"opportunities":[{"id":"nope"}]}')
  })
})

describe("decide spec validate", () => {
  it("fails on an example file that is missing or outside the repo", async () => {
    const spec = `description: x
questions:
  a: { type: noul, instructions: A. }
examples:
  - { id: up, file: "../../etc/hostname" }
`
    const { io, json } = rig({ ".system1/specs/s.yaml": spec })
    expect(await main(["spec", "validate", "s"], io)).toBe(2)
    expect(json().error.message).toContain("outside the repo")
    // It still loads for ask and many.
    expect(await main(["many", "--spec", "s", "--text", "x", "--dry-run"], io)).toBe(0)
  })
})

describe("decide doctor", () => {
  it("reports findings in an ok envelope with exit 0, never the key", async () => {
    const { io, out, json } = rig()
    expect(await main(["doctor"], io)).toBe(0)
    const r = json()
    expect(r).toMatchObject({ ok: true, command: "doctor", result: { healthy: true, live: true } })
    expect(r.result.checks.map((c: { name: string }) => c.name)).toEqual([
      "cli",
      "path",
      "key",
      "consent",
      "route",
      "backlog",
      "network",
    ])
    expect(await main(["doctor", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/^decide doctor: healthy · live ready · harness none/)
    expect(out.at(-1)).toMatch(/ok {3}network: .* reachable/)
    expect(out.join("\n")).not.toContain(SECRET)
  })

  it("names what is missing instead of `healthy` when nothing live can work", async () => {
    const { io, out, json } = rig({}, { key: false, consent: false })
    expect(await main(["doctor", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(
      /^decide doctor: SETUP NEEDED \((path, )?key, consent\) · replay only/,
    )
    // The JSON result is unchanged: warnings alone keep it healthy (0010).
    expect(await main(["doctor"], io)).toBe(0)
    expect(json()).toMatchObject({ ok: true, result: { healthy: true, live: false } })
  })

  it("stays exit 0 when a check fails, and says so", async () => {
    const { io, out } = rig()
    const env = { ...io.env, SYSTEM1_ENDPOINT: "notaurl" }
    expect(await main(["doctor", "--format", "brief"], { ...io, env })).toBe(0)
    expect(out.at(-1)).toMatch(/^decide doctor: PROBLEMS FOUND · replay only/)
    expect(out.at(-1)).toMatch(/fail config: endpoint notaurl/)
  })
})

describe("decide route", () => {
  const PROMPT = "Triage every CI failure in failures.jsonl"

  it("--text: an ok envelope naming the triggers; brief prints only the hint", async () => {
    const { io, out, json } = rig()
    expect(await main(["route", "--text", PROMPT], io)).toBe(0)
    expect(json()).toMatchObject({
      ok: true,
      command: "route",
      result: { matched: true, triggers: [{ name: "batch-judgement" }] },
    })
    expect(await main(["route", "--text", PROMPT, "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/^System 1 routing hint \(batch-judgement\)/)
    expect(await main(["route", "--text", "Summarise README.md", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toBe("")
  })

  it("--hook: reads the prompt from the event and config from its cwd", async () => {
    const other = rig({ ".system1/config.yaml": "route:\n  enabled: false\n" }, { consent: false })
    const event = JSON.stringify({ prompt: PROMPT, cwd: other.cwd })
    const { io, json } = rig({}, { stdin: event })
    expect(await main(["route", "--hook"], io)).toBe(0)
    expect(json().result).toMatchObject({ enabled: false, matched: false })
  })

  it("usage and bad events are exit 2, which the plugin hook swallows", async () => {
    const { io } = rig({}, { stdin: "not json" })
    expect(await main(["route"], io)).toBe(2)
    expect(await main(["route", "--text", "x", "--stdin"], io)).toBe(2)
    expect(await main(["route", "--hook"], io)).toBe(2)
  })

  it("a bad pattern in config is a config-error", async () => {
    const { io, json } = rig({ ".system1/config.yaml": "route:\n  ignore: ['(']\n" })
    expect(await main(["route", "--text", PROMPT], io)).toBe(2)
    expect(json().error.code).toBe("config-error")
  })
})
