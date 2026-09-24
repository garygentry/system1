import { Type } from "typebox"

/**
 * A question, as it goes on the wire. Spelled out here (rather than an opaque
 * record) so `decide schema <tool>` describes what a valid question is.
 */
export const QuestionSchema = Type.Union([
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
