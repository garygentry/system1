import { readFileSync } from "node:fs"
import type { QuestionSet } from "../model/types.js"

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"))

/** A real recorded Jev response and the question set it answered. */
export const guardrailQuestions = (): QuestionSet => read("./guardrail.questions.json")
export const guardrailResponse = (): Record<string, unknown> => read("./guardrail-ls.response.json")
