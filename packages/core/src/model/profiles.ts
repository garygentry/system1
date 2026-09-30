import { DecisionsError } from "../errors.js"
import { DEFAULT_UNDECIDED_FLOOR } from "./answers.js"

/**
 * Everything the engine needs to know about one decision model, as data.
 *
 * A new model that shares the wire contract is a new entry here, not new code
 * (decision 0003). `transport` names how it is reached:
 * - `openrouter-decisions`: a decision model (Jev). Every decision path uses it.
 * - `openrouter-chat`: an *emulated* baseline, a chat model asked for the same
 *   answers as JSON (M11). Its answers are single values, never calibrated
 *   distributions, so it is refused everywhere but `compare`.
 */
export interface ModelProfile {
  /** The id sent on the wire. */
  id: string
  displayName: string
  transport: TransportKind
  /** Hard cap on one state. Oversized states are refused, never truncated. */
  maxStateTokens: number
  /** Most options one choice question may have (the provider refuses more). */
  maxChoices: number
  /**
   * Input tokens the provider bills on every call on top of the state and the
   * questions (its own prompt around them). Used only for *projected* costs.
   */
  callOverheadTokens: number
  /** Listed price, USD per input token. Used only for *projected* costs. */
  usdPerInputToken: number
  usdPerOutputToken: number
  /** When the price above was read. Prices go stale; measured cost never does. */
  priceAsOf: string
  /** Confidence at or below which an answer is treated as undecided. */
  undecidedFloor: number
  /** Whether the probabilities are calibrated (an emulated model's are not). */
  calibrated: boolean
}

/**
 * Jev's per-call overhead. Measured 2026-09-24: a 1-character state with one
 * noul question billed 273 input tokens where the estimate was 23 (250 more),
 * and with a four-option choice 339 where it was 48 (291 more). 300 covers
 * both, so a projection errs slightly high for these; much larger choice sets
 * can still come in above it. Without any overhead, a dry run over 300 short
 * tickets projected $0.0026 and the live run measured $0.0055.
 */
export const JEV_CALL_OVERHEAD_TOKENS = 300

export const TRANSPORTS = ["openrouter-decisions", "openrouter-chat"] as const
export type TransportKind = (typeof TRANSPORTS)[number]

/** The prefix of an emulated baseline's profile id: `emulated:<chat model>`. */
export const EMULATED_PREFIX = "emulated:"

/** The chat model an emulated profile asks, as OpenRouter names it. */
export function chatModelOf(profile: ModelProfile): string {
  return profile.id.startsWith(EMULATED_PREFIX)
    ? profile.id.slice(EMULATED_PREFIX.length)
    : profile.id
}

/**
 * Refuse a profile that isn't a decision model where a decision is made (or
 * projected): an emulated baseline's answers are single, uncalibrated values,
 * so only `compare` uses it, through its own client.
 */
export function assertDecisionProfile(profile: ModelProfile): void {
  if (profile.transport === "openrouter-decisions") return
  throw new DecisionsError(
    "profile-not-allowed",
    `${profile.id} is an emulated baseline (${profile.transport}): its answers are single, uncalibrated values, so only \`decide compare\` may use it. Pick a decision model (the default is ${DEFAULT_MODEL_ID}).`,
    { model: profile.id, transport: profile.transport },
  )
}

/** The emulated baseline `compare` uses unless told otherwise (plan m11-adopt D2). */
export const DEFAULT_EMULATED_ID = "emulated:anthropic/claude-haiku-4.5"

export const PROFILES: readonly ModelProfile[] = [
  {
    id: "typesafe/jev-1.13",
    displayName: "TypeSafe Jev 1.13",
    transport: "openrouter-decisions",
    maxStateTokens: 32_000,
    // Measured 2026-09-22: 400 options is refused upstream with "at most 255 choices".
    maxChoices: 255,
    callOverheadTokens: JEV_CALL_OVERHEAD_TOKENS,
    usdPerInputToken: 0.042 / 1_000_000,
    usdPerOutputToken: 0,
    priceAsOf: "2026-09-19",
    undecidedFloor: DEFAULT_UNDECIDED_FLOOR,
    calibrated: true,
  },
  {
    id: DEFAULT_EMULATED_ID,
    displayName: "Emulated baseline: Claude Haiku 4.5 (chat, uncalibrated)",
    transport: "openrouter-chat",
    // Kept at Jev's limit, so both sides of a comparison see the same states.
    maxStateTokens: 32_000,
    maxChoices: 255,
    // For projections only (measured cost comes back per call). The prompt
    // renders each question twice (schema and text) and the provider adds
    // structured-output tokens: one live call over three questions billed 494
    // input tokens where the estimate of state and questions was 129. The ~30
    // output tokens of a small reply cost 5x input, so they are folded in here
    // as 150 more: projections cover input and output alike. A reply near the
    // 512-token output cap costs more than projected.
    callOverheadTokens: 500,
    // OpenRouter's listed price, read 2026-09-19 (jev-poc CHAT_PRICES).
    usdPerInputToken: 1 / 1_000_000,
    usdPerOutputToken: 5 / 1_000_000,
    priceAsOf: "2026-09-19",
    // Not used: a single value has no spread to be undecided about.
    undecidedFloor: DEFAULT_UNDECIDED_FLOOR,
    calibrated: false,
  },
]

export const DEFAULT_MODEL_ID = "typesafe/jev-1.13"

/**
 * Find the profile for a model id. A dated build (`typesafe/jev-1.13-20260917`)
 * resolves to its family profile but keeps the requested id, so it is what goes
 * on the wire.
 *
 * @throws DecisionsError `unknown-model` when nothing matches.
 */
export function resolveProfile(
  id: string,
  profiles: readonly ModelProfile[] = PROFILES,
): ModelProfile {
  const exact = profiles.find((p) => p.id === id)
  if (exact) return exact
  const family = profiles.find((p) => new RegExp(`^${escapeRegExp(p.id)}-\\d{8}$`).test(id))
  if (family) return { ...family, id }
  throw new DecisionsError(
    "unknown-model",
    `No profile for model "${id}". Known: ${profiles.map((p) => p.id).join(", ")}.`,
    { model: id, known: profiles.map((p) => p.id) },
  )
}

/**
 * Projected cost of `calls` decisions whose state and questions come to about
 * `tokensPerCall` input tokens, plus the profile's per-call overhead. Never a
 * measurement.
 */
export function projectCost(profile: ModelProfile, calls: number, tokensPerCall: number): number {
  return calls * (tokensPerCall + profile.callOverheadTokens) * profile.usdPerInputToken
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
