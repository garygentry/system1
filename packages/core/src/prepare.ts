import { applyExcludes } from "./egress/exclude.js"
import { type ScrubCounts, scrubState, scrubText } from "./egress/scrub.js"
import { assertStateFits } from "./egress/size.js"
import { DecisionsError } from "./errors.js"
import type { ModelProfile } from "./model/profiles.js"
import type { QuestionSet, State } from "./model/types.js"
import { assertQuestionSet } from "./model/validate.js"
import { type Projection, project } from "./run/budget.js"
import { applyFilter } from "./sources/filter.js"
import { readSources } from "./sources/read.js"
import type { Item, Skipped, SourceSpec } from "./sources/types.js"
import { joinItems, type SplitSpec, split } from "./split/split.js"

export interface PrepareInput {
  sources: readonly SourceSpec[]
  split: SplitSpec
  questions: QuestionSet
  profile: ModelProfile
  cwd: string
  /** Extra exclude patterns from config. */
  exclude?: readonly string[]
  /** Paths the caller asked to leave out (`--exclude`), reported as `filtered`. */
  filter?: readonly string[]
  maxFileBytes?: number
  /** Allow content from outside the repo (off by default). */
  allowOutside?: boolean
}

export interface Prepared {
  /** Ready to send: excluded, scrubbed and size-checked. */
  items: Item[]
  /** Everything withheld, with the reason. Always reported, never silent. */
  skipped: Skipped[]
  /** `items`: how many documents or items had at least one redaction. */
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
  assertChoicesFit(input.questions, input.profile)
  const read = await readSources(input.sources, {
    cwd: input.cwd,
    ...(input.maxFileBytes ? { maxFileBytes: input.maxFileBytes } : {}),
    ...(input.allowOutside ? { allowOutside: true } : {}),
    ...(input.filter?.length ? { filter: input.filter, withhold: input.exclude ?? [] } : {}),
  })

  const byKind: ScrubCounts = {}
  /** How many documents or items had at least one redaction. */
  let redactedSources = 0
  const count = (counts: ScrubCounts): number => {
    const found = Object.values(counts).reduce((a, b) => a + b, 0)
    for (const [kind, n] of Object.entries(counts)) byKind[kind] = (byKind[kind] ?? 0) + n
    return found
  }

  // Excluded files are dropped before anything else touches them, so a
  // withheld file is never reported as scrubbed.
  const allowed = applyExcludes(read.documents, input.exclude)
  // Then what the caller left out. Globs were filtered before reading; this
  // catches files, diffs and rows. After egress, so a secret is never `filtered`.
  const chosen = applyFilter(allowed.items, input.filter)

  // Then scrub whole documents: a private key cut across two line windows
  // would otherwise lose the markers that identify it.
  const documents = chosen.items.map((doc) => {
    const counts: ScrubCounts = {}
    const scrubbed = {
      ...doc,
      ...(doc.text !== undefined ? { text: scrubText(doc.text, counts) } : {}),
      ...(doc.data !== undefined ? { data: scrubState(doc.data as State, counts) } : {}),
    }
    if (count(counts) > 0) redactedSources += 1
    return scrubbed
  })

  // Again after splitting, in case a split produced a path we hadn't seen.
  const filtered = applyExcludes(split(documents, input.split), input.exclude)
  const kept = input.split.kind === "join" ? joinItems(filtered.items) : filtered.items

  // Then each item again, so anything the split produced (a join, a row read
  // as a value) is covered too.
  const tokens: number[] = []
  const items = kept.map((item) => {
    const counts: ScrubCounts = {}
    const state = scrubState(item.state, counts)
    if (count(counts) > 0) redactedSources += 1
    tokens.push(assertStateFits(item.id, state, input.questions, input.profile))
    return { ...item, state }
  })

  return {
    items,
    skipped: unique([
      ...read.skipped,
      ...allowed.excluded,
      ...chosen.filtered,
      ...filtered.excluded,
    ]),
    redactions: {
      total: Object.values(byKind).reduce((a, b) => a + b, 0),
      byKind,
      items: redactedSources,
    },
    projection: project(input.profile, tokens),
  }
}

/** Refused before any call, so a fan-out never fails N times on the same limit. */
function assertChoicesFit(questions: QuestionSet, profile: ModelProfile): void {
  for (const [name, q] of Object.entries(questions)) {
    if (q.type !== "choice") continue
    const n = Object.keys(q.criteria).length
    if (n > profile.maxChoices) {
      throw new DecisionsError(
        "invalid-request",
        `Question "${name}" has ${n} options; ${profile.id} accepts at most ${profile.maxChoices}. Narrow the candidates first (e.g. screen them with a noul), then pick among the survivors.`,
        { question: name, options: n, maxChoices: profile.maxChoices },
      )
    }
  }
}

/** One entry per path and reason: a glob and a `--file` can name the same path. */
function unique(skipped: Skipped[]): Skipped[] {
  const seen = new Set<string>()
  return skipped.filter((s) => {
    const key = `${s.path}\0${s.reason}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
