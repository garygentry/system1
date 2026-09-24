import type { Question, QuestionSet } from "../model/types.js"
import { parseFilter } from "../project/project.js"
import type { Spec } from "./spec.js"

/**
 * An offline lint for question sets: no key, no consent, nothing sent. It
 * catches the failure modes of `references/question-craft.md` that can be seen
 * in the text of a spec. Two catalogue entries can't be judged offline and are
 * left to the `design` skill: criteria a literal reader takes the wrong way,
 * and questions written for different states mixed into one set.
 *
 * Almost every check is a heuristic, so it warns: a competent question can
 * trip one. Only checks that are mechanically certain are errors.
 */
export const LINT_CHECKS = [
  "no-way-out",
  "abstract-levels",
  "unsupported-task",
  "merged-question",
  "unjustified-threshold",
  "unknown-threshold",
] as const

export type LintCheck = (typeof LINT_CHECKS)[number]
export type LintSeverity = "error" | "warning"

export const LINT_SEVERITY: Record<LintCheck, LintSeverity> = {
  "no-way-out": "warning",
  "abstract-levels": "warning",
  "unsupported-task": "warning",
  "merged-question": "warning",
  "unjustified-threshold": "warning",
  "unknown-threshold": "error",
}

export interface LintFinding {
  check: LintCheck
  severity: LintSeverity
  /** The question it is about, when it is about one. */
  question?: string
  message: string
  /** The repair, in question-craft terms. */
  fix: string
}

/** An option key or description that lets the model say "none of these". */
const WAY_OUT =
  /^(none|other|unclear|unknown|neither|n\/?a|no[-_ ]?match|not[-_ ]?applicable|unsure|mixed)$|\bnone of (these|the above)\b|\bnot (clear|applicable|enough)\b|\bno match\b|\bsomething else\b/i

/** Things a decision model can't do (question-craft rule 8), by kind. */
const UNSUPPORTED: Array<{ kind: string; pattern: RegExp }> = [
  {
    kind: "counting or arithmetic",
    pattern:
      /\b(how many|number of|count(?:s|ing)? (?:of|the)|more than \d|fewer than \d|less than \d|at least \d|at most \d|exactly \d|sum of|total of|average|percentage|\d+\s?%)/i,
  },
  {
    kind: "dates",
    pattern:
      /\b(dated?|days? (?:ago|old)|weeks? (?:ago|old)|months? (?:ago|old)|older than|newer than|expir(?:ed|es|y)|yesterday|tomorrow|this (?:week|month|year)|last (?:week|month|year))\b/i,
  },
  { kind: "images", pattern: /\b(image|screenshot|picture|photo(?:graph)?)s?\b/i },
]

/** Lint one question set. `lintSpec` adds the checks that need a policy. */
export function lintQuestions(questions: QuestionSet): LintFinding[] {
  const out: LintFinding[] = []
  for (const [name, q] of Object.entries(questions)) {
    out.push(...lintQuestion(name, q))
  }
  return out
}

/**
 * Lint one statement on its own: the unsupported-task check only. For text
 * that becomes a question without being written as one, such as an acceptance
 * criterion read from a task file.
 */
export function lintStatement(text: string, question?: string): LintFinding[] {
  return unsupported(text, question)
}

export function lintSpec(spec: Pick<Spec, "questions" | "keep" | "policy">): LintFinding[] {
  const out = lintQuestions(spec.questions)
  const thresholds = spec.policy?.thresholds ?? {}
  for (const name of Object.keys(thresholds)) {
    if (!(name in spec.questions)) {
      out.push(
        finding(
          "unknown-threshold",
          `policy.thresholds.${name} names no question in this spec`,
          `Rename it to one of: ${Object.keys(spec.questions).join(", ")}, or remove it.`,
        ),
      )
    }
  }
  const justified = new Set(Object.keys(thresholds))
  const reported = new Set<string>()
  for (const text of spec.keep ?? []) {
    const { question } = parseFilter(text, spec.questions)
    if (justified.has(question) || reported.has(question)) continue
    reported.add(question)
    out.push(
      finding(
        "unjustified-threshold",
        `keep "${text}" has no policy.thresholds.${question} saying why`,
        `Add policy.thresholds.${question}: {value, why}, with the cost of a wrong keep and a wrong drop (see thresholds.md).`,
        question,
      ),
    )
  }
  return out
}

function lintQuestion(name: string, q: Question): LintFinding[] {
  const out: LintFinding[] = []
  const texts = [q.instructions, ...criteriaTexts(q)]
  if (q.type === "choice") {
    const options = Object.entries(q.criteria)
    if (!options.some(([key, desc]) => WAY_OUT.test(key) || WAY_OUT.test(desc))) {
      out.push(
        finding(
          "no-way-out",
          `choice "${name}" has no none/other/unclear option`,
          "Add an option such as `none: None of these apply`, so text that fits nothing isn't forced onto an option.",
          name,
        ),
      )
    }
  }
  if (q.type === "score" && q.criteria.every((level) => words(level) <= 2)) {
    out.push(
      finding(
        "abstract-levels",
        `score "${name}" has one- or two-word levels (${q.criteria.join(" | ")})`,
        "Describe each level as a concrete situation someone could spot in the text, lowest first.",
        name,
      ),
    )
  }
  // All of a question's text at once: one finding per kind, not per phrase.
  out.push(...unsupported(texts.join("\n"), name))
  if (merged(q.instructions)) {
    out.push(
      finding(
        "merged-question",
        `"${name}" looks like two questions in one`,
        "Split it into one question per idea and combine the answers with --keep.",
        name,
      ),
    )
  }
  return dedupe(out)
}

function unsupported(text: string, question?: string): LintFinding[] {
  return UNSUPPORTED.filter(({ pattern }) => pattern.test(text)).map(({ kind, pattern }) =>
    finding(
      "unsupported-task",
      `${question ? `"${question}" ` : ""}asks for ${kind} ("${pattern.exec(text)?.[0]}")`,
      "Do that part in code (grep, a date check, a count) and ask the model only about what's left.",
      question,
    ),
  )
}

/**
 * Two sentences, an "and/or", or "either … or" in one instruction. A plain
 * "and" is too common in single ideas to flag.
 */
function merged(instructions: string): boolean {
  const sentences = instructions
    .replace(/\b(e\.g|i\.e|etc|vs|cf)\./gi, "$1")
    .split(/[.?!](?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => words(s) >= 3)
  return (
    sentences.length > 1 ||
    /\band\/or\b/i.test(instructions) ||
    /\beither\b.+\bor\b/i.test(instructions)
  )
}

function criteriaTexts(q: Question): string[] {
  if (q.type === "noul") return q.criteria ? Object.values(q.criteria) : []
  if (q.type === "choice") return Object.values(q.criteria)
  return q.criteria
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function finding(check: LintCheck, message: string, fix: string, question?: string): LintFinding {
  return {
    check,
    severity: LINT_SEVERITY[check],
    ...(question ? { question } : {}),
    message,
    fix,
  }
}

/** One finding per check, question and message. */
function dedupe(findings: LintFinding[]): LintFinding[] {
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.check}\0${f.question ?? ""}\0${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
