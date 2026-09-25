import { describe, expect, it } from "vitest"
import { atLeast, checkTag, releaseVersion, stagedFor, stageIdFrom } from "./release-lib.mjs"

describe("checkTag", () => {
  it("accepts the tag of the packages' version", () => {
    expect(checkTag("v0.5.0", "0.5.0")).toEqual([])
  })

  it("rejects another version, a prerelease or a bare version", () => {
    expect(checkTag("v0.5.1", "0.5.0")).toHaveLength(1)
    expect(checkTag("v0.5.0-rc.1", "0.5.0")).toHaveLength(1)
    expect(checkTag("0.5.0", "0.5.0")).toHaveLength(1)
  })
})

describe("atLeast", () => {
  it("compares numerically, not as strings", () => {
    expect(atLeast("11.15.0", "11.15.0")).toBe(true)
    expect(atLeast("11.20.0", "11.15.0")).toBe(true)
    expect(atLeast("12.0.0", "11.15.0")).toBe(true)
    expect(atLeast("11.9.0", "11.15.0")).toBe(false)
    expect(atLeast("10.9.8", "11.15.0")).toBe(false)
  })
})

describe("stageIdFrom", () => {
  const id = "0f8e3c1a-5b2d-4e6f-9a7b-1c2d3e4f5a6b"

  it("reads the id from npm stage publish's output", () => {
    expect(stageIdFrom(`npm notice …\n+ @garygentry/system1@0.5.0 (staged with id ${id})\n`)).toBe(
      id,
    )
  })

  it("is undefined when npm printed none", () => {
    expect(stageIdFrom("+ @garygentry/system1@0.5.0 (staged)")).toBeUndefined()
  })
})

describe("stagedFor", () => {
  it("keeps only the stages of that package and version", () => {
    const items = [
      { id: "a", packageName: "@garygentry/system1", version: "0.5.0" },
      { id: "b", packageName: "@garygentry/system1", version: "0.4.9" },
      { id: "c", packageName: "@garygentry/system1-core", version: "0.5.0" },
    ]
    expect(stagedFor(items, "@garygentry/system1", "0.5.0").map((i) => i.id)).toEqual(["a"])
  })
})

describe("releaseVersion", () => {
  it("finds the three packages in lockstep", () => {
    expect(releaseVersion()).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/) })
  })
})
