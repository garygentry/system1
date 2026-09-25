// Publish the three packages at the version the catalog stamped.
//
//   pnpm release:publish [--dry-run] [--otp <code>]
//
// Refuses unless the working tree is clean and `release:check` passes. Then it
// publishes core → cli → pi with `npm publish` (not pnpm: see
// docs/contributing/release.md § 4), skipping any package npm already serves at
// this version, so a run interrupted by an expired OTP can simply be repeated.
// Finally it checks npm serves all three. It never tags or pushes.
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGES = ["core", "cli", "pi"]

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean" }, otp: { type: "string" } },
})
const dryRun = values["dry-run"] === true

const fail = (message) => {
  console.error(`release:publish: ${message}`)
  process.exit(1)
}
const run = (cmd, args, cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe" }).trim()

const manifest = (pkg) =>
  JSON.parse(readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8"))
const version = manifest("cli").version
for (const pkg of PACKAGES) {
  if (manifest(pkg).version !== version)
    fail(`packages/${pkg} is at ${manifest(pkg).version}, cli at ${version}: run pnpm generate`)
}

/** True when npm already serves `name@version`. */
const published = (name) => {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" })
  return r.status === 0 && r.stdout.trim() === version
}

if (run("git", ["status", "--porcelain"]) !== "") fail("the working tree is not clean")
const todo = PACKAGES.filter((pkg) => !published(manifest(pkg).name))
if (todo.length === 0) fail(`npm already serves all three packages at ${version}`)

console.log(`release:publish ${version}${dryRun ? " (dry run)" : ""}: running release:check…`)
const check = spawnSync("node", [join(ROOT, "tools/release-check.mjs")], { stdio: "inherit" })
if (check.status !== 0) fail("release:check failed; nothing was published")

for (const pkg of PACKAGES) {
  const { name } = manifest(pkg)
  if (!todo.includes(pkg)) {
    console.log(`skip  ${name}@${version} — already on npm`)
    continue
  }
  const args = [
    "publish",
    ...(dryRun ? ["--dry-run"] : []),
    ...(values.otp ? ["--otp", values.otp] : []),
  ]
  console.log(
    `\n$ (cd packages/${pkg} && npm ${args.join(" ").replace(values.otp ?? "\0", "<otp>")})`,
  )
  const r = spawnSync("npm", args, { cwd: join(ROOT, "packages", pkg), stdio: "inherit" })
  if (r.status !== 0) {
    fail(
      `publishing ${name} failed. Fix it and run release:publish again: packages already on npm are skipped.`,
    )
  }
}

if (dryRun) {
  console.log(`\nrelease:publish: dry run done; nothing was published`)
} else {
  // The registry lags a publish by a few seconds to a minute (0.4.0: ~40 s),
  // so wait for it rather than report a publish that worked as a failure.
  const WAIT_MS = 180_000
  const STEP_MS = 10_000
  const names = PACKAGES.map((pkg) => manifest(pkg).name)
  let missing = names.filter((name) => !published(name))
  for (let waited = 0; missing.length > 0 && waited < WAIT_MS; waited += STEP_MS) {
    console.log(`waiting for npm to serve ${missing.join(", ")} at ${version}…`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STEP_MS)
    missing = missing.filter((name) => !published(name))
  }
  if (missing.length > 0) {
    fail(
      `npm still does not serve ${missing.join(", ")} at ${version} after ${WAIT_MS / 1000} s. The publish may still land: check with \`npm view <name>@${version} version\` before tagging, and don't push until all three are served.`,
    )
  }
  console.log(
    `\nrelease:publish: npm serves all three at ${version}. Next: tag and push (release.md § 5).`,
  )
}
