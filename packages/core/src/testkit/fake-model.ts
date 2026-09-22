import type { Answer, QuestionSet } from "../model/types.js"

/**
 * A stand-in decisions endpoint for tool tests: deterministic answers derived
 * from the state's text, so tests can steer outcomes.
 *
 * - a state mentioning "auth" gets noul 0.95 (and the first choice option);
 * - "maybe" gets noul 0.5 and a flat choice (undecided);
 * - "explode" makes the endpoint answer HTTP 400;
 * - anything else gets noul 0.05 (and the last choice option).
 */
export function fakeDecisionsFetch(): { fetch: typeof fetch; calls: number } {
  const counter = { calls: 0 }
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    counter.calls += 1
    const body = JSON.parse(String(init.body)) as { state: unknown; questions: QuestionSet }
    const text = typeof body.state === "string" ? body.state : JSON.stringify(body.state)
    if (text.includes("explode")) return new Response("bad request", { status: 400 })
    const answers: Record<string, Answer> = {}
    for (const [name, q] of Object.entries(body.questions)) {
      const hot = text.includes("auth")
      const flat = text.includes("maybe")
      if (q.type === "noul") answers[name] = { type: "noul", noul: flat ? 0.5 : hot ? 0.95 : 0.05 }
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria)
        const pick = (hot ? keys[0] : keys[keys.length - 1]) as string
        answers[name] = {
          type: "choice",
          choice: pick,
          probabilities: Object.fromEntries(
            keys.map((k) => [k, flat ? 1 / keys.length : k === pick ? 1 : 0]),
          ),
          confidence: flat ? 0 : 1,
        }
      }
      if (q.type === "score") {
        const top = q.criteria.length - 1
        answers[name] = {
          type: "score",
          score: hot ? top : 0,
          probabilities: { "0": 1 },
          confidence: flat ? 0.05 : 0.9,
        }
      }
    }
    return Response.json({
      model: "typesafe/jev-1.13-20260917",
      answers,
      usage: { input_tokens: 100, output_tokens: 10, cost: 0.000004 },
    })
  }) as unknown as typeof fetch
  return {
    fetch: fetchImpl,
    get calls() {
      return counter.calls
    },
  }
}
