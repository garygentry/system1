// The gate between a green `pnpm check` and `npm publish`.
//
//   pnpm release:check
//
// Builds, packs all three packages, installs the CLI tarball into a scratch
// prefix and exercises it there, imports the runtime adopted code uses from the
// core tarball, then checks the Pi tarball carries every skill.
// Nothing here touches the network or the real npm registry.
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const work = mkdtempSync(join(tmpdir(), "system1-release-"))
const packs = join(work, "packs")
const prefix = join(work, "prefix")
const repo = join(work, "repo")
mkdirSync(packs, { recursive: true })
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts })

const steps = []
const step = (name, fn) => {
  try {
    const detail = fn() ?? ""
    steps.push({ name, ok: true, detail })
    console.log(`ok    ${name}${detail ? ` — ${detail}` : ""}`)
  } catch (error) {
    const message = String(error.stdout ?? "") + String(error.stderr ?? error.message ?? error)
    steps.push({ name, ok: false, detail: message.trim().split("\n").slice(-3).join(" ") })
    console.error(`FAIL  ${name} — ${steps.at(-1).detail}`)
  }
}

step("build", () => {
  run("pnpm", ["-s", "build"], { cwd: ROOT })
  return "workspace built"
})

for (const pkg of ["cli", "core", "pi"]) {
  step(`pack ${pkg}`, () => {
    run("npm", ["pack", "--pack-destination", packs], { cwd: join(ROOT, "packages", pkg) })
    const file = readdirSync(packs).find((f) =>
      f.includes(pkg === "cli" ? "system1-0" : `system1-${pkg}-`),
    )
    if (!file) throw new Error("no tarball produced")
    return file
  })
}

step("install the CLI tarball", () => {
  const file = readdirSync(packs).find((f) => /system1-0\.\d+\.\d+\.tgz$/.test(f))
  run("npm", ["i", "-g", "--prefix", prefix, join(packs, file)], { cwd: work })
  return file
})

const decide = join(prefix, "bin", "decide")
step("installed CLI reports its version", () => {
  const version = run(decide, ["version"]).trim()
  const expected = JSON.parse(
    run("node", ["-e", "console.log(JSON.stringify(require('./package.json').version))"], {
      cwd: join(ROOT, "packages/cli"),
    }).trim(),
  )
  if (version !== expected) throw new Error(`installed ${version}, expected ${expected}`)
  return version
})

step("installed CLI runs offline in a fresh repo", () => {
  run("git", ["init", "-q", repo], { cwd: work })
  const out = run(decide, ["doctor", "--format", "brief"], {
    cwd: repo,
    env: { ...process.env, SYSTEM1_REPLAY: "1", OPENROUTER_API_KEY: "" },
  })
  if (!out.startsWith("decide doctor:")) throw new Error(out.slice(0, 120))
  return out.split("\n")[0].slice(0, 60)
})

// Replay only: no key, no consent, no network. Answers come from fixtures
// committed in this repo, so the shipped bundle is exercised end to end.
const offline = { ...process.env, SYSTEM1_REPLAY: "1", OPENROUTER_API_KEY: "" }

step("installed CLI replays a many run", () => {
  const dir = join(work, "smoke")
  cpSync(join(ROOT, "tools/smoke/fixture-repo"), dir, { recursive: true })
  run("git", ["init", "-q", dir], { cwd: work })
  const out = run(decide, ["many", "--spec", "smoke", "--format", "brief"], {
    cwd: dir,
    env: offline,
  })
  if (!out.startsWith("decide many: 1 kept of 3")) throw new Error(out.slice(0, 120))
  return out.split("\n")[0].slice(0, 60)
})

// The Claude plugin's UserPromptSubmit hook runs this on every prompt (0018).
step("installed CLI answers the routing hook", () => {
  const event = JSON.stringify({
    prompt: "Is every item in TASK.md done? Check it against the diff.",
  })
  const out = run(decide, ["route", "--hook", "--format", "brief"], {
    cwd: repo,
    env: offline,
    input: event,
  })
  if (!out.includes("system1:ask")) throw new Error(`no hint: ${out.slice(0, 120)}`)
  const quiet = run(decide, ["route", "--hook", "--format", "brief"], {
    cwd: repo,
    env: offline,
    input: JSON.stringify({ prompt: "rename this function to fooBar" }),
  })
  if (quiet.trim() !== "") throw new Error(`hinted a near miss: ${quiet.slice(0, 120)}`)
  return "hints a done-check, quiet on a rename"
})

step("installed CLI replays an adopted cookbook recipe", () => {
  const dir = join(work, "cookbook")
  mkdirSync(join(dir, ".system1/specs"), { recursive: true })
  run("git", ["init", "-q", dir], { cwd: work })
  cpSync(join(ROOT, "cookbook/ci-failure.yaml"), join(dir, ".system1/specs/ci-failure.yaml"))
  cpSync(join(ROOT, "cookbook/fixtures/ci-failure"), join(dir, ".system1/fixtures/ci-failure"), {
    recursive: true,
  })
  const out = run(decide, ["spec", "check", "ci-failure", "--format", "brief"], {
    cwd: dir,
    env: offline,
  })
  if (!out.includes("PASSED")) throw new Error(out.slice(0, 120))
  return out.split("\n")[0].slice(0, 60)
})

// Adopted Python modules spawn `decide runtime` and check its protocol first.
step("installed CLI speaks the runtime protocol", () => {
  const out = JSON.parse(run(decide, ["runtime", "--protocol"], { cwd: repo, env: offline }))
  if (out.protocol !== 1) throw new Error(`protocol ${out.protocol}`)
  return `protocol ${out.protocol}, ${out.version}`
})

// Adopted TypeScript imports @garygentry/system1-core/runtime. Unpack the core
// tarball where packages/core's own dependencies resolve (no registry), and
// import through the package's exports map, as an application would.
step("core tarball exports the runtime", () => {
  const file = readdirSync(packs).find((f) => f.includes("system1-core-"))
  const dir = join(ROOT, "packages/core/node_modules/.release-check")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    run("tar", ["-xzf", join(packs, file), "-C", dir])
    const probe = join(dir, "package", "probe.mjs")
    writeFileSync(
      probe,
      'const r = await import("@garygentry/system1-core/runtime")\n' +
        'if (typeof r.createPolicyRuntime !== "function") throw new Error("no createPolicyRuntime")\n' +
        "console.log(Object.keys(r).length)\n",
    )
    return `${run("node", [probe]).trim()} exports`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

step("CLI tarball carries its third-party notices", () => {
  const file = readdirSync(packs).find((f) => /system1-0\.\d+\.\d+\.tgz$/.test(f))
  const list = run("tar", ["-tzf", join(packs, file)])
  if (!list.includes("package/THIRD-PARTY-NOTICES.md")) throw new Error("notices missing")
  return "present"
})

step("Pi tarball carries every skill", () => {
  const file = readdirSync(packs).find((f) => f.includes("system1-pi-"))
  const list = run("tar", ["-tzf", join(packs, file)]).split("\n")
  const authored = readdirSync(join(ROOT, "plugins/system1/skills"))
  const missing = authored.filter((name) => !list.includes(`package/skills/${name}/SKILL.md`))
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`)
  return `${authored.length} skills`
})

const failed = steps.filter((s) => !s.ok)
if (failed.length === 0) rmSync(work, { recursive: true, force: true })
console.log(
  failed.length === 0
    ? `\nrelease:check passed (${steps.length} steps)`
    : `\nrelease:check FAILED (${failed.length} of ${steps.length}); artifacts kept in ${work}`,
)
process.exitCode = failed.length === 0 ? 0 : 1
