// What a release puts on npm, for the person approving it (decision 0022,
// amended). The release workflow's `verify` job writes it to the run page;
// locally it prints, so you can preview the summary of a tag before pushing it.
//
//   pnpm release:summary vX.Y.Z
//
// It has no npm credential and changes nothing.
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { manifest, npmEnv, PACKAGES, ROOT, releaseSummary, releaseVersion } from "./release-lib.mjs"

const tag = process.argv[2]
if (!tag) {
  console.error("usage: pnpm release:summary vX.Y.Z")
  process.exit(2)
}
const git = (args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return r.status === 0 ? r.stdout : undefined
}
const fail = (message) => {
  console.error(`release:summary: ${message}`)
  process.exit(1)
}

const { version, error } = releaseVersion()
if (error) fail(error)
if (git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]) === undefined)
  fail(`no tag ${tag} (in CI, the checkout needs fetch-depth: 0)`)

// The release before this one is what npm serves as latest, not the nearest
// v* tag: the tag ruleset stops tags moving, not new ones, so a planted tag just
// below this one could otherwise shrink the diff and hide a .github/ change.
const cli = manifest("cli").name
const latest = spawnSync("npm", ["view", cli, "version"], { encoding: "utf8", env: npmEnv() })
let previous
let previousProblem
if (latest.status !== 0 || !/^\d+\.\d+\.\d+$/.test(latest.stdout.trim())) {
  previousProblem = `\`npm view ${cli} version\` failed`
} else {
  const candidate = `v${latest.stdout.trim()}`
  if (git(["rev-parse", "--verify", "--quiet", `refs/tags/${candidate}`]) === undefined)
    previousProblem = `npm's latest is ${candidate}, and there is no such tag`
  else if (
    spawnSync("git", ["merge-base", "--is-ancestor", candidate, tag], { cwd: ROOT }).status !== 0
  )
    previousProblem = `npm's latest, ${candidate}, is not an ancestor of ${tag}`
  else previous = candidate
}
const range = previous ? `${previous}..${tag}` : tag
const summary = releaseSummary({
  version,
  tag,
  previous,
  previousProblem,
  packages: PACKAGES.map((pkg) => manifest(pkg).name),
  message: git(["tag", "-l", "--format=%(contents)", tag]) ?? "",
  log: git(["log", "--oneline", "--no-decorate", range]) ?? "",
  diffStat: previous ? (git(["diff", "--stat=100", range]) ?? "") : "",
  github: previous
    ? (git(["diff", "--name-only", range, "--", ".github"]) ?? "").split("\n").filter(Boolean)
    : [],
})

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
process.stdout.write(summary)
