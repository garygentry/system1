import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { useTempDirs, writeTree } from "../testkit/tmp.js"
import {
  assertExamples,
  exampleProblems,
  listSpecs,
  loadSpec,
  parseQuestionSet,
  parseSpec,
} from "./spec.js"

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

describe("spec examples", () => {
  const withExamples = (examples: string) => `${SPEC}examples:\n${examples}`

  it("accepts text or file states and every expect form", () => {
    const spec = parseSpec(
      withExamples(`  - { id: a, state: "text", expect: { relevant: true } }
  - { id: b, file: "src/x.ts:1-5", expect: { relevant: ">=0.7" } }
  - { id: c, state: "t", expect: { relevant: undecided } }
  - { id: d, state: "t" }
`),
      "s.yaml",
      "repo",
    )
    expect(spec.examples).toHaveLength(4)
  })

  it("collects every example problem at once, without stopping the spec from loading", () => {
    const spec = parseSpec(
      withExamples(`  - { id: a, expect: { relevant: true } }
  - { id: a, state: "x", file: "y" }
  - { id: c, state: "x", expect: { nope: true } }
  - { id: d, state: "x", expect: { relevant: fix } }
`),
      "s.yaml",
      "repo",
    )
    expect(() => assertExamples(spec)).toThrow(
      /exactly one of state or file[\s\S]*duplicate id[\s\S]*"nope", which is not a question[\s\S]*a noul takes true or false/,
    )
  })

  it("accepts a structured state, and refuses example files outside the repo or missing", () => {
    const root = temp({ "src/a.ts": "x" })
    const spec = parseSpec(
      withExamples(`  - { id: row, state: { title: "login broken" }, expect: { relevant: true } }
  - { id: ok, file: "src/a.ts" }
  - { id: up, file: "../../etc/hostname" }
  - { id: abs, file: "/etc/hostname" }
  - { id: gone, file: "src/missing.ts" }
`),
      "s.yaml",
      "repo",
    )
    expect(exampleProblems(spec, root)).toEqual([
      "examples[2] (up): file ../../etc/hostname is outside the repo",
      "examples[3] (abs): file /etc/hostname is outside the repo",
      "examples[4] (gone): file src/missing.ts does not exist",
    ])
  })

  it("checks choice keys and score levels against the question", () => {
    const spec = `description: x
questions:
  kind: { type: choice, instructions: K., criteria: { fix: F., feat: N. } }
  risk: { type: score, instructions: R., criteria: [Low., High.] }
examples:
  - { id: a, state: x, expect: { kind: bug, risk: 5 } }
`
    expect(() => assertExamples(parseSpec(spec, "s.yaml", "repo"))).toThrow(
      /"bug", which is not one of its options \(fix, feat\)[\s\S]*a level 0–1/,
    )
  })
})

describe("parseQuestionSet", () => {
  it("reads a YAML or JSON question map", () => {
    expect(parseQuestionSet("a: { type: noul, instructions: A. }", "q")).toHaveProperty(
      "a.type",
      "noul",
    )
    expect(parseQuestionSet('{"a":{"type":"noul","instructions":"A."}}', "q")).toHaveProperty("a")
  })

  it("accepts a spec-shaped document, taking its questions", () => {
    expect(Object.keys(parseQuestionSet(SPEC, "q"))).toEqual(["relevant"])
  })

  it("rejects invalid YAML and invalid questions with the source named", () => {
    expect(() => parseQuestionSet("a: [", "--questions q.yaml")).toThrow(
      /--questions q.yaml: not valid/,
    )
    expect(() => parseQuestionSet("a: { type: noul }", "--questions -")).toThrow(/--questions -:/)
  })
})
