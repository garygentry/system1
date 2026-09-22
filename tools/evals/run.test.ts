import { describe, expect, it } from "vitest"
import { completed, loadCases, loadedSkills, MINIMUMS } from "./run.js"

const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n")

describe("loadedSkills", () => {
  it("claude: a Skill tool call, namespaced or not, or a Read of SKILL.md", () => {
    const out = lines(
      { type: "system", tools: ["skills/design/SKILL.md"] },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Skill", input: { skill: "decisions:ask" } }],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/p/skills/setup/SKILL.md" } },
          ],
        },
      },
    )
    expect([...loadedSkills("claude", out)].sort()).toEqual(["ask", "setup"])
  })

  it("codex: only a command that reads SKILL.md counts, not a reply that names it", () => {
    const out = lines(
      { type: "item.completed", item: { type: "agent_message", text: "see skills/ask/SKILL.md" } },
      {
        type: "item.started",
        item: { type: "command_execution", command: "sed -n 1,200p /c/skills/design/SKILL.md" },
      },
    )
    expect([...loadedSkills("codex", out)]).toEqual(["design"])
  })

  it("pi: a read tool call on SKILL.md", () => {
    const out = lines(
      { type: "tool_execution_start", toolName: "read", args: { path: "/r/skills/ask/SKILL.md" } },
      "not json",
    )
    expect([...loadedSkills("pi", out)]).toEqual(["ask"])
  })
})

describe("completed", () => {
  it("needs each harness's end-of-session event", () => {
    expect(completed("claude", "Error: Input must be provided")).toBe(false)
    expect(completed("claude", lines({ type: "result", result: "ok" }))).toBe(true)
    expect(completed("codex", lines({ type: "turn.completed" }))).toBe(true)
    expect(completed("pi", lines({ type: "agent_end" }))).toBe(true)
  })
})

describe("routing.yaml", () => {
  it("meets the minimum prompt counts for every skill", () => {
    const cases = loadCases()
    for (const [skill, min] of Object.entries(MINIMUMS)) {
      const count = (p: string) => cases.filter((c) => c.skill === skill && c.polarity === p).length
      expect(count("positive"), `${skill} positives`).toBeGreaterThanOrEqual(min.positive)
      expect(count("negative"), `${skill} negatives`).toBeGreaterThanOrEqual(min.negative)
    }
  })

  it("never names a skill or the CLI in a prompt", () => {
    for (const c of loadCases()) {
      if (c.skill === "setup" && c.polarity === "negative") continue // mentions decide on purpose
      expect(c.prompt, c.prompt).not.toMatch(/\bdecide\b|\bskill\b|\$ask|\/decisions/)
    }
  })
})
