/**
 * Prompt routing hints (decision 0018).
 *
 * A harness hook passes the user's prompt here before the agent sees it. When
 * the prompt plainly asks for closed judgements (a verdict per rule, per item,
 * or one pick out of many), the result carries a one-line hint telling the
 * agent to use the `ask` skill. Nothing is sent anywhere: this is local
 * pattern matching, so egress consent does not apply.
 *
 * Every part is configurable under `route:` in the config layers, so users
 * can switch it off, drop a built-in trigger, add their own, or veto prompts.
 */
import { DecisionsError } from "../errors.js"

export interface Trigger {
  name: string
  /** A JavaScript regular expression, matched case-insensitively. */
  pattern: string
}

export interface RouteConfig {
  /** false: the hook stays installed but never hints. */
  enabled: boolean
  /** false: only the triggers from config apply. */
  builtin: boolean
  /** Built-in trigger names to switch off. */
  disable: string[]
  /** Extra triggers, after the built-ins. */
  triggers: Trigger[]
  /** A prompt matching any of these never gets a hint. */
  ignore: string[]
  /** Replaces the default hint. `{triggers}` expands to the matched names. */
  message?: string
}

export const ROUTE_DEFAULTS: RouteConfig = {
  enabled: true,
  builtin: true,
  disable: [],
  triggers: [],
  ignore: [],
}

// Nouns a batch judgement runs over. Kept to things that are items of text,
// so "route all /api requests" (code) does not read as a batch of tickets.
const ITEMS =
  "tickets?|reviews?|commits?|failures?|errors?|log lines?|lines|rows?|entries|entry|items?|issues?|" +
  "comments?|messages?|emails?|commands?|records?|files?|tests?|alerts?|findings?|results?|" +
  "prs?|pull requests?|responses?|reports?|incidents?|warnings?|changes?|hunks?|dependencies|packages?"
const GATES = "commit|merge|push|ship|release|approve|deploy|land"
const RULES =
  "rules?|criteri(?:a|on)|requirements?|checklist|polic(?:y|ies)|guidelines?|conventions?|standards?"

export const BUILTIN_TRIGGERS: readonly Trigger[] = [
  {
    // "check the diff against these rules", "verify the log against the checklist"
    name: "criteria-check",
    pattern: `\\b(?:check|verify|validate|audit|review|vet|compare|go (?:over|through))\\b[^.?!\\n]{0,80}\\bagainst\\b[^.?!\\n]{0,80}\\b(?:${RULES}|spec(?:ification)?)\\b`,
  },
  {
    // "one verdict each", "a verdict for every command", "check each acceptance criterion"
    name: "verdict-per-item",
    pattern: `\\b(?:(?:one|a|separate)\\s+verdict\\s+(?:each|per|for\\s+(?:each|every)|on\\s+(?:each|every))|verdicts?\\s+(?:for|on)\\s+(?:each|every)|(?:each|every)\\s+(?:acceptance\\s+)?(?:criteri(?:a|on)|rule|requirement|checklist\\s+item))\\b`,
  },
  {
    // "is the task in TASK.md actually done?", "does this diff meet the requirements?"
    name: "done-check",
    pattern: `\\bis\\s+(?:the|this|my|our|that)\\s+(?:task|ticket|story|issue|feature|work|change|pr|fix|todo)\\b[^?\\n]{0,60}?\\b(?:actually\\s+|really\\s+|fully\\s+|truly\\s+)?(?:done|complete|completed|finished)\\b|\\b(?:does|do)\\s+(?:this|the|my|our)\\s+(?:diff|change|changes|pr|patch|commit|branch)\\s+(?:actually\\s+|really\\s+|fully\\s+)?(?:meet|satisf(?:y|ies)|fulfil+|cover)\\b`,
  },
  {
    // "before I commit, is this safe?", "vet it against the policy before we merge"
    name: "gate-check",
    pattern: `\\bbefore\\s+(?:i|we)\\s+(?:${GATES})\\b[^\\n]{0,100}\\b(?:${RULES}|safe|destructive|verdict)\\b|\\b(?:${RULES}|safe|destructive|verdict)\\b[^\\n]{0,100}\\bbefore\\s+(?:i|we)\\s+(?:${GATES})\\b`,
  },
  {
    // "triage every CI failure", "route each of the support tickets"
    name: "batch-judgement",
    pattern: `\\b(?:classify|categori[sz]e|route|triage|label|screen|vet|bucket|grade|rate|score|rank|assess|judge|sort\\s+out|flag\\s+(?:any|all|every|each|which))\\b[^.?!\\n]{0,60}\\b(?:each|every|all|these|those|the\\s+\\d+)\\b[^.?!\\n]{0,30}?\\b(?:${ITEMS})\\b`,
  },
  {
    // "300 commits. Which of them…", "250 packages. Which single one…"
    name: "pick-from-many",
    pattern: `\\b\\d{2,}\\s+(?:[\\w-]+\\s+){0,3}(?:${ITEMS}|libraries|options|helpers|modules|functions|candidates)\\b[^\\n]{0,160}?\\bwhich\\s+(?:of\\s+(?:them|these|those)|ones?|single|one)\\b`,
  },
]

/** A prompt that opts out in words never gets a hint. */
export const BUILTIN_IGNORE: readonly string[] = [
  "\\b(?:don'?t|do\\s+not|without)\\s+(?:use\\s+|using\\s+)?(?:system\\s?1|decide)\\b",
]

export const DEFAULT_MESSAGE =
  "System 1 routing hint ({triggers}): this request is a closed judgement over text. " +
  "Load the system1:ask skill and hand the verdicts to `decide` instead of grading them yourself, " +
  "unless the user has said not to."

export interface RouteMatch {
  name: string
  source: "builtin" | "config"
  /** The text that matched, trimmed to 120 characters. */
  text: string
}

export interface RouteResult {
  enabled: boolean
  matched: boolean
  triggers: RouteMatch[]
  /** The ignore pattern that vetoed a match. */
  ignoredBy?: string
  /** The hint to show the agent; present only when matched. */
  message?: string
}

/** Compile a pattern from config, naming where it came from when it is invalid. */
export function compilePattern(pattern: string, where: string): RegExp {
  try {
    return new RegExp(pattern, "i")
  } catch (error) {
    throw new DecisionsError(
      "config-error",
      `${where}: invalid regular expression ${JSON.stringify(pattern)}: ${(error as Error).message}`,
      { pattern },
    )
  }
}

export function activeTriggers(
  config: RouteConfig,
): Array<Trigger & { source: RouteMatch["source"] }> {
  const unknown = config.disable.filter((n) => !BUILTIN_TRIGGERS.some((t) => t.name === n))
  if (unknown.length > 0) {
    throw new DecisionsError(
      "config-error",
      `route.disable names unknown built-in trigger(s): ${unknown.join(", ")}. ` +
        `Built-ins: ${BUILTIN_TRIGGERS.map((t) => t.name).join(", ")}`,
    )
  }
  const builtins = config.builtin
    ? BUILTIN_TRIGGERS.filter((t) => !config.disable.includes(t.name))
    : []
  return [
    ...builtins.map((t) => ({ ...t, source: "builtin" as const })),
    ...config.triggers.map((t) => ({ ...t, source: "config" as const })),
  ]
}

export function route(prompt: string, config: RouteConfig): RouteResult {
  const triggers = activeTriggers(config)
  const ignore = [...(config.builtin ? BUILTIN_IGNORE : []), ...config.ignore]
  // Compile everything first, so a bad pattern is reported even when disabled.
  const compiled = triggers.map((t) => ({
    ...t,
    re: compilePattern(t.pattern, `route trigger "${t.name}"`),
  }))
  const vetoes = ignore.map((p) => ({ p, re: compilePattern(p, "route.ignore") }))
  if (!config.enabled) return { enabled: false, matched: false, triggers: [] }

  const hits: RouteMatch[] = []
  for (const t of compiled) {
    const m = t.re.exec(prompt)
    if (m) hits.push({ name: t.name, source: t.source, text: m[0].slice(0, 120) })
  }
  if (hits.length === 0) return { enabled: true, matched: false, triggers: [] }
  const veto = vetoes.find((v) => v.re.test(prompt))
  if (veto) return { enabled: true, matched: false, triggers: hits, ignoredBy: veto.p }
  const names = hits.map((h) => h.name).join(", ")
  return {
    enabled: true,
    matched: true,
    triggers: hits,
    message: (config.message ?? DEFAULT_MESSAGE).replaceAll("{triggers}", names),
  }
}
