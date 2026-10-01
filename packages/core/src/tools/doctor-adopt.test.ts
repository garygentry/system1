import { describe, expect, it } from "vitest"
import { gitRepo, useTempDirs, writeTree } from "../testkit/tmp.js"
import { adoptedCheck, capturedCheck, emulatedCheck } from "./doctor-adopt.js"

const temp = useTempDirs()
const MARK = "system1: runtime egress"
const module = (value: string, extra = "") =>
  `export const EGRESS: "on" | "off" = "${value}" // ${MARK}\n${extra}`

describe("doctor: adopted", () => {
  it("reports no modules, and modules all off", () => {
    expect(adoptedCheck(gitRepo(temp(), { "a.ts": "x" }))).toMatchObject({
      status: "ok",
      detail: "no adopted modules",
    })
    const dir = gitRepo(temp(), {
      "src/policy.ts": module("off"),
      "app/policy.py": `EGRESS: Final = "off"  # ${MARK}\n`,
    })
    expect(adoptedCheck(dir)).toMatchObject({
      status: "ok",
      detail: "2 adopted modules, runtime egress off in all",
    })
  })

  it("reports egress on, the bundled opt-out and an unmarked runtime call, as advisory warnings", () => {
    const dir = gitRepo(temp(), {
      "src/on.ts": module("on"),
      "src/bundled.ts": module(
        "off",
        'createPolicyRuntime({ module: "bundled", egress: EGRESS })\n',
      ),
      "src/raw.ts": "createPolicyRuntime({ egress: x })\n",
    })
    const check = adoptedCheck(dir)
    expect(check).toMatchObject({ status: "warn", advisory: true })
    expect(check.detail).toMatch(/runtime egress ON in src\/on\.ts/)
    expect(check.detail).toMatch(/"bundled"\) in src\/bundled\.ts/)
    expect(check.detail).toMatch(/no marked EGRESS line in src\/raw\.ts/)
  })

  it("finds untracked modules, and leaves out tests, templates and docs", () => {
    const dir = gitRepo(temp(), {
      "src/policy.test.ts": module("on"),
      "skills/adopt/references/templates/ts/policy.ts": module("on"),
      "docs/runtime.md": module("on"),
    })
    expect(adoptedCheck(dir)).toMatchObject({ status: "ok", detail: "no adopted modules" })
    writeTree(dir, { "src/new.ts": module("on") })
    expect(adoptedCheck(dir).detail).toMatch(/ON in src\/new\.ts/)
  })

  it("says it didn't look outside a git work tree", () => {
    expect(adoptedCheck(temp({ "a.ts": module("on") })).detail).toMatch(/not a git work tree/)
  })
})

describe("doctor: emulated", () => {
  it("lists the emulated baselines allowed, or none", () => {
    expect(emulatedCheck([])).toMatchObject({
      status: "ok",
      detail: "no emulated baseline allowed",
    })
    expect(emulatedCheck([{ id: "emulated:anthropic/claude-haiku-4.5" }]).detail).toMatch(
      /emulated:anthropic\/claude-haiku-4\.5/,
    )
  })
})

describe("doctor: captured", () => {
  it("is fine with no captures, and with ignored ones", () => {
    expect(capturedCheck(gitRepo(temp(), { "a.ts": "x" }))).toMatchObject({ status: "ok" })
    const dir = gitRepo(temp(), { ".gitignore": ".system1/compare/*/captured.jsonl\n" })
    writeTree(dir, { ".system1/compare/triage/captured.jsonl": "{}\n" })
    expect(capturedCheck(dir)).toMatchObject({
      status: "ok",
      detail: "1 capture(s), all ignored by git",
    })
  })

  it("warns when git would commit a capture of raw inputs", () => {
    const dir = gitRepo(temp(), { "a.ts": "x" })
    writeTree(dir, { ".system1/compare/triage/captured.jsonl": "{}\n" })
    const check = capturedCheck(dir)
    expect(check).toMatchObject({ status: "warn", advisory: true })
    expect(check.detail).toMatch(/\.system1\/compare\/triage\/captured\.jsonl/)
    expect(check.fix).toMatch(/\.gitignore/)
  })
})
