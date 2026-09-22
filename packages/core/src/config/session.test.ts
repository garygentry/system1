import { describe, expect, it } from "vitest"
import { detectHarness, detectSession } from "./session.js"

const CLAUDE = { CLAUDE_CODE_SESSION_ID: "c1", AI_AGENT: "claude-code_2-1-278_agent" }

describe("detectSession", () => {
  it("is undefined outside any harness", () => {
    expect(detectSession({})).toBeUndefined()
  })

  it("reads each harness's own id", () => {
    expect(detectSession(CLAUDE)).toEqual({ id: "claude:c1", origin: "claude" })
    expect(detectSession({ CODEX_THREAD_ID: "x1" })).toEqual({ id: "codex:x1", origin: "codex" })
    expect(detectSession({ CODEX_SESSION_ID: "x2" })).toEqual({ id: "codex:x2", origin: "codex" })
    expect(detectSession({ PI_SESSION_ID: "p1", AI_AGENT: "pi" })).toEqual({
      id: "pi:p1",
      origin: "pi",
    })
  })

  it("picks the innermost harness when a parent's variables leak in", () => {
    // Codex keeps the parent's AI_AGENT; its own thread id still wins.
    expect(detectSession({ ...CLAUDE, CODEX_THREAD_ID: "x1" })?.id).toBe("codex:x1")
    // Pi overwrites AI_AGENT, which beats a leaked Codex id.
    expect(detectSession({ CODEX_THREAD_ID: "x1", PI_SESSION_ID: "p1", AI_AGENT: "pi" })?.id).toBe(
      "pi:p1",
    )
    expect(detectSession({ ...CLAUDE, PI_SESSION_ID: "p1", AI_AGENT: "pi" })?.id).toBe("pi:p1")
  })

  it("lets DECISIONS_SESSION override detection, and ignores blanks", () => {
    expect(detectSession({ ...CLAUDE, DECISIONS_SESSION: "ci-42" })).toEqual({
      id: "ci-42",
      origin: "env",
    })
    expect(detectSession({ ...CLAUDE, DECISIONS_SESSION: "  " })?.id).toBe("claude:c1")
    expect(detectSession({ CLAUDE_CODE_SESSION_ID: "" })).toBeUndefined()
  })
})

describe("detectHarness", () => {
  it("names the innermost harness, with or without a session id", () => {
    expect(detectHarness({})).toBeUndefined()
    expect(detectHarness({ CLAUDECODE: "1" })).toBe("claude")
    expect(detectHarness({ ...CLAUDE, CODEX_THREAD_ID: "x1" })).toBe("codex")
    expect(detectHarness({ ...CLAUDE, PI_CODING_AGENT: "true", AI_AGENT: "pi" })).toBe("pi")
  })
})
