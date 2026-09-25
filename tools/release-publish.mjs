// Publish, or stage, the three packages at the version the catalog stamped.
//
//   pnpm release:publish [--dry-run] [--otp <code>]     break-glass: live from your npm login
//   node tools/release-publish.mjs --stage [--skip-check]   the release workflow (0022)
//
// Refuses unless the working tree is clean and `release:check` passes (the
// workflow ran it in an earlier job, so it passes --skip-check). Then it runs
// `npm publish` (not pnpm: see docs/contributing/release.md) for core → cli →
// pi, skipping any package npm already serves at this version, so an
// interrupted run can simply be repeated.
//
// --stage runs `npm stage publish` instead: nothing goes live until a
// maintainer approves each stage with 2FA (`pnpm release:approve`). In CI the
// credential is the workflow's OIDC token, exchanged by npm itself; no token
// is stored anywhere. It never tags or pushes.
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import {
  isPublished,
  manifest,
  PACKAGES,
  ROOT,
  releaseVersion,
  stageIdFrom,
  waitUntilServed,
} from "./release-lib.mjs"

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    otp: { type: "string" },
    stage: { type: "boolean" },
    "skip-check": { type: "boolean" },
  },
})
const dryRun = values["dry-run"] === true
const stage = values.stage === true

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

const mode = `${stage ? "stage " : ""}${version}${dryRun ? " (dry run)" : ""}`
if (values["skip-check"]) {
  console.log(`release:publish ${mode}: release:check skipped (--skip-check)`)
} else {
  console.log(`release:publish ${mode}: running release:check…`)
  const check = spawnSync("node", [join(ROOT, "tools/release-check.mjs")], { stdio: "inherit" })
  if (check.status !== 0) fail("release:check failed; nothing was published")
}

const staged = []
for (const pkg of PACKAGES) {
  const { name } = manifest(pkg)
  if (!todo.includes(pkg)) {
    console.log(`skip  ${name}@${version} — already on npm`)
    continue
  }
  const args = [
    ...(stage ? ["stage", "publish"] : ["publish"]),
    ...(dryRun ? ["--dry-run"] : []),
    ...(values.otp ? ["--otp", values.otp] : []),
  ]
  console.log(
    `\n$ (cd packages/${pkg} && npm ${args.join(" ").replace(values.otp ?? "\0", "<otp>")})`,
  )
  // stdout is captured for the stage id, then echoed; stderr stays live.
  const r = spawnSync("npm", args, {
    cwd: join(ROOT, "packages", pkg),
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
  })
  process.stdout.write(r.stdout ?? "")
  if (r.status !== 0) {
    fail(
      stage
        ? `staging ${name} failed. If a stage for ${version} already exists, list it with \`npm stage list ${name}\` and approve or reject it rather than staging again.`
        : `publishing ${name} failed. Fix it and run release:publish again: packages already on npm are skipped.`,
    )
  }
  if (stage && !dryRun) {
    const id = stageIdFrom(r.stdout ?? "")
    if (!id)
      fail(`npm staged ${name} but printed no stage id; find it with \`npm stage list ${name}\``)
    staged.push({ name, id })
  }
}

if (dryRun) {
  console.log(`\nrelease:publish: dry run done; nothing was ${stage ? "staged" : "published"}`)
} else if (stage) {
  const lines = staged.map(({ name, id }) => `${name}@${version}  ${id}`)
  console.log(
    `\nrelease:publish: staged ${staged.length} package(s); nothing is live yet.\n  ${lines.join("\n  ")}\n` +
      `Next, on your machine: pnpm release:approve ${version}   (then push main)`,
  )
  // The release workflow's run page shows this.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `## Staged ${version}: nothing is live yet`,
        "",
        "| Package | Stage id |",
        "|---|---|",
        ...staged.map(({ name, id }) => `| \`${name}@${version}\` | \`${id}\` |`),
        "",
        "Approve with npm 2FA from your machine, then push `main`:",
        "",
        "```sh",
        `pnpm release:approve ${version}`,
        "git push origin main",
        "```",
        "",
      ].join("\n"),
    )
  }
} else {
  const missing = waitUntilServed(
    PACKAGES.map((pkg) => manifest(pkg).name),
    version,
  )
  if (missing.length > 0) {
    fail(
      `npm still does not serve ${missing.join(", ")} at ${version} after 180 s. The publish may still land: check with \`npm view <name>@${version} version\` before tagging, and don't push until all three are served.`,
    )
  }
  console.log(`\nrelease:publish: npm serves all three at ${version}. Next: tag and push.`)
}
