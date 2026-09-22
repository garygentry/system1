import { describe, expect, it } from "vitest"
import { ping, probeUrl } from "./ping.js"
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, resolveConnection } from "./wiring.js"

const config = {
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  apiKey: undefined,
  replay: false,
}

function fakeFetch(respond: () => Response | Promise<Response>): typeof fetch {
  return (async () => respond()) as typeof fetch
}

describe("resolveConnection", () => {
  it("defaults when env is empty", () => {
    expect(resolveConnection({})).toEqual(config)
  })

  it("prefers env overrides and ignores blank values", () => {
    const resolved = resolveConnection({
      SYSTEM1_ENDPOINT: "https://example.test/api/alpha/decisions",
      SYSTEM1_MODEL: " ",
      OPENROUTER_API_KEY: "sk-test",
    })
    expect(resolved.endpoint).toBe("https://example.test/api/alpha/decisions")
    expect(resolved.model).toBe(DEFAULT_MODEL)
    expect(resolved.apiKey).toBe("sk-test")
  })
})

describe("ping", () => {
  it("probes the model's endpoint listing on the endpoint's origin", () => {
    expect(probeUrl(config)).toBe("https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints")
  })

  it("reports reachability and context length", async () => {
    const result = await ping(config, {
      fetch: fakeFetch(() => Response.json({ data: { endpoints: [{ context_length: 32000 }] } })),
    })
    expect(result).toMatchObject({
      ok: true,
      httpStatus: 200,
      contextLength: 32000,
      keyPresent: false,
    })
    expect(result.latencyMs).toBeTypeOf("number")
  })

  it("treats a non-2xx listing as a failure", async () => {
    const result = await ping(config, { fetch: fakeFetch(() => new Response("", { status: 404 })) })
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "HTTP 404" })
  })

  it("surfaces network errors with their cause, which is what a sandbox block looks like", async () => {
    const result = await ping(config, {
      fetch: fakeFetch(() => {
        throw new TypeError("fetch failed", {
          cause: new Error("getaddrinfo EAI_AGAIN openrouter.ai"),
        })
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe("fetch failed: getaddrinfo EAI_AGAIN openrouter.ai")
    expect(result.latencyMs).toBeUndefined()
  })
})

describe("resolveConnection replay flag", () => {
  it.each(["1", "true", "YES"])("treats SYSTEM1_REPLAY=%s as replay", (value) => {
    expect(resolveConnection({ SYSTEM1_REPLAY: value }).replay).toBe(true)
  })
  it("defaults to not replaying", () => {
    expect(resolveConnection({ SYSTEM1_REPLAY: "0" }).replay).toBe(false)
  })
})
