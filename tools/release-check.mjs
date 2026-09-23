// The gate between a green `pnpm check` and `npm publish`.
//
//   pnpm release:check
//
// Builds, packs all three packages, installs the CLI tarball into a scratch
// prefix and exercises it there, then checks the Pi tarball carries the skills.
// Nothing here touches the network or the real npm registry.
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
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

step("CLI tarball carries its third-party notices", () => {
  const file = readdirSync(packs).find((f) => /system1-0\.\d+\.\d+\.tgz$/.test(f))
  const list = run("tar", ["-tzf", join(packs, file)])
  if (!list.includes("package/THIRD-PARTY-NOTICES.md")) throw new Error("notices missing")
  return "present"
})

step("Pi tarball carries the skills", () => {
  const file = readdirSync(packs).find((f) => f.includes("system1-pi-"))
  const list = run("tar", ["-tzf", join(packs, file)]).split("\n")
  const skills = list.filter((f) => f.endsWith("SKILL.md"))
  if (skills.length < 3) throw new Error(`only ${skills.length} skills`)
  return `${skills.length} skills`
})

const failed = steps.filter((s) => !s.ok)
if (failed.length === 0) rmSync(work, { recursive: true, force: true })
console.log(
  failed.length === 0
    ? `\nrelease:check passed (${steps.length} steps)`
    : `\nrelease:check FAILED (${failed.length} of ${steps.length}); artifacts kept in ${work}`,
)
process.exitCode = failed.length === 0 ? 0 : 1
