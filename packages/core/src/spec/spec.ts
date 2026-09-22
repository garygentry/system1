import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, extname, isAbsolute, join, resolve } from "node:path"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { parse } from "yaml"
import { DecisionsError } from "../errors.js"
import type { QuestionSet } from "../model/types.js"
import { assertQuestionSet } from "../model/validate.js"
import { parseFilter, parseSort } from "../project/project.js"

/**
 * The question spec: the plugin's one durable file format. It holds a question
 * set together with the policy that reads its answers, so thresholds live in a
 * versioned, testable file rather than in anyone's head (charter principle 3).
 */
const Threshold = Type.Object({ value: Type.Number(), why: Type.String({ minLength: 1 }) })

export const SpecSchema = Type.Object({
  description: Type.String({ minLength: 1 }),
  questions: Type.Record(Type.String(), Type.Unknown()),
  keep: Type.Optional(Type.Array(Type.String())),
  sort: Type.Optional(Type.String()),
  policy: Type.Optional(
    Type.Object({ thresholds: Type.Optional(Type.Record(Type.String(), Threshold)) }),
  ),
  source: Type.Optional(
    Type.Object({
      glob: Type.Optional(Type.Array(Type.String())),
      file: Type.Optional(Type.String()),
      jsonl: Type.Optional(Type.String()),
      diff: Type.Optional(Type.String()),
      split: Type.Optional(Type.String()),
    }),
  ),
  examples: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        state: Type.Unknown(),
        expect: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
    ),
  ),
  provenance: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export type SpecFile = Static<typeof SpecSchema>

export interface Spec extends Omit<SpecFile, "questions"> {
  /** File stem; also the fixture namespace. */
  name: string
  questions: QuestionSet
  /** Where it was loaded from. */
  file: string
  /** Which lookup layer it came from. */
  origin: "repo" | "user" | "bundled" | "path"
}

export interface SpecDirs {
  repo: string
  user: string
  bundled?: string
}

const NAME = /^[a-z0-9][a-z0-9._-]*$/

/** Parse and validate spec text. Collects every problem before failing. */
export function parseSpec(text: string, file: string, origin: Spec["origin"]): Spec {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (error) {
    throw new DecisionsError("invalid-request", `${file}: not valid YAML: ${String(error)}`, {
      file,
    })
  }
  const problems = [...Value.Errors(SpecSchema, raw)].map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  )
  if (problems.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `${file}: invalid spec:\n  ${problems.join("\n  ")}`,
      { file, problems },
    )
  }
  const spec = raw as SpecFile
  try {
    assertQuestionSet(spec.questions)
  } catch (error) {
    throw new DecisionsError("invalid-request", `${file}: ${(error as Error).message}`, { file })
  }
  const questions = spec.questions as QuestionSet
  for (const text of spec.keep ?? []) wrap(file, () => parseFilter(text, questions))
  if (spec.sort) wrap(file, () => parseSort(spec.sort as string, questions))
  const name = basename(file, extname(file))
  if (!NAME.test(name)) {
    throw new DecisionsError(
      "invalid-request",
      `${file}: spec names must be lowercase letters, digits, . _ -`,
      { file },
    )
  }
  return { ...spec, questions, name, file, origin }
}

/** The default spec directories for a repo. */
export function specDirs(repoRoot: string, userConfigDir: string, bundled?: string): SpecDirs {
  return {
    repo: join(repoRoot, ".decisions", "specs"),
    user: join(userConfigDir, "specs"),
    ...(bundled ? { bundled } : {}),
  }
}

/**
 * Resolve a spec by name (repo → user → bundled) or by path.
 *
 * @throws DecisionsError `invalid-request` when nothing matches, listing what exists.
 */
export function loadSpec(ref: string, dirs: SpecDirs, cwd: string): Spec {
  if (ref.includes("/") || ref.endsWith(".yaml") || ref.endsWith(".yml") || ref.endsWith(".json")) {
    const file = isAbsolute(ref) ? ref : resolve(cwd, ref)
    if (!existsSync(file)) throw new DecisionsError("invalid-request", `No spec file at ${ref}`)
    return parseSpec(readFileSync(file, "utf8"), file, "path")
  }
  for (const [origin, dir] of layers(dirs)) {
    for (const ext of [".yaml", ".yml", ".json"]) {
      const file = join(dir, `${ref}${ext}`)
      if (existsSync(file)) return parseSpec(readFileSync(file, "utf8"), file, origin)
    }
  }
  const known = listSpecs(dirs).map((s) => s.name)
  throw new DecisionsError(
    "invalid-request",
    `No spec named "${ref}". ${known.length ? `Available: ${known.join(", ")}.` : "No specs found."}`,
    { known },
  )
}

export interface SpecListing {
  name: string
  origin: Spec["origin"]
  file: string
  description?: string
  /** Set when the file does not validate. */
  error?: string
  /** A higher-priority layer defines the same name. */
  shadowed?: boolean
}

export function listSpecs(dirs: SpecDirs): SpecListing[] {
  const seen = new Set<string>()
  const out: SpecListing[] = []
  for (const [origin, dir] of layers(dirs)) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir).sort()) {
      if (!/\.(ya?ml|json)$/.test(entry)) continue
      const file = join(dir, entry)
      const name = basename(entry, extname(entry))
      const shadowed = seen.has(name)
      seen.add(name)
      try {
        const spec = parseSpec(readFileSync(file, "utf8"), file, origin)
        out.push({
          name,
          origin,
          file,
          description: spec.description,
          ...(shadowed ? { shadowed } : {}),
        })
      } catch (error) {
        out.push({
          name,
          origin,
          file,
          error: (error as Error).message,
          ...(shadowed ? { shadowed } : {}),
        })
      }
    }
  }
  return out
}

function layers(dirs: SpecDirs): Array<[Spec["origin"], string]> {
  return [
    ["repo", dirs.repo],
    ["user", dirs.user],
    ...(dirs.bundled ? ([["bundled", dirs.bundled]] as Array<[Spec["origin"], string]>) : []),
  ]
}

function wrap(file: string, fn: () => unknown): void {
  try {
    fn()
  } catch (error) {
    throw new DecisionsError("invalid-request", `${file}: ${(error as Error).message}`, { file })
  }
}
