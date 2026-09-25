// Approve the stages the release workflow made, so the version goes live.
//
//   pnpm release:approve [X.Y.Z] [--yes]
//
// For each package npm doesn't serve yet at X.Y.Z (default: the checkout's
// version), it finds the one stage of that version, downloads it and lists
// its files for review, then runs `npm stage approve <id>`, which asks for your
// npm 2FA. Last, it waits until npm serves all three. It never tags or pushes;
// push main after it passes (docs/contributing/release.md, decision 0022).
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { parseArgs } from "node:util"
import {
  atLeast,
  isPublished,
  manifest,
  PACKAGES,
  releaseVersion,
  STAGE_NPM,
  stagedFor,
  waitUntilServed,
} from "./release-lib.mjs"

const { values, positionals } = parseArgs({
  options: { yes: { type: "boolean" } },
  allowPositionals: true,
})

const fail = (message) => {
  console.error(`release:approve: ${message}`)
  process.exit(1)
}
const npm = (args, opts = {}) => spawnSync("npm", args, { encoding: "utf8", ...opts })

const npmVersion = npm(["--version"]).stdout?.trim() ?? ""
if (!atLeast(npmVersion, STAGE_NPM))
  fail(
    `npm ${npmVersion || "(not found)"} has no \`npm stage\`; run \`npm i -g npm@latest\` (≥ ${STAGE_NPM})`,
  )

const version = positionals[0] ?? releaseVersion().version
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("usage: pnpm release:approve X.Y.Z [--yes]")

const names = PACKAGES.map((pkg) => manifest(pkg).name)
const todo = names.filter((name) => !isPublished(name, version))
if (todo.length === 0) fail(`npm already serves all three packages at ${version}`)

// Find exactly one stage per package before approving any, so a missing or
// duplicated stage stops the release before anything goes live.
const stages = todo.map((name) => {
  const r = npm(["stage", "list", name, "--json"])
  if (r.status !== 0)
    fail(`npm stage list ${name} failed (are you logged in? \`npm whoami\`):\n${r.stderr}`)
  const items = stagedFor(JSON.parse(r.stdout || "[]"), name, version)
  if (items.length === 0)
    fail(
      `nothing is staged for ${name}@${version}. Did the release workflow finish? It stages on a pushed v${version} tag.`,
    )
  if (items.length > 1)
    fail(
      `${items.length} stages of ${name}@${version}: ${items.map((i) => i.id).join(", ")}. Reject the extras (\`npm stage reject <id>\`) and run this again.`,
    )
  return items[0]
})

const review = mkdtempSync(join(tmpdir(), "system1-approve-"))
try {
  for (const item of stages) {
    console.log(
      `\n== ${item.packageName}@${item.version}  stage ${item.id}\n   staged ${item.createdAt ?? "?"} by ${item.actor ?? "?"}${item.actorType ? ` (${item.actorType})` : ""}, tag ${item.tag ?? "?"}, shasum ${item.shasum ?? "?"}`,
    )
    // Prints the tarball's file list and sizes, as npm publish would.
    const dl = npm(["stage", "download", item.id], { cwd: review, stdio: "inherit" })
    if (dl.status !== 0) fail(`could not download stage ${item.id} for review`)
  }
} finally {
  rmSync(review, { recursive: true, force: true })
}

if (!values.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    `\nApprove these ${stages.length} stage(s) and publish ${version}? [y/N] `,
  )
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) fail("not approved; nothing was published")
}

for (const item of stages) {
  console.log(`\n$ npm stage approve ${item.id}   # ${item.packageName}`)
  const r = npm(["stage", "approve", item.id], { stdio: "inherit" })
  if (r.status !== 0)
    fail(
      `approving ${item.packageName} failed. Fix it and run release:approve again: packages already live are skipped.`,
    )
}

const missing = waitUntilServed(names, version)
if (missing.length > 0)
  fail(
    `npm still does not serve ${missing.join(", ")} at ${version}. Check with \`npm view <name>@${version} version\` before pushing main.`,
  )
console.log(`\nrelease:approve: npm serves all three at ${version}. Next: git push origin main`)
