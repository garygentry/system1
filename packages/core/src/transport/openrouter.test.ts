import { describe, expect, it, vi } from "vitest"
import { guardrailQuestions, guardrailResponse } from "../testdata/index.js"
import { createOpenRouterTransport } from "./openrouter.js"

const request = {
  model: "typesafe/jev-1.13",
  state: { command: "ls -la src/" },
  questions: guardrailQuestions(),
}

/** A fetch that plays back a script of responses (or thrown errors), recording each call. */
function scripted(...steps: Array<Response | Error>) {
  const calls: RequestInit[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(init)
    const step = steps.shift()
    if (!step) throw new Error("script exhausted")
    if (step instanceof Error) throw step
    return step
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const ok = () => Response.json(guardrailResponse())
const noSleep = vi.fn(async () => {})

describe("openrouter transport", () => {
  it("posts the request with auth and attribution headers, and parses the answer", async () => {
    const { fetch, calls } = scripted(ok())
    const transport = createOpenRouterTransport({ apiKey: "sk-test", fetch, sleep: noSleep })
    const result = await transport.decide(request)
    expect(result.attempts).toBe(1)
    expect(result.response.answers.blast_radius).toMatchObject({ choice: "read_only" })
    const headers = calls[0]?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk-test")
    expect(headers["X-Title"]).toBe("system1")
    expect(JSON.parse(String(calls[0]?.body))).toEqual(request)
  })

  it("retries retryable statuses with exponential backoff", async () => {
    const sleep = vi.fn(async () => {})
    const { fetch } = scripted(
      new Response("busy", { status: 429 }),
      new Response("", { status: 503 }),
      ok(),
    )
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep, backoffMs: 100 })
    const result = await transport.decide(request)
    expect(result.attempts).toBe(3)
    expect(sleep.mock.calls).toEqual([[100], [200]])
  })

  it("does not retry a non-retryable status", async () => {
    const { fetch, calls } = scripted(new Response("bad key", { status: 401 }), ok())
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep: noSleep })
    await expect(transport.decide(request)).rejects.toMatchObject({
      code: "provider-http",
      status: 401,
    })
    expect(calls).toHaveLength(1)
  })

  it("gives up after maxAttempts on network errors, as provider-unreachable", async () => {
    const down = () => new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") })
    const { fetch, calls } = scripted(down(), down(), down())
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep: noSleep })
    await expect(transport.decide(request)).rejects.toMatchObject({
      code: "provider-unreachable",
      message: expect.stringContaining("ECONNREFUSED"),
    })
    expect(calls).toHaveLength(3)
  })

  it("does not retry after the caller aborts", async () => {
    const controller = new AbortController()
    const fetch = (async () => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    }) as unknown as typeof globalThis.fetch
    const sleep = vi.fn(async () => {})
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep })
    await expect(transport.decide(request, controller.signal)).rejects.toThrow("aborted")
    expect(sleep).not.toHaveBeenCalled()
  })

  it("reports a 2xx non-JSON body as malformed-response", async () => {
    const { fetch } = scripted(new Response("<html>", { status: 200 }))
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep: noSleep })
    await expect(transport.decide(request)).rejects.toMatchObject({ code: "malformed-response" })
  })

  it("enforces a per-attempt timeout", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      })) as unknown as typeof globalThis.fetch
    const transport = createOpenRouterTransport({
      apiKey: "k",
      fetch: hang,
      sleep: noSleep,
      timeoutMs: 20,
      maxAttempts: 2,
    })
    await expect(transport.decide(request)).rejects.toMatchObject({ code: "provider-unreachable" })
  })
})
