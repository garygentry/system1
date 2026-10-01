import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { gitRepo, useTempDirs, writeTree } from "../testkit/tmp.js"
import { adoptedCheck, capturedCheck, emulatedCheck } from "./doctor-adopt.js"

const temp = useTempDirs()
const ROOT = fileURLToPath(new URL("../../../..", import.meta.url))
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

  it("reports egress on and the bundled opt-out as advisory warnings", () => {
    const dir = gitRepo(temp(), {
      "src/on.ts": module("on"),
      "src/bundled.ts": module(
        "off",
        'createPolicyRuntime({ module: "bundled", egress: EGRESS })\n',
      ),
      "src/elsewhere.ts": 'createPolicyRuntime({ module: "bundled", egress: grant })\n',
    })
    const check = adoptedCheck(dir)
    expect(check).toMatchObject({ status: "warn", advisory: true })
    expect(check.detail).toMatch(/^2 adopted modules;/)
    expect(check.detail).toMatch(/runtime egress ON in src\/on\.ts/)
    expect(check.detail).toMatch(/"bundled"\) in src\/bundled\.ts, src\/elsewhere\.ts/)
  })

  it("is quiet on adopt's own output: the templates as copied, all off", () => {
    const templates = join(ROOT, "plugins/system1/skills/adopt/references/templates")
    const files = Object.fromEntries(
      [
        ...readdirSync(join(templates, "ts")).map((f) => [
          `src/triage/${f}`,
          join(templates, "ts", f),
        ]),
        ...readdirSync(join(templates, "python")).map((f) => [
          `app/${f}`,
          join(templates, "python", f),
        ]),
      ].map(([to, from]) => [to, readFileSync(from as string, "utf8")]),
    )
    expect(adoptedCheck(gitRepo(temp(), files))).toMatchObject({
      status: "ok",
      detail: "2 adopted modules, runtime egress off in all",
    })
  })

  it("finds untracked modules, non-ASCII paths and an app's own templates/, not tests or docs", () => {
    const dir = gitRepo(temp(), {
      "src/policy.test.ts": module("on"),
      "skills/adopt/references/templates/ts/policy.ts": module("on"),
      "docs/runtime.md": module("on"),
      "src/notes.ts": "// see createPolicyRuntime({ egress }) in the docs\n",
    })
    expect(adoptedCheck(dir)).toMatchObject({ status: "ok", detail: "no adopted modules" })
    writeTree(dir, {
      "src/new.ts": module("on"),
      "src/políticas/policy.ts": module("on"),
      "src/templates/policy.ts": module("on"),
    })
    const { detail } = adoptedCheck(dir)
    expect(detail).toMatch(/^3 adopted modules/)
    expect(detail).toMatch(/src\/new\.ts/)
  })

  it("finds a bundled opt-out however the call is written, and not one in a comment or docstring", () => {
    const dir = gitRepo(temp(), {
      "src/split.ts": 'createPolicyRuntime(\n  { module: "bundled", egress: g },\n)\n',
      "src/generic.ts": 'createPolicyRuntime<X>({ module: "bundled", egress: g })\n',
      "src/apart.ts": 'const o = { module: "bundled", egress: g }\ncreatePolicyRuntime(o)\n',
      "src/commented.ts": `${module("off")}// never pass module: "bundled"\n/* module: "bundled" */\n`,
      "app/doc.py": '"""\ncreatePolicyRuntime({ module: "bundled" })\n"""\n',
    })
    const { detail } = adoptedCheck(dir)
    expect(detail).toMatch(
      /^1 adopted module; module lock opted out \("bundled"\) in src\/apart\.ts, src\/generic\.ts, src\/split\.ts$/,
    )
  })

  it("isn't fooled by a comment marker inside a string", () => {
    const dir = gitRepo(temp(), {
      "src/glob.ts":
        'const g = "src/*.ts"\ncreatePolicyRuntime({ module: "bundled", egress: e })\n/** doc */\nfoo() // module: "bundled"\n',
      "src/trailing.ts": 'foo() // module: "bundled"\n',
    })
    expect(adoptedCheck(dir).detail).toBe('module lock opted out ("bundled") in src/glob.ts')
  })

  it("names no module count when only an opt-out is found", () => {
    const dir = gitRepo(temp(), { "src/apart.ts": 'f({ module: "bundled" })\n' })
    expect(adoptedCheck(dir).detail).toBe('module lock opted out ("bundled") in src/apart.ts')
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
  it("is fine with no captures, and with an ignored compare directory", () => {
    expect(capturedCheck(gitRepo(temp(), { "a.ts": "x" }))).toMatchObject({ status: "ok" })
    const dir = gitRepo(temp(), { ".gitignore": ".system1/compare/\n" })
    writeTree(dir, {
      ".system1/compare/triage/captured.jsonl": "{}\n",
      ".system1/compare/triage/fixtures/triage/abc.json": "{}\n",
    })
    expect(capturedCheck(dir)).toMatchObject({
      status: "ok",
      detail: ".system1/compare/ ignored by git",
    })
  })

  it("reports nothing for a compare directory holding only empty directories", () => {
    const dir = gitRepo(temp(), { "a.ts": "x" })
    mkdirSync(join(dir, ".system1/compare/triage/probe"), { recursive: true })
    expect(capturedCheck(dir)).toMatchObject({ status: "ok", detail: "no shadow captures" })
  })

  it("warns when git would commit a capture, a probe or compare's recorded answers", () => {
    const dir = gitRepo(temp(), { "a.ts": "x" })
    writeTree(dir, { ".system1/compare/triage/fixtures/triage/abc.json": "{}\n" })
    const check = capturedCheck(dir)
    expect(check).toMatchObject({ status: "warn", advisory: true })
    expect(check.detail).toBe("raw inputs git would commit in .system1/compare/triage/")
    expect(check.fix).toMatch(/\.gitignore/)
    expect(check.fix).not.toMatch(/rm/)
  })

  it("finds a committed file under an ignored directory, beside untracked ones", () => {
    const dir = gitRepo(temp(), { ".system1/compare/triage/fixtures/triage/bbb.json": "{}\n" })
    // Ignored only after one was committed.
    writeTree(dir, {
      ".gitignore": ".system1/compare/\n",
      ".system1/compare/triage/fixtures/triage/aaa.json": "{}\n",
    })
    const check = capturedCheck(dir)
    expect(check).toMatchObject({ status: "warn" })
    expect(check.detail).toBe("raw inputs already committed in .system1/compare/triage/")
    expect(check.fix).toMatch(/git rm -r --cached/)
  })
})
