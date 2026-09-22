import { expect, it, vi } from "vitest"
import { postJson } from "../src/http/legacy"

it("aborts a POST after 10 seconds", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"))
  await postJson("https://x.test", {})
  expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
})
