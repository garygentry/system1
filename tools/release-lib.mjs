// Shared by release-publish.mjs, release-verify.mjs, release-summary.mjs and
// the release workflow (decision 0022). The pure checks are unit-tested in release-lib.test.ts.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
/** Publish order. The CLI bundles core, so none depends on another at install time. */
export const PACKAGES = ["core", "cli", "pi"]

export const manifest = (pkg) =>
  JSON.parse(readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8"))

/** The one version all three packages carry, or a message saying why there isn't one. */
export function releaseVersion() {
  const version = manifest("cli").version
  for (const pkg of PACKAGES) {
    if (manifest(pkg).version !== version)
      return {
        error: `packages/${pkg} is at ${manifest(pkg).version}, cli at ${version}: run pnpm generate`,
      }
  }
  return { version }
}

/** Problems with releasing `tag` (a git ref name) as `version`; empty when it matches. */
export function checkTag(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) return [`tag ${tag} is not vX.Y.Z`]
  return tag === `v${version}` ? [] : [`tag ${tag} does not match the packages' version ${version}`]
}

/** The signature git appends to a signed tag's message. */
const SIGNATURE = /-----BEGIN [A-Z ]*SIGNATURE-----[\s\S]*$/

/**
 * `text` as a fenced code block whose fence is longer than any run of
 * backticks inside it, so commit subjects, tag messages and file names (all
 * written by whoever pushed the tag) can't close the fence and forge markdown.
 */
export function fenced(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(longest + 1)
  return [fence, text, fence].join("\n")
}

/**
 * The release summary the workflow's `verify` job writes to its run page, as
 * markdown: what the approver is about to put on npm. `previous` is the tag of
 * the version npm serves as latest (not the nearest tag, which anyone who can
 * push a tag could plant); `previousProblem` says why there is none.
 * `diffStat` is `git diff --stat <previous>..<tag>`. `github` lists the files
 * changed under `.github/` (from `--name-only`, since `--stat` may shorten
 * paths); any are flagged loudly, because a tag runs the workflow as the
 * tagged commit wrote it.
 *
 * The summary is advice, not a control: the run that writes it is the tag's
 * own, so a hostile tag can rewrite it too (0022, Amendment 1).
 */
export function releaseSummary({
  version,
  tag,
  previous,
  previousProblem,
  packages,
  message,
  log,
  diffStat,
  github,
}) {
  const range = previous ? `${previous}..${tag}` : tag
  const caution = [
    ...(previousProblem
      ? [
          `> **No trusted base to compare against:** ${previousProblem}. Everything below is unbounded.`,
        ]
      : []),
    ...(github.length > 0
      ? [
          `> **\`.github/\` changed since ${previous}.** This run executes the workflow as the tag`,
          "> wrote it. Read these changes in GitHub's own compare view before you approve:",
          ">",
          ...fenced(github.join("\n"))
            .split("\n")
            .map((line) => `> ${line}`),
        ]
      : []),
  ]
  return [
    `## Release ${version}: waiting for approval`,
    "",
    ...(caution.length > 0 ? ["> [!CAUTION]", ...caution, ""] : []),
    "### Packages",
    "",
    fenced(packages.map((name) => `${name}@${version}`).join("\n")),
    "",
    "### Tag message",
    "",
    fenced(message.replace(SIGNATURE, "").trim() || "(none)"),
    "",
    `### Changes (${range})`,
    "",
    fenced(log.trim() || "(no commits)"),
    "",
    "### Files",
    "",
    fenced(diffStat.replace(/^\n+|\s+$/g, "") || "(no changes)"),
    "",
    "Approving the `publish` job publishes all three packages live on npm, with provenance.",
    "This summary is written by the run it describes; check `.github/` in GitHub's compare view.",
    "",
  ].join("\n")
}

/**
 * Settings pnpm passes to scripts as `npm_config_*` that npm doesn't know: npm
 * warns about each ("will error in a future major version"). Run npm without them.
 */
const PNPM_ONLY = /^npm_config_(verify_deps_before_run|npm_globalconfig|_jsr_registry)$/i

export function npmEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !PNPM_ONLY.test(key)))
}

/** True when npm already serves `name@version`. */
export function isPublished(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
    env: npmEnv(),
  })
  return r.status === 0 && r.stdout.trim() === version
}

/**
 * Waits until npm serves every name at `version`, and returns those it still
 * doesn't. The registry lags a publish by a few seconds to a minute (0.4.0: ~40 s).
 */
export function waitUntilServed(names, version, { waitMs = 180_000, stepMs = 10_000 } = {}) {
  let missing = names.filter((name) => !isPublished(name, version))
  for (let waited = 0; missing.length > 0 && waited < waitMs; waited += stepMs) {
    console.log(`waiting for npm to serve ${missing.join(", ")} at ${version}…`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stepMs)
    missing = missing.filter((name) => !isPublished(name, version))
  }
  return missing
}
