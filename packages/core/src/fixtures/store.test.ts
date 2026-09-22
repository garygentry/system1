import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseDecisionResponse } from "../model/validate.js"
import { guardrailQuestions, guardrailResponse } from "../testdata/index.js"
import { canonicalJson, FixtureStore, fixtureKey } from "./store.js"

const dirs: string[] = []
const tempStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "decisions-fixtures-"))
  dirs.push(dir)
  return new FixtureStore(dir)
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const request = {
  model: "typesafe/jev-1.13",
  state: { command: "ls -la src/" },
  questions: guardrailQuestions(),
}
const response = () => parseDecisionResponse(guardrailResponse(), request.questions, request.model)

describe("fixture key", () => {
  it("ignores object key order at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ f: 1, e: 2 }] } })).toBe(
      '{"a":{"c":[{"e":2,"f":1}],"d":2},"b":1}',
    )
    const reordered = { questions: request.questions, state: request.state, model: request.model }
    expect(fixtureKey(reordered)).toBe(fixtureKey(request))
  })

  it("changes with the model, the state or the questions", () => {
    const base = fixtureKey(request)
    expect(fixtureKey({ ...request, model: "typesafe/jev-1.13-20260917" })).not.toBe(base)
    expect(fixtureKey({ ...request, state: { command: "ls" } })).not.toBe(base)
    expect(
      fixtureKey({ ...request, questions: { only: { type: "noul", instructions: "x" } } }),
    ).not.toBe(base)
  })
})

describe("FixtureStore", () => {
  it("round-trips a recording", () => {
    const store = tempStore()
    expect(store.lookup("adhoc", request)).toBeUndefined()
    const written = store.record("adhoc", request, response(), new Date("2026-09-22T00:00:00Z"))
    const found = store.lookup("adhoc", request)
    expect(found).toEqual(written)
    expect(found?.recordedAt).toBe("2026-09-22T00:00:00.000Z")
    expect(readdirSync(join(store.dir, "adhoc"))).toEqual([`${written.key}.json`])
  })

  it("keeps namespaces apart", () => {
    const store = tempStore()
    store.record("relevance", request, response())
    expect(store.lookup("adhoc", request)).toBeUndefined()
  })

  it("refuses namespaces that could escape the directory", () => {
    const store = tempStore()
    expect(() => store.lookup("../etc", request)).toThrow(/Invalid fixture namespace/)
    expect(() => store.lookup("", request)).toThrow(/Invalid fixture namespace/)
  })
})
