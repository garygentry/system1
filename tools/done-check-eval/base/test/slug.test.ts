import { expect, it } from "vitest"
import { makeSlug } from "../src/slug.js"

it("is stable and 7 characters long", () => {
  expect(makeSlug("https://example.com")).toBe(makeSlug("https://example.com"))
  expect(makeSlug("https://example.com")).toHaveLength(7)
})
