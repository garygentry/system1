import { type Static, Type } from "typebox"
import { QuestionSchema } from "../model/schema.js"
import { CandidateSchema } from "../opportunities/backlog.js"

/**
 * Tool inputs, defined once. The CLI builds these from argv. A future MCP or Pi
 * adapter would take them directly, and `decide schema <tool>` prints them.
 */
const Source = Type.Union([
  Type.Object({
    kind: Type.Literal("text"),
    text: Type.String(),
    id: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("stdin"), text: Type.String() }),
  Type.Object({
    kind: Type.Literal("file"),
    path: Type.String(),
    range: Type.Optional(
      Type.Object({ start: Type.Integer({ minimum: 1 }), end: Type.Integer({ minimum: 1 }) }),
    ),
  }),
  Type.Object({ kind: Type.Literal("glob"), patterns: Type.Array(Type.String(), { minItems: 1 }) }),
  Type.Object({ kind: Type.Literal("jsonl"), path: Type.String() }),
  Type.Object({
    kind: Type.Literal("diff"),
    range: Type.Optional(Type.String()),
    staged: Type.Optional(Type.Boolean()),
    paths: Type.Optional(Type.Array(Type.String())),
  }),
])

const Mode = Type.Union([
  Type.Literal("auto"),
  Type.Literal("live"),
  Type.Literal("record"),
  Type.Literal("replay"),
])

const Common = {
  /** A saved spec: name (repo → user → bundled) or path. */
  spec: Type.Optional(Type.String()),
  /** An inline question set; mutually exclusive with `spec`. */
  questions: Type.Optional(Type.Record(Type.String(), QuestionSchema)),
  /** Where the content comes from. Defaults to the spec's `source`. */
  sources: Type.Optional(Type.Array(Source)),
  /**
   * Leave out paths matching these globs (repo-relative, like `glob`). A per-call
   * choice, reported as `filtered`; egress excludes still apply on top.
   */
  exclude: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  /** `file` | `hunk` | `row` | `lines:N[/overlap]`. */
  split: Type.Optional(Type.String()),
  /** Filters, ANDed: `relevant>=0.7`, `kind in fix,feature`. */
  keep: Type.Optional(Type.Array(Type.String())),
  /** Kept when any of these matches (and every `keep` does): `a>=0.3`, `b>=0.3`. */
  keepAny: Type.Optional(Type.Array(Type.String())),
  mode: Type.Optional(Mode),
  model: Type.Optional(Type.String()),
  /**
   * Read content that resolves outside the repo. Off by default: consent is
   * given per repo (0009), so such a path is withheld unless asked for.
   */
  allowOutside: Type.Optional(Type.Boolean()),
}

/** Unknown properties are refused, so an input can't carry something we ignore. */
const strict = { additionalProperties: false }

export const AskInput = Type.Object(Common, strict)

export const ManyInput = Type.Object(
  {
    ...Common,
    sort: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Which answers to include per result. */
    fields: Type.Optional(Type.Array(Type.String())),
    /** Project the cost and stop: no calls, no consent needed. */
    dryRun: Type.Optional(Type.Boolean()),
    /** Proceed past the spend guard. */
    confirm: Type.Optional(Type.Boolean()),
    concurrency: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  strict,
)

export const UsageInput = Type.Object(
  {
    /** A session id, or `current` for the one this process detected. */
    session: Type.Optional(Type.String()),
    /** ISO date or timestamp. */
    since: Type.Optional(Type.String()),
  },
  strict,
)

export const SpecCheckInput = Type.Object(
  {
    /** Spec name (repo → user → bundled) or path. */
    spec: Type.String({ minLength: 1 }),
    /** `replay` (default) checks against committed fixtures; `record` captures fresh answers. */
    mode: Type.Optional(Type.Union([Type.Literal("replay"), Type.Literal("record")])),
    model: Type.Optional(Type.String()),
    /** Proceed past the spend guard. */
    confirm: Type.Optional(Type.Boolean()),
  },
  strict,
)

export const SpecLintInput = Type.Object(
  {
    /** Spec name (repo → user → bundled) or path. Omitted: every spec in reach. */
    spec: Type.Optional(Type.String({ minLength: 1 })),
  },
  strict,
)

export const OpportunitiesAddInput = Type.Object(
  {
    /** Candidates to merge into `.system1/opportunities.json`. */
    candidates: Type.Array(CandidateSchema, { minItems: 1 }),
  },
  strict,
)

export const OpportunitiesListInput = Type.Object(
  {
    /** Record filters, ANDed: `status=new`, `risk in medium,high`, `projected>=0.01`. */
    keep: Type.Optional(Type.Array(Type.String())),
    /** `projected:desc` (the default), `seenAt:asc`, … */
    sort: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Top-level fields to include per entry; `id` always is. */
    fields: Type.Optional(Type.Array(Type.String())),
  },
  strict,
)

export const OpportunitiesCheckInput = Type.Object({}, strict)

export const RouteInput = Type.Object(
  {
    /** The user's prompt, as the harness hook received it. */
    prompt: Type.String(),
  },
  strict,
)

export type AskInput = Static<typeof AskInput>
export type ManyInput = Static<typeof ManyInput>
export type UsageInput = Static<typeof UsageInput>
export type SpecCheckInput = Static<typeof SpecCheckInput>
export type RouteInput = Static<typeof RouteInput>
export type SpecLintInput = Static<typeof SpecLintInput>
export type OpportunitiesAddInput = Static<typeof OpportunitiesAddInput>
export type OpportunitiesListInput = Static<typeof OpportunitiesListInput>

export const TOOL_SCHEMAS = {
  ask: AskInput,
  many: ManyInput,
  usage: UsageInput,
  "spec-check": SpecCheckInput,
  "spec-lint": SpecLintInput,
  "opportunities-add": OpportunitiesAddInput,
  "opportunities-list": OpportunitiesListInput,
  "opportunities-check": OpportunitiesCheckInput,
  route: RouteInput,
} as const
export type ToolName = keyof typeof TOOL_SCHEMAS
