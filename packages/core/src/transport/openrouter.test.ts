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

  it("retries the provider's 529 system_overloaded", async () => {
    const { fetch, calls } = scripted(new Response("overloaded", { status: 529 }), ok())
    const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep: noSleep })
    const result = await transport.decide(request)
    expect(result.attempts).toBe(2)
    expect(calls).toHaveLength(2)
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

  describe("never loses a paid call's cost (M11 gap B)", () => {
    it("reports a body that times out after a 200 as unreachable, paid, and not retried", async () => {
      const calls: RequestInit[] = []
      // A 200 whose body never finishes, until the attempt's timeout aborts it.
      const fetch = (async (_url: string, init: RequestInit) => {
        calls.push(init)
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"answers":'))
            init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason))
          },
        })
        return new Response(body, { status: 200 })
      }) as unknown as typeof globalThis.fetch
      const transport = createOpenRouterTransport({
        apiKey: "k",
        fetch,
        sleep: noSleep,
        timeoutMs: 20,
      })
      await expect(transport.decide(request)).rejects.toMatchObject({
        code: "provider-unreachable",
        message: expect.stringMatching(/timed out sending its answer/),
        spent: { usage: { cost: 0, reported: false }, uncounted: 1 },
      })
      expect(calls).toHaveLength(1)
    })

    it("keeps the usage of a 200 that fails validation", async () => {
      const usage = { input_tokens: 685, output_tokens: 0, cost: 0.00003 }
      const { fetch } = scripted(Response.json({ answers: {}, usage }))
      const transport = createOpenRouterTransport({ apiKey: "k", fetch, sleep: noSleep })
      await expect(transport.decide(request)).rejects.toMatchObject({
        code: "malformed-response",
        spent: { usage, uncounted: 0 },
        details: { spent: { usage, uncounted: 0 } },
      })
      // With no readable usage, the 200 itself is billed unreported.
      const bare = scripted(Response.json({ answers: {} }))
      await expect(
        createOpenRouterTransport({ apiKey: "k", fetch: bare.fetch, sleep: noSleep }).decide(
          request,
        ),
      ).rejects.toMatchObject({ spent: { usage: { reported: false }, uncounted: 1 } })
      // A 200 that isn't JSON was still paid for.
      const html = scripted(new Response("<html>", { status: 200 }))
      await expect(
        createOpenRouterTransport({ apiKey: "k", fetch: html.fetch, sleep: noSleep }).decide(
          request,
        ),
      ).rejects.toMatchObject({ code: "malformed-response", spent: { uncounted: 1 } })
    })

    it("counts a retry after a server-side failure as billed unreported, and a refusal as not", async () => {
      const after504 = scripted(new Response("", { status: 504 }), ok())
      const result = await createOpenRouterTransport({
        apiKey: "k",
        fetch: after504.fetch,
        sleep: noSleep,
      }).decide(request)
      expect(result.uncounted).toBe(1)
      // A lower bound: the answer's reported cost, flagged incomplete.
      expect(result.response.usage).toMatchObject({ reported: false })
      expect(result.response.usage.cost).toBeGreaterThan(0)
      const refused = scripted(
        new Response("", { status: 429 }),
        new Response("", { status: 503 }),
        new Response("", { status: 529 }),
      )
      await expect(
        createOpenRouterTransport({ apiKey: "k", fetch: refused.fetch, sleep: noSleep }).decide(
          request,
        ),
      ).rejects.toSatisfy((e: { spent?: unknown }) => e.spent === undefined)
      const clean = scripted(new Response("", { status: 429 }), ok())
      const r = await createOpenRouterTransport({
        apiKey: "k",
        fetch: clean.fetch,
        sleep: noSleep,
      }).decide(request)
      expect(r.uncounted).toBe(0)
      expect(r.response.usage.reported).toBeUndefined()
    })

    it("counts timeouts as billed unreported, but not a request that never left", async () => {
      const hang = ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        })) as unknown as typeof globalThis.fetch
      await expect(
        createOpenRouterTransport({
          apiKey: "k",
          fetch: hang,
          sleep: noSleep,
          timeoutMs: 20,
          maxAttempts: 2,
        }).decide(request),
      ).rejects.toMatchObject({ spent: { usage: { reported: false }, uncounted: 2 } })
      const refused = () =>
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        })
      const down = scripted(refused(), refused(), refused())
      await expect(
        createOpenRouterTransport({ apiKey: "k", fetch: down.fetch, sleep: noSleep }).decide(
          request,
        ),
      ).rejects.toSatisfy((e: { spent?: unknown }) => e.spent === undefined)
      // A non-retryable refusal ran nothing either.
      const bad = scripted(new Response("bad key", { status: 401 }))
      await expect(
        createOpenRouterTransport({ apiKey: "k", fetch: bad.fetch, sleep: noSleep }).decide(
          request,
        ),
      ).rejects.toSatisfy((e: { spent?: unknown }) => e.spent === undefined)
    })
  })
})
