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

/** An option key token that lets the model say "none of these": `none`, `other_change`, `n/a`. */
const WAY_OUT_KEY =
  /^(none|other|others|unclear|unknown|neither|na|nomatch|unsure|mixed|else|nothing|irrelevant|unrelated)$/i
/** …or a description that does. */
const WAY_OUT_TEXT =
  /\b(none of|any other|anything else|something else|neither|unclear|not (?:clear|sure|applicable|enough)|no match|does(?:n't| not) (?:fit|apply)|other than (?:these|the above))\b/i

/**
 * Things a decision model can't do (question-craft rule 8), by kind. Each is a
 * phrase that asks for the thing, not a word that names it: "validates the date
 * format" is a fine question, "is older than 30 days" is arithmetic on dates.
 */
const UNSUPPORTED: Array<{ kind: string; pattern: RegExp }> = [
  {
    kind: "counting or arithmetic",
    pattern:
      /(^\s*count\b|\bhow many\b|\bthe number of\b|\bcount (?:all|every|each|how|the number)\b|\b(?:more|fewer|less|greater|longer|shorter|larger|smaller|higher|lower) than \d|\b(?:over|under|above|below|at least|at most|exactly|up to) \d|\b\d+(?:\.\d+)?\s?(?:%|percent)|\bsum of\b|\btotal of\b|\baverage of\b|\bon average\b)/i,
  },
  {
    kind: "dates",
    pattern:
      /(\b(?:older|newer|younger) than \d+ (?:days?|weeks?|months?|years?)\b|\b\d+ (?:days?|weeks?|months?|years?) (?:ago|old)\b|\b(?:within|in) the (?:last|past|next) \d+ (?:days?|weeks?|months?|years?)\b|\b(?:yesterday|tomorrow)\b|\b(?:this|last|next) (?:week|month|quarter|year)\b|\b(?:before|after|since|until|by) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|(?:19|20)\d\d)\b|\b(?:has|is|was) (?:expired|overdue)\b)/i,
  },
  {
    kind: "images",
    pattern:
      /(\bscreenshot|\bphoto(?:graph)?s?\b|\b(?:the|this|an?) (?:image|picture) (?:shows?|contains?|depicts?)\b|\b(?:visible|shown|appears?|seen) in (?:the|this|an?) (?:image|picture)\b)/i,
  },
  {
    kind: "an exact fact to read or run, not judge",
    pattern:
      /(\b(?:all|every|the) tests? (?:pass(?:es|ed)?|fail(?:s|ed)?|succeed(?:s|ed)?)\b|\btests? (?:pass(?:es|ed)?|are (?:passing|green))\b|\b(?:the )?(?:build|ci|pipeline) (?:passes|passed|succeeds|succeeded|is green)\b|\b(?:it )?compiles without errors\b)/i,
  },
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

export function lintSpec(
  spec: Pick<Spec, "questions" | "keep" | "keepAny" | "policy">,
): LintFinding[] {
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
  const filters = [
    ...(spec.keep ?? []).map((text) => ({ text, list: "keep" })),
    ...(spec.keepAny ?? []).map((text) => ({ text, list: "keepAny" })),
  ]
  for (const { text, list } of filters) {
    const { question, op } = parseFilter(text, spec.questions)
    // Only a numeric cut is a threshold; `kind=fix` has no value to justify.
    if (!NUMERIC.has(op)) continue
    if (justified.has(question) || reported.has(question)) continue
    reported.add(question)
    out.push(
      finding(
        "unjustified-threshold",
        `${list} "${text}" has no policy.thresholds.${question} saying why`,
        `Add policy.thresholds.${question}: {value, why}, with the cost of a wrong keep and a wrong drop (see thresholds.md).`,
        question,
      ),
    )
  }
  return out
}

const NUMERIC = new Set([">=", ">", "<=", "<"])

function lintQuestion(name: string, q: Question): LintFinding[] {
  const out: LintFinding[] = []
  const texts = [q.instructions, ...criteriaTexts(q)]
  if (q.type === "choice") {
    const options = Object.entries(q.criteria)
    const wayOut = ([key, desc]: [string, string]) =>
      key.split(/[_\-\s/]+/).some((t) => WAY_OUT_KEY.test(t)) || WAY_OUT_TEXT.test(desc)
    if (!options.some(wayOut)) {
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
  // Quoted text in criteria is an example of what to spot ("stop after 20
  // tries"), not the ask; the instructions are linted as written.
  out.push(...unsupported([q.instructions, ...criteriaTexts(q).map(unquoted)].join("\n"), name))
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
 * Two claims in one instruction: two statements or questions, an "and/or", or
 * "either … or". A plain "and" is too common in single ideas to flag, and
 * framing sentences ("Consider only the added lines.", "Answer true if …")
 * are context, not a second claim.
 */
function merged(instructions: string): boolean {
  const claims = instructions
    .replace(/\bhttps?:\/\/\S+/gi, "URL")
    .replace(/\b(e\.g|i\.e|etc|vs|cf|mr|mrs|ms|dr|st|no|approx)\./gi, "$1")
    .split(/[.?!](?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => words(s) >= 3 && !FRAMING.test(s))
  return (
    claims.length > 1 ||
    /\band\/or\b/i.test(instructions) ||
    /\beither\b.+\bor\b/i.test(instructions)
  )
}

/** Sentences that frame the question rather than make a second claim. */
const FRAMING =
  /^(consider|only|ignore|answer|note|treat|assume|look|focus|read|judge|use|do not|don't|exclude|include|given|for example|e\.g|if|when|here|this question|count only|disregard)\b/i

function unquoted(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”/g, '""')
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
