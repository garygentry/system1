/**
 * One real decision call against the live endpoint. Run with `pnpm test:live`;
 * skipped without OPENROUTER_API_KEY. Costs about $0.00003.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { createDecider } from "./decide.js"
import { FixtureStore } from "./fixtures/store.js"
import { resolveProfile } from "./model/profiles.js"
import type { QuestionSet } from "./model/types.js"
import { SpendLedger } from "./run/spend.js"
import { createOpenRouterTransport } from "./transport/openrouter.js"

const apiKey = process.env.OPENROUTER_API_KEY
const dir = mkdtempSync(join(tmpdir(), "decisions-live-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const questions: QuestionSet = {
  kind: {
    type: "choice",
    instructions: "What kind of change this diff line makes.",
    criteria: {
      fix: "Corrects wrong behaviour.",
      feature: "Adds new behaviour.",
      chore: "Tooling, formatting or dependencies only.",
      none: "None of the above, or impossible to tell.",
    },
  },
  risk: {
    type: "score",
    instructions: "How likely this change is to break something for users.",
    criteria: [
      "Cannot affect runtime behaviour.",
      "Changes behaviour on a rarely used path.",
      "Changes behaviour on a path every user hits.",
    ],
  },
  touches_tests: { type: "noul", instructions: "The change modifies test code." },
}
const state = { file: "package.json", line: '-    "vitest": "^2.1.8",\n+    "vitest": "^5.0.1",' }

describe.skipIf(!apiKey)("live decision (spends real money)", () => {
  it("answers all three primitives, records, and replays identically", async () => {
    const profile = resolveProfile("typesafe/jev-1.13")
    const fixtures = new FixtureStore(join(dir, "fixtures"))
    const ledger = new SpendLedger(join(dir, "usage.jsonl"))
    const transport = createOpenRouterTransport({ apiKey: apiKey as string })

    const live = await createDecider({
      profile,
      egressConsent: true,
      transport,
      fixtures,
      ledger,
      mode: "record",
    }).decide({
      state,
      questions,
      namespace: "live-test",
    })
    expect(live.source).toBe("live")
    expect(live.answers.kind?.type).toBe("choice")
    expect(live.answers.risk?.type).toBe("score")
    expect(live.answers.touches_tests?.type).toBe("noul")
    expect(live.usage.cost).toBeGreaterThan(0)

    const replayed = await createDecider({
      profile,
      egressConsent: true,
      fixtures,
      ledger,
      mode: "replay",
    }).decide({
      state,
      questions,
      namespace: "live-test",
    })
    expect(replayed.source).toBe("replay")
    expect(replayed.answers).toEqual(live.answers)

    console.log(
      `live: served by ${live.servedBy} in ${live.latencyMs} ms; measured cost $${live.usage.cost} ` +
        `(${live.usage.input_tokens} in / ${live.usage.output_tokens} out); ` +
        `answers ${JSON.stringify(live.answers)}; undecided ${JSON.stringify(live.undecided)}`,
    )
  })
})
