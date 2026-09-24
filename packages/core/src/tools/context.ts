import { isAbsolute, join, relative } from "node:path"
import { Value } from "typebox/value"
import {
  allProfiles,
  loadConfig,
  type ResolvedConfig,
  stateDir,
  userConfigDir,
} from "../config/load.js"
import { createDecider, type DecideMode, type Decider } from "../decide.js"
import { DecisionsError } from "../errors.js"
import { FixtureStore } from "../fixtures/store.js"
import { type ModelProfile, resolveProfile } from "../model/profiles.js"
import type { QuestionSet } from "../model/types.js"
import { parseFilter, parseSort } from "../project/project.js"
import { SpendLedger } from "../run/spend.js"
import type { SourceSpec } from "../sources/types.js"
import { loadSpec, type Spec, type SpecDirs, specDirs } from "../spec/spec.js"
import { parseSplit, type SplitSpec } from "../split/split.js"
import { createOpenRouterTransport } from "../transport/openrouter.js"
import { TOOL_SCHEMAS, type ToolName } from "./schemas.js"

/** Everything a tool needs, resolved once per invocation. */
export interface ToolContext {
  cwd: string
  config: ResolvedConfig
  specDirs: SpecDirs
  fetch?: typeof fetch
}

export interface ContextOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  home?: string
  /**
   * The lowest-priority spec directory (origin `bundled`). No package ships
   * one today; `SYSTEM1_SPECS_PATH` sets it and wins over this option.
   */
  bundledSpecs?: string
  fetch?: typeof fetch
}

export function createContext(options: ContextOptions = {}): ToolContext {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const config = loadConfig({ cwd, env, ...(options.home ? { home: options.home } : {}) })
  const bundled = env.SYSTEM1_SPECS_PATH?.trim() || options.bundledSpecs
  return {
    cwd,
    config,
    specDirs: specDirs(config.repoRoot, userConfigDir(env, options.home), bundled),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }
}

/** Validate tool input against its schema, reporting every problem. */
export function checkInput<T>(tool: ToolName, input: unknown): T {
  const schema = TOOL_SCHEMAS[tool]
  const problems = [...Value.Errors(schema, input)].map(
    (e) => `${e.instancePath || "/"} ${e.message}`,
  )
  if (problems.length > 0) {
    throw new DecisionsError(
      "invalid-request",
      `Invalid ${tool} input:\n  ${problems.join("\n  ")}`,
      { problems },
    )
  }
  return input as T
}

export interface Resolved {
  spec?: Spec
  namespace: string
  questions: QuestionSet
  sources: SourceSpec[]
  split: SplitSpec
  keep: ReturnType<typeof parseFilter>[]
  keepAny: ReturnType<typeof parseFilter>[]
  sort?: ReturnType<typeof parseSort>
  profile: ModelProfile
  /** `--exclude` patterns, re-anchored to the repo root like command-line sources. */
  exclude: string[]
}

/** Merge a spec's defaults with explicit input. Explicit input wins; inline questions and a spec conflict. */
export function resolveRequest(
  ctx: ToolContext,
  input: {
    spec?: string
    questions?: Record<string, unknown>
    sources?: SourceSpec[]
    exclude?: string[]
    split?: string
    keep?: string[]
    keepAny?: string[]
    sort?: string
    model?: string
  },
): Resolved {
  if (input.spec && input.questions) {
    throw new DecisionsError("invalid-request", "Give either a spec or inline questions, not both")
  }
  const spec = input.spec ? loadSpec(input.spec, ctx.specDirs, ctx.cwd) : undefined
  const questions = (spec?.questions ?? input.questions) as QuestionSet | undefined
  if (!questions) {
    throw new DecisionsError(
      "invalid-request",
      "No questions: pass --spec <name>, --question, or --input with questions",
    )
  }
  // Paths typed on the command line mean what the shell means by them; a
  // spec's own defaults stay anchored to the repo, wherever it is run from.
  const sources = input.sources?.length
    ? input.sources.map((source) => rebase(source, ctx.cwd, ctx.config.repoRoot))
    : specSources(spec)
  if (sources.length === 0) {
    throw new DecisionsError(
      "invalid-request",
      "No source: pass --glob, --file, --jsonl, --diff, --text or --stdin (or use a spec with a source)",
    )
  }
  const keepText = input.keep ?? spec?.keep ?? []
  const sortText = input.sort ?? spec?.sort
  const profile = resolveProfile(input.model ?? ctx.config.model, allProfiles(ctx.config))
  return {
    ...(spec ? { spec } : {}),
    namespace: spec?.name ?? "adhoc",
    questions,
    sources,
    split: parseSplit(input.split ?? spec?.source?.split ?? "file"),
    keep: keepText.map((k) => parseFilter(k, questions)),
    keepAny: (input.keepAny ?? spec?.keepAny ?? []).map((k) => parseFilter(k, questions)),
    ...(sortText ? { sort: parseSort(sortText, questions) } : {}),
    profile,
    exclude: (input.exclude ?? []).map((p) => rebasePattern(p, ctx.cwd, ctx.config.repoRoot)),
  }
}

/**
 * A command-line exclude pattern means what `--glob` would mean from the same
 * directory. A pattern that starts with a globstar already matches anywhere,
 * so it isn't narrowed to the directory. An absolute pattern is made repo-relative; one outside the repo
 * matches nothing, and a negation would invert the filter, so both are refused.
 */
function rebasePattern(pattern: string, cwd: string, repoRoot: string): string {
  if (pattern.startsWith("!")) {
    throw new DecisionsError(
      "invalid-request",
      `--exclude "${pattern}": negation isn't supported; name what to leave out`,
    )
  }
  if (isAbsolute(pattern)) {
    const rel = relative(repoRoot, pattern)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new DecisionsError(
        "invalid-request",
        `--exclude "${pattern}" is outside the repo (${repoRoot}), so it would match nothing`,
      )
    }
    return rel
  }
  const prefix = relative(repoRoot, cwd)
  if (prefix === "" || prefix.startsWith("..") || isAbsolute(prefix) || pattern.startsWith("**/"))
    return pattern
  return join(prefix, pattern)
}

/**
 * Re-anchor a source given on the command line from the invocation directory
 * to the repo root, which is what the reader resolves against. Without this,
 * `decide many --file a.ts` in `src/` reads `<repo>/a.ts`.
 */
function rebase(source: SourceSpec, cwd: string, repoRoot: string): SourceSpec {
  const prefix = relative(repoRoot, cwd)
  if (prefix === "" || prefix.startsWith("..") || isAbsolute(prefix)) return source
  const move = (path: string) => (isAbsolute(path) ? path : join(prefix, path))
  switch (source.kind) {
    case "file":
      return { ...source, path: move(source.path) }
    case "jsonl":
      return { ...source, path: move(source.path) }
    case "glob":
      return { ...source, patterns: source.patterns.map(move) }
    case "diff":
      return source.paths ? { ...source, paths: source.paths.map(move) } : source
    default:
      return source
  }
}

function specSources(spec: Spec | undefined): SourceSpec[] {
  const s = spec?.source
  if (!s) return []
  return [
    ...(s.glob ? [{ kind: "glob" as const, patterns: s.glob }] : []),
    ...(s.file ? [{ kind: "file" as const, path: s.file }] : []),
    ...(s.jsonl ? [{ kind: "jsonl" as const, path: s.jsonl }] : []),
    ...(s.diff !== undefined
      ? [{ kind: "diff" as const, ...(s.diff ? { range: s.diff } : {}) }]
      : []),
  ]
}

/** A decider wired to this context's config: transport only with a key, consent from the repo. */
export function deciderFor(
  ctx: ToolContext,
  profile: ModelProfile,
  mode: DecideMode = "auto",
): Decider {
  const { config } = ctx
  const dir = stateDir(config.repoRoot)
  return createDecider({
    profile,
    egressConsent: config.egress.consent.granted,
    repoRoot: config.repoRoot,
    ...(config.apiKey
      ? {
          transport: createOpenRouterTransport({
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            timeoutMs: config.timeoutMs,
            ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
          }),
        }
      : {}),
    fixtures: new FixtureStore(join(dir, "fixtures")),
    ledger: new SpendLedger(join(dir, "usage.jsonl")),
    mode: config.replay ? "replay" : mode,
    ...(config.session ? { session: config.session } : {}),
  })
}

export function ledgerFor(ctx: ToolContext): SpendLedger {
  return new SpendLedger(join(stateDir(ctx.config.repoRoot), "usage.jsonl"))
}
