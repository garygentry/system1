import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs, writeTree } from "../testkit/tmp.js"
import { listSpecs, loadSpec, parseSpec } from "./spec.js"

const temp = useTempDirs()

const SPEC = `description: Which files matter to the goal.
questions:
  relevant:
    type: noul
    instructions: The file is relevant to the goal.
keep: ["relevant>=0.7"]
sort: relevant
policy:
  thresholds:
    relevant: { value: 0.7, why: "Jev is decisive; 0.7 keeps borderline files out." }
source: { glob: ["src/**/*.ts"], split: file }
`

function dirs() {
  const repo = temp()
  const user = temp()
  const bundled = temp()
  return {
    repo,
    user,
    bundled,
    dirs: { repo: join(repo, "specs"), user: join(user, "specs"), bundled: join(bundled, "specs") },
  }
}

describe("parseSpec", () => {
  it("accepts a full spec and names it after the file", () => {
    const spec = parseSpec(SPEC, "/x/relevance.yaml", "repo")
    expect(spec).toMatchObject({ name: "relevance", origin: "repo", keep: ["relevant>=0.7"] })
    expect(spec.questions.relevant?.type).toBe("noul")
  })

  it.each([
    ["a missing description", SPEC.replace(/^description:.*\n/, ""), /description/],
    [
      "an invalid question",
      SPEC.replace("type: noul", "type: maybe"),
      /type must be choice, score or noul/,
    ],
    [
      "a keep on an unknown question",
      SPEC.replace('keep: ["relevant>=0.7"]', 'keep: ["other>=1"]'),
      /not in the question set/,
    ],
    ["a threshold without a why", SPEC.replace(/, why: "[^"]*"/, ""), /why/],
    ["bad YAML", "description: [unclosed", /not valid YAML/],
  ])("rejects %s", (_, text, message) => {
    expect(() => parseSpec(text, "/x/s.yaml", "repo")).toThrow(message)
  })

  it("rejects a file name that can't be a fixture namespace", () => {
    expect(() => parseSpec(SPEC, "/x/Bad Name.yaml", "repo")).toThrow(/lowercase/)
  })
})

describe("loadSpec / listSpecs", () => {
  it("resolves repo before user before bundled, and marks shadowed names", () => {
    const d = dirs()
    writeTree(d.repo, { "specs/relevance.yaml": SPEC })
    writeTree(d.bundled, {
      "specs/relevance.yaml": SPEC.replace("Which files", "Bundled:"),
      "specs/flaky.yaml": SPEC,
    })
    expect(loadSpec("relevance", d.dirs, "/").origin).toBe("repo")
    expect(loadSpec("flaky", d.dirs, "/").origin).toBe("bundled")
    const listing = listSpecs(d.dirs)
    expect(listing.map((s) => [s.name, s.origin, s.shadowed ?? false])).toEqual([
      ["relevance", "repo", false],
      ["flaky", "bundled", false],
      ["relevance", "bundled", true],
    ])
  })

  it("loads by path, relative to cwd", () => {
    const cwd = temp({ "my/spec.yaml": SPEC })
    expect(loadSpec("my/spec.yaml", dirs().dirs, cwd).origin).toBe("path")
  })

  it("lists what exists when a name is not found", () => {
    const d = dirs()
    writeTree(d.user, { "specs/relevance.yaml": SPEC })
    expect(() => loadSpec("nope", d.dirs, "/")).toThrow(/Available: relevance/)
  })

  it("lists invalid specs with their error rather than hiding them", () => {
    const d = dirs()
    writeTree(d.repo, { "specs/broken.yaml": "questions: {}\n" })
    expect(listSpecs(d.dirs)[0]).toMatchObject({
      name: "broken",
      error: expect.stringContaining("invalid spec"),
    })
  })
})
