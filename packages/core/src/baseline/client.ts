/**
 * The emulated baseline's client (M11, plan m11-adopt D2): asks an ordinary
 * chat model on OpenRouter for the answers a question set asks a decision model
 * for, so `compare` can measure both sides.
 *
 * It is not a decider and never becomes one: its answers are single values
 * (`BaselineAnswer`), and `createDecider` refuses its profiles. Only `compare`
 * builds it. It sends content to a **second vendor**, so a live call needs the
 * repo's consent (0009) **and** the profile in `egress.allowProfiles`.
 * Everything else is the engine's usual path: scrub, size check, fixtures and
 * the spend ledger. It asks OpenRouter not to route to providers that keep
 * data (`provider.data_collection: "deny"`).
 */
import { assertConsent } from "../config/assert-consent.js"
import type { DecideMode, Unsaved } from "../decide.js"
import { scrubQuestions, scrubState } from "../egress/scrub.js"
import { assertStateFits } from "../egress/size.js"
import { DecisionsError, ProviderError } from "../errors.js"
import { type FixtureStore, fixtureKey } from "../fixtures/store.js"
import { chatModelOf, type ModelProfile } from "../model/profiles.js"
import type { DecisionRequest, QuestionSet, State, Usage } from "../model/types.js"
import { assertQuestionSet } from "../model/validate.js"
import type { AnswerSource, SpendLedger } from "../run/spend.js"
import { RETRY_STATUSES, untilAborted } from "../transport/openrouter.js"
import { type BaselineAnswers, BaselineParseError, parseBaseline } from "./parse.js"
import { promptFor, schemaFor } from "./schema.js"

export const DEFAULT_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

/** Enough for a structured object of many questions; output tokens are the costly half. */
const MAX_OUTPUT_TOKENS = 512

export interface BaselineClientOptions {
  /** Must be an emulated (`openrouter-chat`) profile. */
  profile: ModelProfile
  /** The repo's egress consent (0009). */
  egressConsent: boolean
  /** Whether this repo allowed this profile (`egress.allowProfiles`). */
  allowed: boolean
  repoRoot?: string
  /** Absent: replay only. */
  apiKey?: string
  endpoint?: string
  /** Per attempt. */
  timeoutMs?: number
  maxAttempts?: number
  backoffMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  fixtures?: FixtureStore
  ledger?: SpendLedger
  mode?: DecideMode
  session?: string
  tag?: string
  now?: () => Date
}

/** What a recorded baseline fixture keeps: the reply as it came, so a replay parses it afresh. */
export interface BaselineRecorded {
  model: string
  content: string
  usage: Usage
}

export interface BaselineResult {
  source: AnswerSource
  /** The profile id requested. */
  model: string
  /** The chat model that answered, as OpenRouter reported it. */
  servedBy: string
  /** Present when the reply parsed; absent means `parseError`. */
  answers?: BaselineAnswers
  /** Why the reply isn't answers (never repaired). Names a field, never content. */
  parseError?: string
  usage: Usage
  latencyMs: number
  fixtureKey: string
  unsaved?: Unsaved[]
}

export interface BaselineClient {
  readonly mode: Exclude<DecideMode, "auto">
  answer(input: {
    state: State
    questions: QuestionSet
    namespace?: string
    signal?: AbortSignal
  }): Promise<BaselineResult>
}

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cost: 0 }

export function createBaselineClient(options: BaselineClientOptions): BaselineClient {
  const { profile, fixtures, ledger, session, tag } = options
  const now = options.now ?? (() => new Date())
  if (profile.transport !== "openrouter-chat") {
    throw new DecisionsError(
      "profile-not-allowed",
      `${profile.id} is not an emulated baseline (its transport is ${profile.transport})`,
      { model: profile.id },
    )
  }
  const mode: Exclude<DecideMode, "auto"> =
    (options.mode ?? "auto") === "auto"
      ? options.apiKey
        ? "live"
        : "replay"
      : (options.mode as Exclude<DecideMode, "auto">)
  if ((mode === "live" || mode === "record") && !options.apiKey)
    throw new DecisionsError("no-key", "A live baseline call needs OPENROUTER_API_KEY.")
  if ((mode === "record" || mode === "replay") && !fixtures)
    throw new DecisionsError("invalid-request", `Mode "${mode}" needs a fixture store`)

  const reasonOf = (error: unknown): string =>
    (error as NodeJS.ErrnoException)?.code ??
    (error instanceof Error ? error.message : String(error))
  const log = (source: AnswerSource, usage: Usage, unsaved: Unsaved[]) => {
    try {
      ledger?.append({
        ts: now().toISOString(),
        ...(session ? { session } : {}),
        ...(tag ? { tag } : {}),
        model: profile.id,
        source,
        calls: 1,
        ...usage,
      })
    } catch (error) {
      unsaved.push({ what: "ledger", reason: reasonOf(error) })
    }
  }
  const read = (content: string, questions: QuestionSet) => {
    try {
      return { answers: parseBaseline(JSON.parse(content), questions) }
    } catch (error) {
      return {
        parseError: error instanceof BaselineParseError ? error.message : "the reply was not JSON",
      }
    }
  }

  return {
    mode,
    async answer({ state, questions, namespace = "adhoc", signal }) {
      assertQuestionSet(questions)
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
        const record = fixtures?.lookup<BaselineRecorded>(namespace, request)
        if (!record)
          throw new DecisionsError(
            "replay-miss",
            `No recorded baseline answer for this request (namespace "${namespace}", key ${key.slice(0, 12)}…).`,
            { namespace, key },
          )
        const unsaved: Unsaved[] = []
        log("replay", ZERO, unsaved)
        return {
          source: "replay",
          model: profile.id,
          servedBy: record.response.model,
          ...read(record.response.content, safeQuestions),
          usage: ZERO,
          latencyMs: Math.round(performance.now() - started),
          fixtureKey: key,
          ...(unsaved.length ? { unsaved } : {}),
        }
      }

      if (!options.allowed) {
        throw new DecisionsError(
          "profile-not-allowed",
          `This repo hasn't allowed ${profile.id} to receive its content. The user allows it with ` +
            `\`decide config egress allow-profile ${profile.id}\`.`,
          { model: profile.id },
        )
      }
      assertConsent({ granted: options.egressConsent }, options.repoRoot ?? "this repo")
      if (mode === "record") fixtures?.path(namespace, key)
      const { reply, latencyMs } = await post(options, profile, safeState, safeQuestions, signal)
      const unsaved: Unsaved[] = []
      if (mode === "record") {
        try {
          fixtures?.record<BaselineRecorded>(namespace, request, reply, now())
        } catch (error) {
          unsaved.push({ what: "fixture", reason: reasonOf(error) })
        }
      }
      log("live", reply.usage, unsaved)
      return {
        source: "live",
        model: profile.id,
        servedBy: reply.model,
        ...read(reply.content, safeQuestions),
        usage: reply.usage,
        latencyMs,
        fixtureKey: key,
        ...(unsaved.length ? { unsaved } : {}),
      }
    },
  }
}

/** One chat call, with the decisions transport's retry rules. */
async function post(
  options: BaselineClientOptions,
  profile: ModelProfile,
  state: State,
  questions: QuestionSet,
  signal?: AbortSignal,
): Promise<{ reply: BaselineRecorded; latencyMs: number }> {
  const endpoint = options.endpoint ?? DEFAULT_CHAT_ENDPOINT
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const backoffMs = options.backoffMs ?? 400
  const timeoutMs = options.timeoutMs ?? 30_000
  const prompt = promptFor(state, questions)
  const body = JSON.stringify({
    model: chatModelOf(profile),
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    response_format: { type: "json_schema", json_schema: schemaFor(questions) },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
    usage: { include: true },
    provider: { data_collection: "deny" },
  })
  const started = performance.now()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const composite = signal ? AbortSignal.any([signal, timeout]) : timeout
    const last = attempt === maxAttempts
    const wait = () => untilAborted(sleep(backoffMs * 2 ** (attempt - 1)), signal)
    let response: Response
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/garygentry/system1",
          "X-Title": "system1",
        },
        body,
        signal: composite,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (last)
        throw new ProviderError(
          "provider-unreachable",
          `Could not reach ${endpoint}: ${error instanceof Error ? error.name : "error"}`,
        )
      await wait()
      continue
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      if (!RETRY_STATUSES.has(response.status) || last)
        throw new ProviderError(
          "provider-http",
          `${endpoint} returned ${response.status}: ${detail}`,
          response.status,
        )
      await wait()
      continue
    }
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new ProviderError("malformed-response", `${endpoint} returned a body that is not JSON`)
    }
    return {
      reply: chatReply(raw, profile, endpoint),
      latencyMs: Math.round(performance.now() - started),
    }
  }
  throw new ProviderError("provider-unreachable", `Could not reach ${endpoint}`)
}

/** The message content and usage of a completions reply. The content is parsed later, as answers. */
function chatReply(raw: unknown, profile: ModelProfile, endpoint: string): BaselineRecorded {
  const body = raw as {
    choices?: Array<{ message?: { content?: unknown } }>
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown }
    model?: unknown
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== "string")
    throw new ProviderError("malformed-response", `${endpoint} returned no message content`)
  const u = body.usage
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const cost = num(u?.cost)
  return {
    model: typeof body.model === "string" ? body.model : chatModelOf(profile),
    content,
    usage: {
      input_tokens: num(u?.prompt_tokens) ?? 0,
      output_tokens: num(u?.completion_tokens) ?? 0,
      cost: cost !== undefined ? Math.max(0, cost) : 0,
      ...(cost === undefined ? { reported: false } : {}),
    },
  }
}
