// Publish the three packages at the version the catalog stamped.
//
//   node tools/release-publish.mjs --provenance --skip-check   the release workflow (0022)
//   pnpm release:publish [--dry-run] [--otp <code>]            break-glass: from your npm login
//
// Refuses unless the working tree is clean and `release:check` passes (the
// workflow ran it in its `verify` job, so it passes --skip-check). Then it runs
// `npm publish` (not pnpm: see docs/contributing/release.md) for core → cli →
// pi, skipping any package npm already serves at this version, so an
// interrupted run can simply be repeated. Last, it waits until npm serves all
// three.
//
// In CI the credential is the workflow's OIDC token, exchanged by npm itself
// through trusted publishing; no token is stored anywhere. The job only runs
// once the maintainer approves the `release` environment. It never tags or
// pushes.
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import {
  isPublished,
  manifest,
  npmEnv,
  PACKAGES,
  ROOT,
  releaseVersion,
  waitUntilServed,
} from "./release-lib.mjs"

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    otp: { type: "string" },
    provenance: { type: "boolean" },
    "skip-check": { type: "boolean" },
  },
})
const dryRun = values["dry-run"] === true

const fail = (message) => {
  console.error(`release:publish: ${message}`)
  process.exit(1)
}

const { version, error } = releaseVersion()
if (error) fail(error)

const clean = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
if (clean.status !== 0 || clean.stdout.trim() !== "") fail("the working tree is not clean")
const todo = PACKAGES.filter((pkg) => !isPublished(manifest(pkg).name, version))
if (todo.length === 0) fail(`npm already serves all three packages at ${version}`)

const mode = `${version}${dryRun ? " (dry run)" : ""}`
if (values["skip-check"]) {
  console.log(`release:publish ${mode}: release:check skipped (--skip-check)`)
} else {
  console.log(`release:publish ${mode}: running release:check…`)
  const check = spawnSync("node", [join(ROOT, "tools/release-check.mjs")], { stdio: "inherit" })
  if (check.status !== 0) fail("release:check failed; nothing was published")
}

for (const pkg of PACKAGES) {
  const { name } = manifest(pkg)
  if (!todo.includes(pkg)) {
    console.log(`skip  ${name}@${version} — already on npm`)
    continue
  }
  // --provenance makes npm fail rather than publish without it (it needs CI's OIDC token).
  const args = [
    "publish",
    ...(values.provenance ? ["--provenance"] : []),
    ...(dryRun ? ["--dry-run"] : []),
    ...(values.otp ? ["--otp", values.otp] : []),
  ]
  console.log(
    `\n$ (cd packages/${pkg} && npm ${args.join(" ").replace(values.otp ?? "\0", "<otp>")})`,
  )
  const r = spawnSync("npm", args, {
    cwd: join(ROOT, "packages", pkg),
    env: npmEnv(),
    stdio: "inherit",
  })
  if (r.status !== 0)
    fail(
      `publishing ${name} failed. Fix it and run release:publish again (or re-run the job): packages already on npm are skipped.`,
    )
}

if (dryRun) {
  console.log("\nrelease:publish: dry run done; nothing was published")
  process.exit(0)
}

const names = PACKAGES.map((pkg) => manifest(pkg).name)
const missing = waitUntilServed(names, version)
if (missing.length > 0) {
  fail(
    `npm still does not serve ${missing.join(", ")} at ${version} after 180 s. The publish may still land: check with \`npm view <name>@${version} version\`, and don't push main until all three are served.`,
  )
}
console.log(`\nrelease:publish: npm serves all three at ${version}. Next: push main.`)
// The release workflow's run page shows this.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `## Published ${version}`,
      "",
      ...names.map(
        (name) => `- [\`${name}@${version}\`](https://www.npmjs.com/package/${name}/v/${version})`,
      ),
      "",
      "npm serves all three. Next: push `main`, then verify from the published artifacts.",
      "",
    ].join("\n"),
  )
}
