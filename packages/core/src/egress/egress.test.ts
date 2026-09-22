import { describe, expect, it } from "vitest"
import { resolveProfile } from "../model/profiles.js"
import type { Item } from "../sources/types.js"
import { applyExcludes, isExcluded } from "./exclude.js"
import { type ScrubCounts, scrubState, scrubText } from "./scrub.js"
import { assertStateFits, estimateTokens } from "./size.js"

const item = (path: string): Item => ({ id: path, state: "x", path })

describe("excludes", () => {
  it.each([
    ".env",
    "app/.env.local",
    "certs/server.pem",
    "home/.ssh/config",
    "infra/prod.tfstate",
    "config/secrets/db.yaml",
    ".npmrc",
  ])("withholds %s by default", (path) => {
    expect(isExcluded(path)).toBeDefined()
  })

  it.each(["src/env.ts", "docs/secrets-management.md", "README.md", ".envrc.example.md"])(
    "allows %s",
    (path) => {
      expect(isExcluded(path)).toBeUndefined()
    },
  )

  it("reports each excluded path once with its pattern, and adds config patterns", () => {
    const { items, excluded } = applyExcludes(
      [item("src/a.ts"), item(".env"), { ...item(".env"), id: ".env:2" }, item("fixtures/x.json")],
      ["fixtures/**"],
    )
    expect(items.map((i) => i.id)).toEqual(["src/a.ts"])
    expect(excluded).toEqual([
      { path: ".env", reason: "excluded", detail: "**/.env" },
      { path: "fixtures/x.json", reason: "excluded", detail: "fixtures/**" },
    ])
  })

  it("never excludes pathless items (text, stdin)", () => {
    expect(applyExcludes([{ id: "stdin", state: "API_KEY=1" } as Item]).items).toHaveLength(1)
  })
})

describe("scrub", () => {
  const secrets: Array<[string, string]> = [
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"],
    ["aws-access-key", "key AKIAIOSFODNN7EXAMPLE here"],
    ["github-token", `token ghp_${"a".repeat(36)}`],
    ["openrouter-key", `sk-or-v1-${"0123456789abcdef".repeat(4)}`],
    ["anthropic-key", `sk-ant-api03-${"x".repeat(40)}`],
    ["openai-key", `sk-proj-${"Y".repeat(40)}`],
    ["slack-token", "xoxb-1234567890-abcdefghij"],
    ["stripe-key", `sk_live_${"z".repeat(24)}`],
    [
      "jwt",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ],
    ["url-credentials", "postgres://admin:hunter22@db.internal/app"],
    ["assigned-secret", 'DB_PASSWORD = "correct-horse-battery"'],
    ["assigned-secret", "api_key: 9f8e7d6c5b4a3210"],
  ]
  it.each(secrets)("redacts %s", (kind, text) => {
    const counts: ScrubCounts = {}
    const out = scrubText(text, counts)
    expect(out).toContain(`[REDACTED:${kind}]`)
    expect(counts[kind]).toBeGreaterThan(0)
  })

  it("keeps the name in an assignment and the host in a URL", () => {
    expect(scrubText('API_TOKEN="abcdefgh12345"')).toBe('API_TOKEN="[REDACTED:assigned-secret]"')
    expect(scrubText("https://bob:s3cr3tpw@example.com/x")).toBe(
      "https://bob:[REDACTED:url-credentials]@example.com/x",
    )
  })

  it.each([
    "const token = getToken()",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal placeholder the scrubber must not redact
    "password: ${DB_PASSWORD}",
    "secret: <your-secret-here>",
    "the author of this function",
    "sk-short",
    "tokens used: 1234",
    "const secret = process.env.SECRET_VALUE",
    "authToken = await fetchAuthToken(user)",
  ])("leaves %s alone", (text) => {
    expect(scrubText(text)).toBe(text)
  })

  it("scrubs every string leaf of a structured state", () => {
    const counts: ScrubCounts = {}
    const out = scrubState(
      { cmd: "export OPENAI_API_KEY=abcdefgh1234", nested: [{ n: 1, s: "AKIAIOSFODNN7EXAMPLE" }] },
      counts,
    )
    expect(out).toEqual({
      cmd: "export OPENAI_API_KEY=[REDACTED:assigned-secret]",
      nested: [{ n: 1, s: "[REDACTED:aws-access-key]" }],
    })
    expect(counts).toEqual({ "aws-access-key": 1, "assigned-secret": 1 })
  })
})

describe("size", () => {
  const profile = { ...resolveProfile("typesafe/jev-1.13"), maxStateTokens: 100 }
  const questions = { q: { type: "noul" as const, instructions: "x" } }

  it("estimates conservatively (~3 chars per token)", () => {
    expect(estimateTokens("abcdef")).toBe(2)
    expect(estimateTokens({ a: 1 })).toBe(Math.ceil('{"a":1}'.length / 3))
  })

  it("refuses an oversized state, naming it and the limit", () => {
    expect(() => assertStateFits("big.ts", "x".repeat(400), questions, profile)).toThrow(
      expect.objectContaining({
        code: "state-too-large",
        details: expect.objectContaining({ id: "big.ts", maxStateTokens: 100 }),
      }),
    )
  })

  it("returns the estimate when it fits", () => {
    expect(assertStateFits("ok", "x".repeat(30), questions, profile)).toBeGreaterThan(10)
  })
})
