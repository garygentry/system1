// Is this tag fit to release? The release workflow's first gate (0022), and
// the same check you can run before pushing a tag.
//
//   pnpm release:verify vX.Y.Z [--main <ref>]
//
// Checks that the tag is vX.Y.Z of the packages' version, is an annotated tag
// signed by a key in .github/allowed_signers *as committed on main* (so a tag
// can't vouch for its own key), points at HEAD's commit or a descendant of
// main, and that npm does not serve that version yet.
//
// The signature check catches a mistaken tag, not a hostile writer: the
// workflow a tag runs is the tagged commit's own. Staging is the security gate
// (nothing goes live without a maintainer's npm 2FA).
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { checkTag, isPublished, manifest, PACKAGES, ROOT, releaseVersion } from "./release-lib.mjs"

const { values, positionals } = parseArgs({
  options: { main: { type: "string", default: "origin/main" } },
  allowPositionals: true,
})
const tag = positionals[0]
const main = values.main
const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })

const problems = []
const check = (name, fn) => {
  const found = fn()
  if (found.length === 0) console.log(`ok    ${name}`)
  for (const p of found) console.error(`FAIL  ${name} — ${p}`)
  problems.push(...found)
}

if (!tag) {
  console.error("usage: pnpm release:verify vX.Y.Z [--main <ref>]")
  process.exit(2)
}
const { version, error } = releaseVersion()

check("packages share one version", () => (error ? [error] : []))
check(`tag matches ${version}`, () => (error ? [] : checkTag(tag, version)))

check("tag is annotated and signed by an allowed key", () => {
  if (git(["cat-file", "-t", `refs/tags/${tag}`]).stdout.trim() !== "tag")
    return [
      `${tag} is missing or lightweight (in CI, fetch it with +refs/tags/${tag}:refs/tags/${tag})`,
    ]
  const signers = git(["show", `${main}:.github/allowed_signers`])
  if (signers.status !== 0) return [`no .github/allowed_signers on ${main}`]
  const dir = mkdtempSync(join(tmpdir(), "system1-verify-"))
  try {
    const file = join(dir, "allowed_signers")
    writeFileSync(file, signers.stdout)
    const r = git(["-c", `gpg.ssh.allowedSignersFile=${file}`, "verify-tag", tag])
    return r.status === 0
      ? []
      : [`signature not verified: ${(r.stderr || r.stdout).trim().split("\n").at(-1)}`]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

check("tag is the checked-out commit", () => {
  const tagged = git(["rev-parse", `${tag}^{commit}`]).stdout.trim()
  const head = git(["rev-parse", "HEAD"]).stdout.trim()
  return tagged === head ? [] : [`${tag} is ${tagged.slice(0, 7)}, HEAD is ${head.slice(0, 7)}`]
})

check(`tag builds on ${main}`, () =>
  git(["merge-base", "--is-ancestor", main, tag]).status === 0
    ? []
    : [`${main} is not an ancestor of ${tag}: tag a commit on top of main`],
)

check("npm does not serve this version yet", () => {
  if (error) return []
  const live = PACKAGES.map((pkg) => manifest(pkg).name).filter((name) =>
    isPublished(name, version),
  )
  return live.length === PACKAGES.length ? [`npm already serves all three at ${version}`] : []
})

if (problems.length > 0) {
  console.error(`\nrelease:verify ${tag}: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`\nrelease:verify ${tag}: ok`)
