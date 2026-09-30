import { DecisionsError } from "../errors.js"

/** The consent a decider is built with: only whether it was granted matters here. */
export interface ConsentGrant {
  granted: boolean
}

/**
 * @throws DecisionsError `egress-refused` when this repo has not consented.
 */
export function assertConsent(consent: ConsentGrant, repoRoot: string): void {
  if (consent.granted) return
  throw new DecisionsError(
    "egress-refused",
    `This repo has not agreed to send content to the decision model's provider. ` +
      `Consent is the user's, and an agent must not grant it: the user runs ` +
      `\`decide config egress allow\` themselves in a terminal in ${repoRoot}, or through their ` +
      `agent prompt's shell escape (not as a chat message) with --confirm added. ` +
      `The setup skill explains what gets sent. ` +
      `Replay of recorded answers works without consent.`,
    { repoRoot },
  )
}
