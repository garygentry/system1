import type { QuestionSet, State } from "../model/types.js"

/**
 * Redact secret-shaped strings before content leaves the machine. Always on.
 *
 * This is a safety net, not a guarantee: excludes keep known secret files out
 * entirely, and scrubbing catches credentials pasted into ordinary files. It
 * errs towards redacting. A false positive costs a slightly worse answer; a
 * false negative leaks a key.
 */
interface Rule {
  kind: string
  /** Matches only the secret itself; context sits in lookarounds, so it survives. */
  pattern: RegExp
}

/** A variable or key name that smells like it holds a credential. */
const SECRET_NAME =
  "[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|credential|private[_-]?key|auth)[A-Za-z0-9_.-]*"

const RULES: readonly Rule[] = [
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  { kind: "openrouter-key", pattern: /\bsk-or-(?:v1-)?[A-Za-z0-9]{32,}\b/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe-key", pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: "url-credentials", pattern: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(?=@)/gi },
  // NAME = "literal": a quoted value of 8+ chars assigned to a secret-sounding name.
  {
    kind: "assigned-secret",
    pattern: new RegExp(
      `(?<=\\b${SECRET_NAME}["']?\\s*[:=]\\s*(["']))(?!\\$\\{|<|\\[REDACTED)[^"'\\s]{8,}(?=\\1)`,
      "gi",
    ),
  },
  // NAME = value, unquoted: only when the value holds a digit and is not code
  // (no call parens, no property path), so `token = getToken()` and
  // `secret = process.env.SECRET` are left alone.
  {
    kind: "assigned-secret",
    pattern: new RegExp(
      `(?<=\\b${SECRET_NAME}\\s*[:=]\\s*)(?!\\$\\{|<|\\[REDACTED)(?=[A-Za-z_\\-+/=~]*\\d)[A-Za-z0-9_\\-+/=~]{8,}(?![\\w(.])`,
      "gi",
    ),
  },
]

export type ScrubCounts = Record<string, number>

export function scrubText(text: string, counts: ScrubCounts = {}): string {
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, () => {
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1
      return `[REDACTED:${rule.kind}]`
    })
  }
  return out
}

/** Scrub a state: the string itself, or every string leaf of an object. */
export function scrubState(state: State, counts: ScrubCounts = {}): State {
  return walk(state, counts) as State
}

/**
 * A value whose key smells like a credential, e.g. `{"password": "hunter2"}`.
 * Rules that need `name = value` context can't see a structured field on its
 * own, so the name is checked here instead.
 */
const SECRET_KEY = new RegExp(`^${SECRET_NAME}$`, "i")

function walk(value: unknown, counts: ScrubCounts, key?: string): unknown {
  if (typeof value === "string") {
    if (key !== undefined && SECRET_KEY.test(key) && value.trim().length >= 4) {
      counts["assigned-secret"] = (counts["assigned-secret"] ?? 0) + 1
      return "[REDACTED:assigned-secret]"
    }
    return scrubText(value, counts)
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, counts, key))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, counts, k)]))
  }
  return value
}

/**
 * Redact the question set itself. Instructions and criteria are sent with every
 * request, and an agent can paste content (or a credential) into them, so they
 * get the same treatment as the state.
 */
export function scrubQuestions(questions: QuestionSet, counts: ScrubCounts = {}): QuestionSet {
  return Object.fromEntries(
    Object.entries(questions).map(([name, q]) => [
      name,
      {
        ...q,
        instructions: scrubText(q.instructions, counts),
        ...(q.criteria === undefined ? {} : { criteria: scrubState(q.criteria as State, counts) }),
      },
    ]),
  ) as QuestionSet
}
