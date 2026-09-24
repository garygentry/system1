import { describe, expect, it } from "vitest"
import { applyFilter } from "./filter.js"

describe("applyFilter", () => {
  it("keeps everything with no patterns", () => {
    const items = [{ path: "a.ts" }, {}]
    expect(applyFilter(items)).toEqual({ items, filtered: [] })
  })

  it("drops matching paths once each, naming the pattern, and never drops pathless items", () => {
    const items = [{ path: "src/a.ts" }, { path: "src/a.test.ts" }, { path: "src/a.test.ts" }, {}]
    const result = applyFilter(items, ["**/*.test.ts"])
    expect(result.items).toEqual([{ path: "src/a.ts" }, {}])
    expect(result.filtered).toEqual([
      { path: "src/a.test.ts", reason: "filtered", detail: "**/*.test.ts" },
    ])
  })

  it("matches a symlink's target too", () => {
    const result = applyFilter(
      [{ path: "src/link.ts", realPath: "src/a.test.ts" }],
      ["**/*.test.ts"],
    )
    expect(result.filtered).toEqual([
      { path: "src/link.ts", reason: "filtered", detail: "**/*.test.ts" },
    ])
  })

  it("matches dotfiles and dot-directories", () => {
    const result = applyFilter([{ path: ".github/x.yml" }], [".github/**"])
    expect(result.items).toEqual([])
  })
})
