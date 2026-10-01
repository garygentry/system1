import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { type Document, isMap, isScalar, isSeq, parseDocument } from "yaml"
import { DecisionsError } from "../errors.js"
import type { PackName } from "../guard/packs.js"
import { type Consent, type ProfileGrant, repoConfigPath } from "./load.js"

const HEADER = `# decisions — per-repo configuration. See https://github.com/garygentry/system1
# egress.consent records that this repo agreed to send content to the decision
# model's provider (OpenRouter). Path excludes and secret scrubbing always apply.
`

/**
 * The repo config as a YAML document to edit, with each mapping on `path`
 * present. A section that is empty (`guard:`, or only comments) becomes a
 * mapping; one that holds something else, or a file YAML can't parse, is a
 * `config-error` naming the key, rather than a crash or a corrupted file.
 */
function editable(file: string, path: string[]): Document {
  const doc: Document = existsSync(file)
    ? parseDocument(readFileSync(file, "utf8"))
    : parseDocument(HEADER)
  if (doc.errors.length > 0) {
    throw new DecisionsError(
      "config-error",
      `${file} is not valid YAML: ${doc.errors[0]?.message}`,
      {
        file,
      },
    )
  }
  if (!doc.contents || (isScalar(doc.contents) && doc.contents.value == null)) {
    doc.contents = doc.createNode({})
  }
  if (!isMap(doc.contents)) {
    throw new DecisionsError("config-error", `${file} must be a YAML mapping`, { file })
  }
  for (let i = 1; i <= path.length; i++) {
    const at = path.slice(0, i)
    const node = doc.getIn(at, true)
    if (node === undefined || isMap(node)) continue
    if (node === null || (isScalar(node) && node.value == null)) {
      doc.setIn(at, doc.createNode({}))
      continue
    }
    throw new DecisionsError(
      "config-error",
      `${file}: ${at.join(".")} must be a mapping. Correct it by hand, then run the command again`,
      { file },
    )
  }
  return doc
}

/**
 * Record (or revoke) egress consent in `<repo>/.system1/config.yaml`,
 * preserving whatever else the file holds, comments included.
 */
export function setConsent(
  repoRoot: string,
  granted: boolean,
  by?: string,
  now = new Date(),
): Consent {
  const file = repoConfigPath(repoRoot)
  const doc = editable(file, ["egress"])
  const consent: Consent = { granted, at: now.toISOString(), ...(by ? { by } : {}) }
  doc.setIn(["egress", "consent"], consent)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, doc.toString())
  return consent
}

/**
 * Record a guard pack as enabled (or not) in `<repo>/.system1/config.yaml`,
 * preserving the rest of the file. Enabling is a consent act (plan X6): the
 * CLI checks egress consent and the user's go-ahead before calling this.
 */
export function setGuardEnabled(
  repoRoot: string,
  pack: PackName,
  enabled: boolean,
  by?: string,
  now = new Date(),
): { enabled: boolean; enabledAt: string; enabledBy?: string } {
  const file = repoConfigPath(repoRoot)
  const path = ["guard", "packs", pack]
  const doc = editable(file, path)
  const at = now.toISOString()
  doc.setIn([...path, "enabled"], enabled)
  doc.setIn([...path, "enabledAt"], at)
  if (by) doc.setIn([...path, "enabledBy"], by)
  else doc.deleteIn([...path, "enabledBy"])
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, doc.toString())
  return { enabled, enabledAt: at, ...(by ? { enabledBy: by } : {}) }
}

/**
 * Allow (or stop allowing) an emulated baseline to receive this repo's content
 * in `compare`: `egress.allowProfiles` in `<repo>/.system1/config.yaml`. It is
 * the user's decision, like consent itself; the CLI checks for it. A grant
 * records `at` and `by` as consent does; allowing again records the new act.
 */
export function setAllowProfile(
  repoRoot: string,
  id: string,
  allowed: boolean,
  by?: string,
  now = new Date(),
): ProfileGrant[] {
  const file = repoConfigPath(repoRoot)
  const doc = editable(file, ["egress"])
  const current = doc.getIn(["egress", "allowProfiles"])
  const kept = (isSeq(current) ? current.items : []).filter((item) => grantId(item) !== id)
  const grant: ProfileGrant = { id, at: now.toISOString(), ...(by ? { by } : {}) }
  const next = allowed ? [...kept, doc.createNode(grant)] : kept
  doc.setIn(["egress", "allowProfiles"], doc.createNode(next))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, doc.toString())
  return readGrants(next)
}

/** The id an `allowProfiles` entry names: a bare id, or a mapping's `id`. */
function grantId(item: unknown): unknown {
  if (isScalar(item)) return item.value
  if (isMap(item)) return item.get("id")
  return undefined
}

/** The entries as the loader reads them; anything malformed is left for it to report. */
function readGrants(items: unknown[]): ProfileGrant[] {
  return items.flatMap((item): ProfileGrant[] => {
    const id = grantId(item)
    if (typeof id !== "string") return []
    if (!isMap(item)) return [{ id }]
    const at = item.get("at")
    const by = item.get("by")
    return [
      { id, ...(typeof at === "string" ? { at } : {}), ...(typeof by === "string" ? { by } : {}) },
    ]
  })
}

export { assertConsent } from "./assert-consent.js"
