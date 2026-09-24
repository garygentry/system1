import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"
import { parse } from "yaml"
import { DecisionsError } from "../errors.js"
import type { QuestionSet } from "../model/types.js"
import { assertQuestionSet } from "../model/validate.js"
import { parseFilter, parseSort } from "../project/project.js"
import { parseFileRef } from "../sources/read.js"
import { parseSplit } from "../split/split.js"
import { parseExpect } from "./expect.js"

/**
 * The question spec: the plugin's one durable file format. It holds a question
 * set together with the policy that reads its answers, so thresholds live in a
 * versioned, testable file rather than in anyone's head (charter principle 3).
 */
// Every object in the format is closed: a misspelled key (`kepe:`, `globs:`,
// `exepct:`) must fail rather than silently become no policy at all.
const CLOSED = { additionalProperties: false } as const

const Threshold = Type.Object({ value: Type.Number(), why: Type.String({ minLength: 1 }) }, CLOSED)

export const SPEC_FORMAT = 1

export const SpecSchema = Type.Object(
  {
    /** Spec file format. Absent means 1; a newer one is refused, not guessed. */
    version: Type.Optional(Type.Integer({ minimum: 1 })),
    description: Type.String({ minLength: 1 }),
    questions: Type.Record(Type.String(), Type.Unknown()),
    keep: Type.Optional(Type.Array(Type.String())),
    /** Kept when any of these matches, as well as every `keep`. */
    keepAny: Type.Optional(Type.Array(Type.String())),
    sort: Type.Optional(Type.String()),
    policy: Type.Optional(
      Type.Object({ thresholds: Type.Optional(Type.Record(Type.String(), Threshold)) }, CLOSED),
    ),
    source: Type.Optional(
      Type.Object(
        {
          glob: Type.Optional(Type.Array(Type.String())),
          file: Type.Optional(Type.String()),
          jsonl: Type.Optional(Type.String()),
          diff: Type.Optional(Type.String()),
          split: Type.Optional(Type.String()),
        },
        CLOSED,
      ),
    ),
    examples: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1 }),
            /** The text (or a JSON value, sent as its JSON text) to judge. Give this or `file`. */
            state: Type.Optional(Type.Unknown()),
            /** A repo file to judge, `path` or `path:START-END`. Give this or `state`. */
            file: Type.Optional(Type.String()),
            expect: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          },
          CLOSED,
        ),
      ),
    ),
    provenance: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** Anything else a team wants to carry, ignored by the engine. */
    meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  CLOSED,
)

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
  if ((spec.version ?? SPEC_FORMAT) > SPEC_FORMAT) {
    throw new DecisionsError(
      "invalid-request",
      `${file}: spec format version ${spec.version} is newer than this CLI understands (${SPEC_FORMAT}). Upgrade @garygentry/system1.`,
      { file, version: spec.version },
    )
  }
  try {
    assertQuestionSet(spec.questions)
  } catch (error) {
    throw new DecisionsError("invalid-request", `${file}: ${(error as Error).message}`, { file })
  }
  const questions = spec.questions as QuestionSet
  for (const text of [...(spec.keep ?? []), ...(spec.keepAny ?? [])])
    wrap(file, () => parseFilter(text, questions))
  if (spec.sort) wrap(file, () => parseSort(spec.sort as string, questions))
  if (spec.source?.split) wrap(file, () => parseSplit(spec.source?.split as string))
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

/**
 * Problems with a spec's examples. Checked by `spec validate` and `spec check`
 * only, so a bad example never stops `ask` or `many` from using the spec.
 * With `repoRoot`, each example `file` must also exist inside the repo.
 */
export function exampleProblems(spec: Spec, repoRoot?: string): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const [i, example] of (spec.examples ?? []).entries()) {
    const where = `examples[${i}] (${example.id})`
    if (ids.has(example.id)) problems.push(`${where}: duplicate id`)
    ids.add(example.id)
    if ((example.state === undefined) === (example.file === undefined)) {
      problems.push(`${where}: give exactly one of state or file`)
    }
    if (example.expect) {
      try {
        parseExpect(example.expect, spec.questions, where)
      } catch (error) {
        problems.push((error as Error).message)
      }
    }
    if (example.file !== undefined && repoRoot) {
      const why = exampleFileProblem(example.file, repoRoot)
      if (why) problems.push(`${where}: file ${example.file} ${why}`)
    }
  }
  return problems
}

/**
 * Why an example's `file` can't be used, or undefined. Only files inside the
 * repo: a committed spec must not be able to read (and send) anything else.
 */
export function exampleFileProblem(ref: string, repoRoot: string): string | undefined {
  const { path } = parseFileRef(ref)
  const full = resolve(repoRoot, path)
  const rel = relative(repoRoot, full)
  if (isAbsolute(path) || rel.startsWith("..") || isAbsolute(rel)) return "is outside the repo"
  if (!existsSync(full)) return "does not exist"
  return undefined
}

/** @throws DecisionsError `invalid-request` listing every example problem. */
export function assertExamples(spec: Spec, repoRoot?: string): void {
  const problems = exampleProblems(spec, repoRoot)
  if (problems.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `${spec.file}: invalid examples:\n  ${problems.join("\n  ")}`,
      { file: spec.file, problems },
    )
  }
}

/**
 * Parse a question set given on its own (`--questions`): YAML or JSON, in the
 * same shape as a spec's `questions:`.
 */
export function parseQuestionSet(text: string, from: string): QuestionSet {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (error) {
    throw new DecisionsError("invalid-request", `${from}: not valid YAML or JSON: ${String(error)}`)
  }
  // Accept a whole spec-shaped document too, so a spec's file can be reused as-is.
  const questions =
    raw &&
    typeof raw === "object" &&
    "questions" in raw &&
    !isQuestion((raw as { questions: unknown }).questions)
      ? (raw as { questions: unknown }).questions
      : raw
  try {
    assertQuestionSet(questions)
  } catch (error) {
    throw new DecisionsError("invalid-request", `${from}: ${(error as Error).message}`)
  }
  return questions as QuestionSet
}

function isQuestion(value: unknown): boolean {
  return !!value && typeof value === "object" && "type" in value && "instructions" in value
}

/** The default spec directories for a repo. */
export function specDirs(repoRoot: string, userConfigDir: string, bundled?: string): SpecDirs {
  return {
    repo: join(repoRoot, ".system1", "specs"),
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
