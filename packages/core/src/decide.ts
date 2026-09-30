import { assertConsent } from "./config/assert-consent.js"
import { scrubQuestions, scrubState } from "./egress/scrub.js"
import { assertStateFits } from "./egress/size.js"
import { DecisionsError } from "./errors.js"
import type { FixtureStore } from "./fixtures/store.js"
import { fixtureKey } from "./fixtures/store.js"
import { undecidedNames } from "./model/answers.js"
import type { ModelProfile } from "./model/profiles.js"
import type { Answers, DecisionRequest, QuestionSet, State, Usage } from "./model/types.js"
import { assertQuestionSet } from "./model/validate.js"
import type { AnswerSource, SpendLedger } from "./run/spend.js"
import type { Transport } from "./transport/openrouter.js"

/**
 * - `auto`: live when a transport (i.e. a key) is available, otherwise replay.
 * - `live`: always call the model.
 * - `record`: call the model and write the fixture.
 * - `replay`: never touch the network; a miss is `replay-miss`.
 */
export type DecideMode = "auto" | "live" | "record" | "replay"

export interface DeciderOptions {
  profile: ModelProfile
  /**
   * Whether this repo consented to sending content off the machine (decision
   * 0009). Required, so a caller can't forget it. Replay ignores it.
   */
  egressConsent: boolean
  /** Named in the `egress-refused` message. */
  repoRoot?: string
  /** Absent when no API key is configured. */
  transport?: Transport
  fixtures?: FixtureStore
  ledger?: SpendLedger
  mode?: DecideMode
  session?: string
  /** Written on every ledger line, e.g. `guard:done-check`, so its spend can be summed apart. */
  tag?: string
  now?: () => Date
}

export interface DecideInput {
  state: State
  questions: QuestionSet
  /** Fixture namespace: a spec name, or `adhoc`. */
  namespace?: string
  signal?: AbortSignal
}

/**
 * A record a decision couldn't keep, such as on a read-only disk. The answer
 * stands: a failed write after a paid call is reported, never thrown.
 */
export interface Unsaved {
  what: "ledger" | "fixture"
  /** The filesystem error code (`EROFS`, `EACCES`, …), else its message. */
  reason: string
}

export interface DecisionResult {
  source: AnswerSource
  /** Requested model id. */
  model: string
  /** Build that actually answered (from the response, live or recorded). */
  servedBy: string
  answers: Answers
  /** Names of answers too flat to act on. Never rounded to the top option. */
  undecided: string[]
  /** Measured for live calls; zero for replays (nothing was spent). */
  usage: Usage
  latencyMs: number
  fixtureKey: string
  recordedAt?: string
  /** Present when the ledger line or the fixture couldn't be written. */
  unsaved?: Unsaved[]
}

export interface Decider {
  readonly mode: Exclude<DecideMode, "auto">
  decide(input: DecideInput): Promise<DecisionResult>
}

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cost: 0 }

export function createDecider(options: DeciderOptions): Decider {
  const { profile, transport, fixtures, ledger, session, tag } = options
  const now = options.now ?? (() => new Date())
  const mode: Exclude<DecideMode, "auto"> =
    (options.mode ?? "auto") === "auto"
      ? transport
        ? "live"
        : "replay"
      : (options.mode as Exclude<DecideMode, "auto">)

  // A decider answers with calibrated distributions. An emulated chat baseline
  // can't, so it never becomes one: only `compare` asks it, through its own client.
  if (profile.transport !== "openrouter-decisions") {
    throw new DecisionsError(
      "profile-not-allowed",
      `${profile.id} is an emulated baseline (${profile.transport}): its answers are single, uncalibrated values, so only \`decide compare\` may use it. Pick a decision model (e.g. typesafe/jev-1.13).`,
      { model: profile.id, transport: profile.transport },
    )
  }
  if ((mode === "live" || mode === "record") && !transport) {
    throw new DecisionsError(
      "no-key",
      "A live decision needs OPENROUTER_API_KEY. Without one only replay of recorded fixtures is available.",
    )
  }
  if ((mode === "record" || mode === "replay") && !fixtures) {
    throw new DecisionsError("invalid-request", `Mode "${mode}" needs a fixture store`)
  }

  const reasonOf = (error: unknown): string =>
    (error as NodeJS.ErrnoException)?.code ??
    (error instanceof Error ? error.message : String(error))
  const log = (source: AnswerSource, model: string, usage: Usage, unsaved: Unsaved[]) => {
    try {
      ledger?.append({
        ts: now().toISOString(),
        ...(session ? { session } : {}),
        ...(tag ? { tag } : {}),
        model,
        source,
        calls: 1,
        ...usage,
      })
    } catch (error) {
      unsaved.push({ what: "ledger", reason: reasonOf(error) })
    }
  }

  return {
    mode,
    async decide({ state, questions, namespace = "adhoc", signal }) {
      assertQuestionSet(questions)
      // The last boundary before the wire. `prepare()` has usually scrubbed
      // and sized the state already; doing it here too means a caller using
      // the library directly still cannot send a secret or an oversized
      // state. Scrubbing is idempotent, so fixture keys are unaffected.
      const safeState = scrubState(state)
      const safeQuestions = scrubQuestions(questions)
      assertStateFits(namespace, safeState, safeQuestions, profile)
      const request: DecisionRequest = {
        model: profile.id,
        state: safeState,
        questions: safeQuestions,
      }
      const key = fixtureKey(request)

      if (mode === "replay") {
        const started = performance.now()
        const record = fixtures?.lookup(namespace, request)
        if (!record) {
          const where = `(namespace "${namespace}", key ${key.slice(0, 12)}…)`
          // Without a key, replay is the only mode, so the key is the real cause.
          throw new DecisionsError(
            "replay-miss",
            transport
              ? `No recorded answer for this request ${where}. ` +
                  "Record it with a live call (without --replay or SYSTEM1_REPLAY)."
              : "No API key is set, so only recorded answers can be used, and this request has none " +
                  `${where}. Set OPENROUTER_API_KEY for a live answer (the setup skill shows where it goes).`,
            { namespace, key },
          )
        }
        const unsaved: Unsaved[] = []
        log("replay", profile.id, ZERO, unsaved)
        return {
          source: "replay",
          model: profile.id,
          servedBy: record.response.model,
          answers: record.response.answers,
          undecided: undecidedNames(record.response.answers, profile.undecidedFloor),
          usage: ZERO,
          latencyMs: Math.round(performance.now() - started),
          fixtureKey: key,
          recordedAt: record.recordedAt,
          ...(unsaved.length ? { unsaved } : {}),
        }
      }

      // mode is live or record; the constructor guaranteed a transport.
      assertConsent({ granted: options.egressConsent }, options.repoRoot ?? "this repo")
      // A bad namespace is a caller's bug: refuse it before the call is paid for.
      if (mode === "record") fixtures?.path(namespace, key)
      const { response, latencyMs } = await (transport as Transport).decide(request, signal)
      // The call is paid for: from here on, nothing may throw it away.
      const unsaved: Unsaved[] = []
      let recorded: ReturnType<FixtureStore["record"]> | undefined
      if (mode === "record") {
        try {
          recorded = fixtures?.record(namespace, request, response, now())
        } catch (error) {
          unsaved.push({ what: "fixture", reason: reasonOf(error) })
        }
      }
      log("live", profile.id, response.usage, unsaved)
      return {
        source: "live",
        model: profile.id,
        servedBy: response.model,
        answers: response.answers,
        undecided: undecidedNames(response.answers, profile.undecidedFloor),
        usage: response.usage,
        latencyMs,
        fixtureKey: key,
        ...(recorded ? { recordedAt: recorded.recordedAt } : {}),
        ...(unsaved.length ? { unsaved } : {}),
      }
    },
  }
}
