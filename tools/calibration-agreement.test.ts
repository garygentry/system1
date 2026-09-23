import { describe, expect, it } from "vitest"
import { embedJson, excerptRange } from "./calibration-agreement.js"

describe("excerptRange", () => {
  it("splits a line-range id, keeping colons in the path", () => {
    expect(excerptRange("src/a:b.ts:41-80")).toEqual({ path: "src/a:b.ts", start: 41, end: 80 })
  })
  it("refuses an id without a range", () => {
    expect(() => excerptRange("src/a.ts")).toThrow(/line-range/)
  })
})

describe("embedJson", () => {
  it("cannot close the script element it sits in, and still parses", () => {
    const text = embedJson({ code: "</script><b>" })
    expect(text).not.toContain("</")
    expect(JSON.parse(text)).toEqual({ code: "</script><b>" })
  })
})
