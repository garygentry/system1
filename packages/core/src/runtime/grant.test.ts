import { describe, expect, it } from "vitest"
import { useTempDirs } from "../testkit/tmp.js"
import { EGRESS_MARKER, grantIn, readModuleGrant } from "./grant.js"

const temp = useTempDirs()
const mark = `system1: runtime egress (the user's to switch)`

describe("the module grant (0020, D7)", () => {
  it("is on only for one marked line assigning the literal on", () => {
    for (const line of [
      `const EGRESS = "on" // ${mark}`,
      `export const EGRESS: "on" | "off" = 'on'; // ${mark}`,
      `const EGRESS = "on" as const // ${mark}`,
      `const EGRESS = "on" satisfies Egress // ${mark}`,
      `EGRESS = "on"  # ${mark}`,
      `EGRESS: str = "on"  # ${mark}`,
      `EGRESS: Final = 'on' # ${mark}`,
      `EGRESS: Literal["on", "off"] = "on"  # ${mark}`,
    ])
      expect(grantIn(`x = 1\n${line}\ny = 2\n`), line).toEqual({ egress: "on" })
  })

  it("is off for anything else, saying why", () => {
    for (const line of [
      `const EGRESS = "off" // ${mark}`,
      `EGRESS = "on" if os.environ.get("X") else "off"  # ${mark}`,
      `EGRESS = os.environ["EGRESS"]  # ${mark}`,
      `const EGRESS = process.env.EGRESS ?? "off" // ${mark}`,
      `const EGRESS = "on" || x // ${mark}`,
      `# EGRESS = "on"  # ${mark}`,
      `NOT_EGRESS = "on"  # ${mark}`,
      `EGRESS = "online"  # ${mark}`,
      `EGRESS == "on"  # ${mark}`,
      // The annotation can't smuggle in an assignment: Python runs this as "off".
      `EGRESS: "= 'on' #" = "off"  # ${mark}`,
      `let EGRESS: "off" | "x = 'on' //" = "off" // ${mark}`,
      // Indented: inside an if, a function or a docstring, not the module's binding.
      `    EGRESS = "on"  # ${mark}`,
      `\tEGRESS = "on"  # ${mark}`,
      // An annotation that hides a statement: EGRESS is never assigned.
      `EGRESS: str; Z = "on"  # ${mark}`,
      `let EGRESS: string; const Z = "on" // ${mark}`,
      `EGRESS: print("x"); EGRESS = "on"  # ${mark}`,
      // A comment between the literal and the marker.
      `EGRESS = "on"  # not the marker; ${mark}`,
    ])
      expect(grantIn(line).egress, line).toBe("off")
    expect(grantIn(`EGRESS = "on"\n`)).toEqual({
      egress: "off",
      why: "the module has no marked EGRESS line",
    })
    // A lone CR is a line break to Python: the marked line is cut short of a grant.
    expect(grantIn(`EGRESS = "on"\rX = 1  # ${mark}`).egress).toBe("off")
    // Two marked lines are ambiguous: off.
    expect(grantIn(`EGRESS = "on"  # ${mark}\nEGRESS = "on"  # ${mark}\n`)).toMatchObject({
      egress: "off",
      why: expect.stringMatching(/2 marked/),
    })
    expect(EGRESS_MARKER).toBe("system1: runtime egress")
  })

  it("reads a module file, and is undefined when it can't", () => {
    const dir = temp({ "policy.py": `EGRESS = "on"  # ${mark}\n` })
    expect(readModuleGrant(`${dir}/policy.py`)).toEqual({ egress: "on" })
    expect(readModuleGrant(`${dir}/missing.py`)).toBeUndefined()
  })
})
