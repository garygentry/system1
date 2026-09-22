export { assertConsent, setConsent } from "./config/consent.js"
export type {
  Budget,
  Consent,
  DecisionsConfig,
  LoadOptions,
  ResolvedConfig,
} from "./config/load.js"
export {
  allProfiles,
  DEFAULTS,
  findRepoRoot,
  loadConfig,
  repoConfigPath,
  userConfigDir,
} from "./config/load.js"
export type { DetectedSession, Harness } from "./config/session.js"
export { detectHarness, detectSession } from "./config/session.js"
export type { DecideInput, DecideMode, Decider, DeciderOptions, DecisionResult } from "./decide.js"
export { createDecider } from "./decide.js"
export { applyExcludes, DEFAULT_EXCLUDES, isExcluded } from "./egress/exclude.js"
export type { ScrubCounts } from "./egress/scrub.js"
export { scrubQuestions, scrubState, scrubText } from "./egress/scrub.js"
export { assertStateFits, CHARS_PER_TOKEN, estimateTokens } from "./egress/size.js"
export type { ErrorCode } from "./errors.js"
export { DecisionsError, isDecisionsError, ProviderError } from "./errors.js"
export type { FixtureRecord } from "./fixtures/store.js"
export { canonicalJson, FIXTURE_VERSION, FixtureStore, fixtureKey } from "./fixtures/store.js"
export {
  confidenceOf,
  DEFAULT_UNDECIDED_FLOOR,
  isChoice,
  isNoul,
  isScore,
  isUndecided,
  noulConfidence,
  rankedProbabilities,
  undecidedNames,
} from "./model/answers.js"
export type { ModelProfile } from "./model/profiles.js"
export { DEFAULT_MODEL_ID, PROFILES, projectCost, resolveProfile } from "./model/profiles.js"
export type * from "./model/types.js"
export { assertQuestionSet, parseDecisionResponse } from "./model/validate.js"
export type { PingOptions, PingResult } from "./ping.js"
export { ping, probeUrl } from "./ping.js"
export type { Prepared, PrepareInput } from "./prepare.js"
export { prepare } from "./prepare.js"
export type { Filter, Op, Projected, SortKey } from "./project/project.js"
export { matches, parseFilter, parseSort, project as projectRows } from "./project/project.js"
export type { Projection } from "./run/budget.js"
export { checkBudget, project } from "./run/budget.js"
export { mapWithConcurrency } from "./run/pool.js"
export type { AnswerSource, SpendEntry, SpendSummary } from "./run/spend.js"
export { SpendLedger, sumUsage } from "./run/spend.js"
export { gitIgnored, parseFileRef, readSources, splitDiffByFile } from "./sources/read.js"
export type { Document, Item, LineRange, Skipped, SourceSpec } from "./sources/types.js"
export type { Expectation } from "./spec/expect.js"
export { describeExpectation, meets, parseExpect } from "./spec/expect.js"
export type { Spec, SpecDirs, SpecFile, SpecListing } from "./spec/spec.js"
export {
  assertExamples,
  exampleProblems,
  listSpecs,
  loadSpec,
  parseQuestionSet,
  parseSpec,
  SpecSchema,
  specDirs,
} from "./spec/spec.js"
export type { SplitSpec } from "./split/split.js"
export { parseSplit, split } from "./split/split.js"
export type { AskResult } from "./tools/ask.js"
export { runAsk } from "./tools/ask.js"
export type { ContextOptions, ToolContext } from "./tools/context.js"
export { createContext, deciderFor } from "./tools/context.js"
export type { CheckStatus, DoctorCheck, DoctorOptions, DoctorResult } from "./tools/doctor.js"
export { CODEX_RULE, runDoctor, which } from "./tools/doctor.js"
export type { ManyResult, ResultRow, SkippedSummary } from "./tools/many.js"
export { runMany, summariseSkipped } from "./tools/many.js"
export type { ToolName } from "./tools/schemas.js"
export { AskInput, ManyInput, SpecCheckInput, TOOL_SCHEMAS, UsageInput } from "./tools/schemas.js"
export type { ExampleResult, ExampleStatus, SpecCheckResult } from "./tools/spec-check.js"
export { runSpecCheck } from "./tools/spec-check.js"
export type { UsageResult } from "./tools/usage.js"
export { runUsage } from "./tools/usage.js"
export type { Transport, TransportOptions, TransportResult } from "./transport/openrouter.js"
export {
  createOpenRouterTransport,
  DEFAULT_TIMEOUT_MS,
  RETRY_STATUSES,
} from "./transport/openrouter.js"
export { CLI_PACKAGE, VERSION } from "./version.js"
export type { ConnectionConfig, EnvDeciderOptions } from "./wiring.js"
export {
  createDeciderFromEnv,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  resolveConnection,
  stateDir,
} from "./wiring.js"
