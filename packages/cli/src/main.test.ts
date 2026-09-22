import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
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
  mkdirSync(join(cwd, ".decisions"), { recursive: true })
  if (consent)
    writeFileSync(join(cwd, ".decisions/config.yaml"), "egress:\n  consent: { granted: true }\n")
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
      join(cwd, ".decisions/config.yaml"),
      "egress:\n  consent: { granted: true }\nbudget: { maxCalls: 2 }\n",
    )
    expect(await main(["many", "--glob", "*.txt", "--question", Q], io)).toBe(4)
    expect(json().error.details.projection).toMatchObject({ basis: "projected", calls: 5 })
    expect(await main(["many", "--glob", "*.txt", "--question", Q, "--confirm"], io)).toBe(0)
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

  it("grants when a human is at the terminal, and reports status", async () => {
    const { cwd, io, out } = rig({}, { consent: false, interactive: true })
    expect(await main(["config", "egress", "allow"], io)).toBe(0)
    expect(readFileSync(join(cwd, ".decisions/config.yaml"), "utf8")).toContain("granted: true")
    await main(["config", "egress", "status", "--format", "brief"], io)
    expect(out.at(-1)).toMatch(/^egress consent: granted/)
  })

  it("config show never prints the key", async () => {
    const { io, out } = rig()
    await main(["config"], io)
    expect(out.join("")).not.toContain(SECRET)
    expect(JSON.parse(out[0] ?? "").result.apiKey).toBe("present (env)")
  })
})

describe("decide spec", () => {
  it("lists, shows and validates repo specs", async () => {
    const spec =
      "description: Auth.\nquestions:\n  relevant: { type: noul, instructions: Handles auth. }\n"
    const { io, json } = rig({
      ".decisions/specs/auth.yaml": spec,
      ".decisions/specs/broken.yaml": "questions: {}\n",
    })
    await main(["spec", "list"], io)
    expect(json().result.specs.map((s: { name: string }) => s.name)).toEqual(["auth", "broken"])
    expect(await main(["spec", "show", "auth"], io)).toBe(0)
    expect(json().result.questions.relevant.type).toBe("noul")
    expect(await main(["spec", "validate"], io)).toBe(2)
    expect(json().error.details.invalid[0].name).toBe("broken")
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
      "network",
    ])
    expect(await main(["doctor", "--format", "brief"], io)).toBe(0)
    expect(out.at(-1)).toMatch(/^decide doctor: healthy · live ready · harness none/)
    expect(out.at(-1)).toMatch(/ok {3}network: .* reachable/)
    expect(out.join("\n")).not.toContain(SECRET)
  })

  it("stays exit 0 when a check fails, and says so", async () => {
    const { io, out } = rig()
    const env = { ...io.env, DECISIONS_ENDPOINT: "notaurl" }
    expect(await main(["doctor", "--format", "brief"], { ...io, env })).toBe(0)
    expect(out.at(-1)).toMatch(/^decide doctor: PROBLEMS FOUND · replay only/)
    expect(out.at(-1)).toMatch(/fail config: endpoint notaurl/)
  })
})
