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

// Built-in triggers pair two features, each a lookahead over the whole prompt:
// an intent to judge, and something to judge (a batch, a data file, a diff, a
// rule set). Either alone is common in ordinary coding requests ("check out
// main", "list every file", "is the build done"); together they are rare.
const both = (...parts: string[]) => `^${parts.map((p) => `(?=[\\s\\S]*?(${p}))`).join("")}`

// Items of text a batch judgement runs over. Not code nouns like "requests",
// so "route all /api requests" does not read as a batch of tickets.
const ITEMS =
  "tickets?|reviews?|commits?|failures?|errors?|lines|rows?|entries|items?|issues?|comments?|" +
  "messages?|emails?|commands?|records?|files?|tests?|alerts?|findings?|results?|prs?|" +
  "pull requests?|responses?|reports?|incidents?|warnings?|changes?|hunks?|packages?|candidates?"
const FILE = "\\b[\\w./-]+\\.(?:jsonl|ndjson|csv|tsv|txt|log|sh)\\b"
const BATCH = `\\b(?:each|every|all\\s+(?:the\\s+|of\\s+the\\s+)?(?:\\d+\\s+)?(?:${ITEMS})|line\\s+by\\s+line|one\\s+by\\s+one)\\b|\\b\\d{2,}\\s+(?:[\\w-]+\\s+){0,2}(?:${ITEMS})\\b`
const RULESET =
  "\\b(?:rules?|criteri(?:a|on)|requirements?|checklist|polic(?:y|ies)|guidelines?|conventions?|standards?|our\\s+bar|TASK\\.md)\\b"
const EVIDENCE =
  "\\b(?:diff|uncommitted|working\\s+tree|staged|changes?|patch|pr|pull\\s+request|branch|test[-\\s]output(?:\\.log)?|test\\s+results?|TASK\\.md)\\b"
const GATES = "commit|merge|push|ship|release|approve|deploy|land|run"

export const BUILTIN_TRIGGERS: readonly Trigger[] = [
  {
    // "triage every CI failure", "go through tickets.jsonl and flag any where…",
    // "which of these would pass on a rerun", "the ones complaining about…"
    name: "batch-judgement",
    pattern: both(
      // A verb glued to a hyphen is another word: "rate-limit", "score-board".
      "\\b(?:(?:classify|categori[sz]e|label|triage|bucket|grade|rate|score|rank|screen|vet|judge|assess)(?!-)|sort\\s+out|" +
        "route\\s+(?:each|every|all|these|those|the)|flag\\s+(?:any|all|every|each|which|the\\s+ones|anything)|" +
        "mark\\s+(?:any|all|every|each|which|the\\s+ones)|split\\s+(?:\\w+\\s+)?into|pull\\s+out\\s+(?:the|any|all|every)|" +
        "tell\\s+me\\s+which|which\\s+of\\s+(?:them|these|those|the\\s+\\w+)|which\\s+ones|" +
        `which\\s+(?:${ITEMS})\\s+(?:could|would|might|should|are|is|will|look|seem|need)|` +
        "the\\s+ones\\s+(?:that|where|which|who|with|about|complaining|mentioning)|" +
        "anything\\s+that\\s+(?:looks|seems|sounds|reads)|is\\s+each|are\\s+any\\s+of|whether\\s+each|verdicts?)\\b",
      `${FILE}|${BATCH}`,
    ),
  },
  {
    // "250 packages. Which single one…", "which of the packages is the best fit"
    name: "pick-from-many",
    pattern: both(
      "\\b(?:best\\s+(?:fit|match|one|option|choice)|which\\s+(?:single\\s+)?one|single\\s+best|pick\\s+(?:the|one)|choose\\s+(?:the|one))\\b",
      `${FILE}|\\b\\d{2,}\\s+(?:[\\w-]+\\s+){0,2}(?:${ITEMS}|libraries|options|helpers|modules|functions)\\b|\\bout\\s+of\\s+(?:all|the|these)\\b`,
    ),
  },
  {
    // "check the diff against these rules", "does it meet the acceptance
    // criteria", "grade each criterion pass or fail", "hold the diff to our rules"
    name: "criteria-check",
    pattern: both(
      "\\b(?:against\\s+(?:our|the|these|this|my|each|every)?\\s*(?:[\\w-]+\\s+){0,2}(?:rules?|criteri(?:a|on)|requirements?|checklist|polic(?:y|ies)|guidelines?|conventions?|standards?|spec)|" +
        "hold\\s+(?:it|this|them|the\\s+[\\w-]+(?:\\s+[\\w-]+)?)\\s+(?:up\\s+)?(?:to|against)|meets?|satisf(?:y|ies)|violat\\w*|compl(?:y|ies|iant)|" +
        "pass(?:es)?\\s+(?:our|the)\\s+(?:bar|rules|checks?|checklist)|pass\\s+or\\s+fail|pass/fail|per[-\\s]criteri(?:on|a)|tick\\s+off|" +
        "(?:one|a|separate)\\s+verdict|verdicts?\\s+(?:for|on)|grade\\s+(?:each|every|them|it)|" +
        "(?:each|every)\\s+(?:acceptance\\s+)?(?:criteri(?:on|a)|rule|requirement|checklist\\s+item|item))\\b",
      RULESET,
    ),
  },
  {
    // "is the task actually done?", "am i done?", "ready to merge?", "can I ship this"
    name: "done-check",
    pattern: both(
      "\\b(?:am\\s+i\\s+(?:actually\\s+|really\\s+)?done|are\\s+we\\s+(?:actually\\s+|really\\s+)?done|" +
        // The subject, not a part of it: "is my PR done", not "is my PR description complete".
        "is\\s+(?:it|this|that|(?:the|my|our)\\s+\\w+(?!\\s+(?:description|message|title|name|docs?|readme|summary|text|comment)))(?:\\s+[\\w.]+){0,4}?\\s+(?:actually\\s+|really\\s+|fully\\s+|truly\\s+)?(?:done|complete|finished)|" +
        "(?:ready|good|ok|safe)\\s+to\\s+(?:merge|ship|commit|push|land|release)|can\\s+(?:i|we)\\s+(?:ship|merge|land|commit|push)\\s+(?:this|it)|" +
        "(?:about|going)\\s+to\\s+(?:open\\s+a\\s+pr|merge|ship|push|commit|release))\\b",
      `${EVIDENCE}|${FILE}`,
      "\\?|\\b(?:check|verify|confirm|tell\\s+me|make\\s+sure|grade|hold)\\b",
    ),
  },
  {
    // "before I commit… is it safe?", "which commands could lose data before the bot runs it"
    name: "gate-check",
    pattern: both(
      `\\bbefore\\s+(?:i|we|the\\s+\\w+)\\s+(?:${GATES})s?\\b`,
      `${RULESET}|\\b(?:safe|destructive|verdict|violat\\w*|could\\s+(?:lose|break|delete|destroy|wipe))\\b`,
    ),
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
  /** The text that matched (for a paired trigger, each part), trimmed to 120 characters. */
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
    // A lookahead matches nothing itself; its captured parts say what fired.
    const text = m?.[0] || m?.slice(1).filter(Boolean).join(" … ")
    if (m) hits.push({ name: t.name, source: t.source, text: (text ?? "").slice(0, 120) })
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
