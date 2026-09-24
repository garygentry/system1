import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  DecisionsError,
  parseFileRef,
  parseQuestionSet,
  type SourceSpec,
} from "@garygentry/system1-core"

/** Flags shared by `ask` and `many`. One table, so help and parsing can't drift. */
export const DECIDE_OPTIONS = {
  spec: { type: "string" },
  question: { type: "string", multiple: true },
  questions: { type: "string" },
  input: { type: "string" },
  glob: { type: "string", multiple: true },
  file: { type: "string", multiple: true },
  jsonl: { type: "string" },
  diff: { type: "string" },
  staged: { type: "boolean" },
  text: { type: "string" },
  stdin: { type: "boolean" },
  exclude: { type: "string", multiple: true },
  "allow-outside": { type: "boolean" },
  split: { type: "string" },
  keep: { type: "string", multiple: true },
  "keep-any": { type: "string", multiple: true },
  sort: { type: "string" },
  limit: { type: "string" },
  fields: { type: "string" },
  "dry-run": { type: "boolean" },
  confirm: { type: "boolean" },
  record: { type: "boolean" },
  replay: { type: "boolean" },
  live: { type: "boolean" },
  model: { type: "string" },
  concurrency: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const

export type DecideFlags = ReturnType<typeof parseDecideFlags>["values"]

export function parseDecideFlags(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: DECIDE_OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    throw new DecisionsError("invalid-request", (error as Error).message)
  }
}

/**
 * `parseArgs`, with its errors typed as usage errors. Every command parses
 * through this, so an unknown flag is always exit 2 and never a bug (exit 1).
 */
export function typedParse<T extends NonNullable<Parameters<typeof parseArgs>[0]>>(
  config: T,
): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config)
  } catch (error) {
    throw new DecisionsError("invalid-request", (error as Error).message)
  }
}

/**
 * Build tool input from flags. `--input` supplies a JSON base (a file, or `-`
 * for stdin); flags given on the command line override it.
 */
export function buildInput(
  values: DecideFlags,
  readStdin: () => string,
  cwd: string = process.cwd(),
): Record<string, unknown> {
  if (values.stdin && values.input === "-") {
    throw new DecisionsError("invalid-request", "--stdin and --input - both want stdin; use one")
  }
  if (values.questions !== undefined) {
    const clash = values.spec ? "--spec" : values.question?.length ? "--question" : undefined
    if (clash) {
      throw new DecisionsError(
        "invalid-request",
        `--questions and ${clash} both give questions; use one`,
      )
    }
    if (values.questions === "-" && (values.stdin || values.input === "-")) {
      throw new DecisionsError(
        "invalid-request",
        `--questions - and ${values.stdin ? "--stdin" : "--input -"} both want stdin; put the questions in a file instead`,
      )
    }
  }
  const base = values.input ? readJson(resolve(cwd, values.input), values.input, readStdin) : {}

  const sources: SourceSpec[] = [
    ...(values.glob?.length ? [{ kind: "glob" as const, patterns: values.glob }] : []),
    ...(values.file ?? []).map((ref) => ({ kind: "file" as const, ...parseFileRef(ref) })),
    ...(values.jsonl ? [{ kind: "jsonl" as const, path: values.jsonl }] : []),
    ...(values.diff !== undefined || values.staged
      ? [
          {
            kind: "diff" as const,
            ...(values.diff ? { range: values.diff } : {}),
            ...(values.staged ? { staged: true } : {}),
          },
        ]
      : []),
    ...(values.text !== undefined ? [{ kind: "text" as const, text: values.text }] : []),
    ...(values.stdin ? [{ kind: "stdin" as const, text: readStdin() }] : []),
  ]

  const modes = (["record", "replay", "live"] as const).filter((m) => values[m])
  if (modes.length > 1)
    throw new DecisionsError("invalid-request", `Pick one of --${modes.join(", --")}`)

  const input: Record<string, unknown> = { ...base }
  const set = (key: string, value: unknown) => {
    if (value !== undefined) input[key] = value
  }
  set("spec", values.spec)
  if (values.question?.length) input.questions = parseQuestions(values.question)
  if (values.questions !== undefined) {
    const ref = values.questions
    // Inline YAML/JSON (anything multi-line, or a JSON object) leaves stdin free
    // for the content being judged.
    const inline = ref.includes("\n") || ref.trimStart().startsWith("{")
    input.questions = parseQuestionSet(
      inline ? ref : ref === "-" ? readStdin() : readText(resolve(cwd, ref), ref, "--questions"),
      inline ? "--questions (inline)" : `--questions ${ref}`,
    )
  }
  if (sources.length) input.sources = sources
  set("exclude", values.exclude?.length ? values.exclude : undefined)
  set("split", values.split)
  set("keep", values.keep?.length ? values.keep : undefined)
  set("keepAny", values["keep-any"]?.length ? values["keep-any"] : undefined)
  set("sort", values.sort)
  set("limit", int(values.limit, "--limit"))
  set(
    "fields",
    values.fields
      ? values.fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
      : undefined,
  )
  set("allowOutside", values["allow-outside"])
  set("dryRun", values["dry-run"])
  set("confirm", values.confirm)
  set("mode", modes[0])
  set("model", values.model)
  set("concurrency", int(values.concurrency, "--concurrency"))
  return input
}

/**
 * Quick inline questions:
 *
 *   name:noul:<instructions>
 *   name:choice:<instructions>:key=description|key=description|none=None of these
 *   name:score:<instructions>:level 0|level 1|level 2
 *
 * Anything richer (noul true/false criteria, long descriptions) belongs in a
 * spec file or `--input`.
 */
export function parseQuestions(texts: readonly string[]): Record<string, unknown> {
  const questions: Record<string, unknown> = {}
  for (const text of texts) {
    const m = /^([A-Za-z_][\w-]*):(noul|choice|score):([^:]+?)(?::(.+))?$/s.exec(text)
    if (!m?.[1] || !m[2] || !m[3]) {
      throw new DecisionsError(
        "invalid-request",
        `Cannot parse --question "${text}". Use name:noul:<text>, name:choice:<text>:a=..|b=.., or name:score:<text>:l0|l1|l2`,
      )
    }
    const [, name, type, instructions, rest] = m
    if (name in questions)
      throw new DecisionsError("invalid-request", `Question "${name}" given twice`)
    if (type === "noul") {
      if (rest)
        throw new DecisionsError("invalid-request", `--question "${text}": a noul takes no options`)
      questions[name] = { type, instructions: instructions.trim() }
    } else if (type === "choice") {
      const options = (rest ?? "")
        .split("|")
        .map((o) => o.trim())
        .filter(Boolean)
      const criteria = Object.fromEntries(
        options.map((o) => {
          const eq = o.indexOf("=")
          if (eq <= 0)
            throw new DecisionsError(
              "invalid-request",
              `--question "${text}": choice options are key=description`,
            )
          return [o.slice(0, eq).trim(), o.slice(eq + 1).trim()]
        }),
      )
      questions[name] = { type, instructions: instructions.trim(), criteria }
    } else {
      questions[name] = {
        type,
        instructions: instructions.trim(),
        criteria: (rest ?? "")
          .split("|")
          .map((l) => l.trim())
          .filter(Boolean),
      }
    }
  }
  return questions
}

function readJson(path: string, ref: string, readStdin: () => string): Record<string, unknown> {
  const text = ref === "-" ? readStdin() : readText(path, ref)
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("not an object")
    return value as Record<string, unknown>
  } catch (error) {
    throw new DecisionsError(
      "invalid-request",
      `--input ${ref}: not a JSON object (${(error as Error).message})`,
    )
  }
}

function readText(path: string, ref: string, flag = "--input"): string {
  try {
    return readFileSync(path, "utf8")
  } catch {
    const hint =
      flag === "--questions" && /:\s/.test(ref)
        ? " (inline questions must be JSON, or YAML spanning several lines)"
        : ""
    throw new DecisionsError("invalid-request", `${flag}: cannot read ${ref}${hint}`)
  }
}

function int(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value))
    throw new DecisionsError("invalid-request", `${flag} must be a whole number`)
  return Number(value)
}
