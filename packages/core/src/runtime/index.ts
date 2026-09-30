/**
 * `@garygentry/system1-core/runtime`: the surface adopted code imports, and
 * nothing else (0020). Its exports are pinned by `index.test.ts` and committed
 * under semver: a breaking change needs a minor bump and a decision record.
 */

export type { Answer, Answers, QuestionSet, State, Usage } from "../model/types.js"
export type { PreparedState } from "../prepare-state.js"
export { prepareState } from "../prepare-state.js"
export {
  createPolicyRuntime,
  type PolicyRequest,
  type PolicyResult,
  type PolicyRuntime,
  type PolicyRuntimeOptions,
  REASON_CODES,
  type ReasonCode,
  RUNTIME_TAG,
} from "./runtime.js"
