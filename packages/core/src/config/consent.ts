import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseDocument } from "yaml"
import { DecisionsError } from "../errors.js"
import { type Consent, repoConfigPath } from "./load.js"

const HEADER = `# decisions — per-repo configuration. See https://github.com/garygentry/system1
# egress.consent records that this repo agreed to send content to the decision
# model's provider (OpenRouter). Path excludes and secret scrubbing always apply.
`

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
  const doc = existsSync(file) ? parseDocument(readFileSync(file, "utf8")) : parseDocument(HEADER)
  const consent: Consent = { granted, at: now.toISOString(), ...(by ? { by } : {}) }
  doc.setIn(["egress", "consent"], consent)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, doc.toString())
  return consent
}

/**
 * @throws DecisionsError `egress-refused` when this repo has not consented.
 */
export function assertConsent(consent: Consent, repoRoot: string): void {
  if (consent.granted) return
  throw new DecisionsError(
    "egress-refused",
    `This repo has not agreed to send content to the decision model's provider. ` +
      `Consent is the user's, and an agent must not grant it: the user runs ` +
      `\`decide config egress allow\` themselves in a terminal in ${repoRoot}, adding --confirm ` +
      `if they type it at an agent's prompt instead. ` +
      `The setup skill explains what gets sent. ` +
      `Replay of recorded answers works without consent.`,
    { repoRoot },
  )
}
