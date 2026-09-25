// Shared by release-publish.mjs, release-approve.mjs and the release workflow
// (decision 0022). The pure checks are unit-tested in release-lib.test.ts.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
/** Publish order. The CLI bundles core, so none depends on another at install time. */
export const PACKAGES = ["core", "cli", "pi"]
/** `npm stage` and stage-only trusted publishing arrived in npm 11.15.0. */
export const STAGE_NPM = "11.15.0"

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

/** True when `version` (x.y.z) is at least `min`. */
export function atLeast(version, min) {
  const a = version.split(".").map(Number)
  const b = min.split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

/** The stage id in `npm stage publish` output: `+ name@1.2.3 (staged with id <uuid>)`. */
export function stageIdFrom(output) {
  return /staged with id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    output,
  )?.[1]
}

/** The items of `npm stage list <name> --json` that stage `name@version`. */
export function stagedFor(items, name, version) {
  return items.filter((item) => item.packageName === name && item.version === version)
}

/** True when npm already serves `name@version`. */
export function isPublished(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" })
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
