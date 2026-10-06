// What a release puts on npm, for the person approving it (decision 0022,
// amended). The release workflow's `verify` job writes it to the run page;
// locally it prints, so you can preview the summary of a tag before pushing it.
//
//   pnpm release:summary vX.Y.Z
//
// It has no npm credential and changes nothing.
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { manifest, PACKAGES, ROOT, releaseSummary, releaseVersion } from "./release-lib.mjs"

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

// The release before this one: the nearest v* tag reachable from the tag's parent.
const previous = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${tag}^`])?.trim()
const range = previous ? `${previous}..${tag}` : tag
const summary = releaseSummary({
  version,
  tag,
  previous,
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
