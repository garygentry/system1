#!/usr/bin/env node
// A repo-shaped directory for adopt's code templates, with no `.git`:
//
//   node tools/smoke/adopt-repo.mjs <ts|python> <dir>
//
// - the template's module files in <dir>/src (TS) or <dir>/app (Python);
// - the core package linked as an installed dependency (<dir>/node_modules);
// - a recorded answer for the template's first example in
//   <dir>/.system1/fixtures/ticket-triage/.
//
// The answer is a stand-in for one `decide spec check --live` would record,
// written through the engine's own fixture store, so its key is the real one.
// It is keyed on the TypeScript module's questions and state for both
// languages, so the Python suite replays it only while its questions match.
// Used by tools/templates.test.ts and the Codex smoke (tools/smoke/codex.sh).
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const TEMPLATES = join(REPO, "plugins/system1/skills/adopt/references/templates")
const CORE = join(REPO, "packages/core")

const [lang, target] = process.argv.slice(2)
if (!["ts", "python"].includes(lang) || !target) {
  console.error("usage: adopt-repo.mjs <ts|python> <dir>")
  process.exit(2)
}
const dir = resolve(target)
// Replace only a directory this script made (or none): never an arbitrary one.
const MADE_HERE = ".adopt-repo"
if (existsSync(dir) && readdirSync(dir).length > 0 && !existsSync(join(dir, MADE_HERE))) {
  console.error(`adopt-repo: ${dir} exists and wasn't made by this script; refusing to replace it`)
  process.exit(2)
}
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, MADE_HERE), "")
cpSync(join(TEMPLATES, lang), join(dir, lang === "ts" ? "src" : "app"), { recursive: true })
mkdirSync(join(dir, "node_modules/@garygentry"), { recursive: true })
symlinkSync(CORE, join(dir, "node_modules/@garygentry/system1-core"), "dir")

const record = join(dir, ".record")
mkdirSync(record)
cpSync(join(TEMPLATES, "ts/policy.ts"), join(record, "policy.ts"))
writeFileSync(
  join(record, "record.mjs"),
  `import { FixtureStore } from ${JSON.stringify(join(CORE, "dist/fixtures/store.js"))}
import { MODEL, QUESTIONS, SPEC, toState } from "./policy.ts"
const ticket = {
  subject: "Dashboard down for our whole team",
  body: "Since 9am every page returns a 500 error and nobody here can work.",
}
new FixtureStore(${JSON.stringify(join(dir, ".system1/fixtures"))}).record(
  SPEC,
  { model: MODEL, state: toState(ticket), questions: QUESTIONS },
  {
    model: "typesafe/jev-1.13",
    answers: {
      urgent: { type: "noul", noul: 0.93 },
      area: { type: "choice", choice: "bug", probabilities: { bug: 0.88, billing: 0.04, account: 0.04, other: 0.04 }, confidence: 0.8 },
    },
    usage: { input_tokens: 180, output_tokens: 0, cost: 0.00003 },
  },
)
`,
)
// Run from inside the directory, so the module's import resolves through the link.
const done = spawnSync(process.execPath, [join(record, "record.mjs")], {
  cwd: dir,
  stdio: "inherit",
})
rmSync(record, { recursive: true, force: true })
process.exit(done.status ?? 1)
