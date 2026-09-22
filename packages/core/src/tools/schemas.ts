import { type Static, Type } from "typebox"

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

/**
 * A question, as it goes on the wire. Spelled out here (rather than an opaque
 * record) so `decide schema <tool>` describes what a valid question is.
 */
const Question = Type.Union([
  Type.Object(
    {
      type: Type.Literal("noul"),
      instructions: Type.String({ minLength: 1 }),
      /** Optional `true`/`false` criteria that sharpen an ambiguous statement. */
      criteria: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("choice"),
      instructions: Type.String({ minLength: 1 }),
      /** Option key to when it applies. At least two, including a way out. */
      criteria: Type.Record(Type.String(), Type.String(), { minProperties: 2 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("score"),
      instructions: Type.String({ minLength: 1 }),
      /** Levels, lowest first and 0-indexed. */
      criteria: Type.Array(Type.String(), { minItems: 2 }),
    },
    { additionalProperties: false },
  ),
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
  questions: Type.Optional(Type.Record(Type.String(), Question)),
  /** Where the content comes from. Defaults to the spec's `source`. */
  sources: Type.Optional(Type.Array(Source)),
  /** `file` | `hunk` | `row` | `lines:N[/overlap]`. */
  split: Type.Optional(Type.String()),
  /** Filters, ANDed: `relevant>=0.7`, `kind in fix,feature`. */
  keep: Type.Optional(Type.Array(Type.String())),
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

export type AskInput = Static<typeof AskInput>
export type ManyInput = Static<typeof ManyInput>
export type UsageInput = Static<typeof UsageInput>
export type SpecCheckInput = Static<typeof SpecCheckInput>

export const TOOL_SCHEMAS = {
  ask: AskInput,
  many: ManyInput,
  usage: UsageInput,
  "spec-check": SpecCheckInput,
} as const
export type ToolName = keyof typeof TOOL_SCHEMAS
