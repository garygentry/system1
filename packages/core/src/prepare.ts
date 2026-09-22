import { applyExcludes } from "./egress/exclude.js"
import { type ScrubCounts, scrubState } from "./egress/scrub.js"
import { assertStateFits } from "./egress/size.js"
import type { ModelProfile } from "./model/profiles.js"
import type { QuestionSet } from "./model/types.js"
import { assertQuestionSet } from "./model/validate.js"
import { type Projection, project } from "./run/budget.js"
import { readSources } from "./sources/read.js"
import type { Item, Skipped, SourceSpec } from "./sources/types.js"
import { type SplitSpec, split } from "./split/split.js"

export interface PrepareInput {
  sources: readonly SourceSpec[]
  split: SplitSpec
  questions: QuestionSet
  profile: ModelProfile
  cwd: string
  /** Extra exclude patterns from config. */
  exclude?: readonly string[]
  maxFileBytes?: number
}

export interface Prepared {
  /** Ready to send: excluded, scrubbed and size-checked. */
  items: Item[]
  /** Everything withheld, with the reason. Always reported, never silent. */
  skipped: Skipped[]
  redactions: { total: number; byKind: ScrubCounts; items: number }
  projection: Projection
}

/**
 * sources → split → exclude → scrub → size check → projection.
 *
 * Nothing here touches the network. The caller then checks the budget and
 * consent before any call is made.
 */
export async function prepare(input: PrepareInput): Promise<Prepared> {
  assertQuestionSet(input.questions)
  const read = await readSources(input.sources, {
    cwd: input.cwd,
    ...(input.maxFileBytes ? { maxFileBytes: input.maxFileBytes } : {}),
  })
  const { items: kept, excluded } = applyExcludes(split(read.documents, input.split), input.exclude)

  const byKind: ScrubCounts = {}
  let redactedItems = 0
  const tokens: number[] = []
  const items = kept.map((item) => {
    const counts: ScrubCounts = {}
    const state = scrubState(item.state, counts)
    const found = Object.values(counts).reduce((a, b) => a + b, 0)
    if (found > 0) {
      redactedItems += 1
      for (const [kind, n] of Object.entries(counts)) byKind[kind] = (byKind[kind] ?? 0) + n
    }
    tokens.push(assertStateFits(item.id, state, input.questions, input.profile))
    return { ...item, state }
  })

  return {
    items,
    skipped: [...read.skipped, ...excluded],
    redactions: {
      total: Object.values(byKind).reduce((a, b) => a + b, 0),
      byKind,
      items: redactedItems,
    },
    projection: project(input.profile, tokens),
  }
}
