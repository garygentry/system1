import { describe, expect, it } from "vitest"
import { asksUser } from "./asks.js"

describe("asksUser", () => {
  it("finds a question the work waits on", () => {
    for (const m of [
      "Before I start: should the ttl be given in seconds or in milliseconds?",
      "`put` now records an expiry time. Before I change `get`: should an expired link be deleted, or just hidden?",
      "I've renamed `makeSlug`. Do you want me to keep it as an alias, or remove it? I'll update the caller once you decide.",
      "Counting works. Should a HEAD request count as a click too, or only GET?",
      'Which of these do you want: "strict" or "lenient"?"',
      "Here's the plan:\n\n1. Add the flag\n2. Wire it\n\nDoes that look right? 🙂",
    ]) {
      expect(asksUser(m), m).toBe(true)
    }
  })

  it("checks a stop that claims the work is finished, even if it ends in a question", () => {
    for (const m of [
      "Done. Want me to add tests for the expiry path too?",
      "I've finished the task.\n\nWould you like me to open a PR?",
      "The change is ready to commit. Shall I commit it now?",
      "I've committed the change. Is there anything else you'd like me to do?",
      "Done. I dropped the README item. Is that OK?",
    ]) {
      expect(asksUser(m), m).toBe(false)
    }
  })

  it("checks a stop whose question offers more work", () => {
    for (const m of [
      "Expiry works now. Anything else you need?",
      "`get` now counts clicks. Want me to expose the counts through an endpoint?",
      "Added the header. Should I also add it to the 404 response?",
      "Added the header. Would you like me to add it to the 404 as well?",
    ]) {
      expect(asksUser(m), m).toBe(false)
    }
  })

  it("checks a stop that asks nothing", () => {
    for (const m of [
      "Renamed `makeSlug` to `slugFor`.",
      "Let me know if you'd like any changes.",
      "Should I?\n\nNo: the task says to keep it, so I kept it.",
      "",
      "   ",
    ]) {
      expect(asksUser(m), m).toBe(false)
    }
    expect(asksUser(undefined)).toBe(false)
    expect(asksUser(null)).toBe(false)
  })

  it("ignores question marks and claim words inside code", () => {
    expect(asksUser("I changed `a ?? b`.")).toBe(false)
    expect(asksUser("```ts\nconst x = a ? b : c\n```")).toBe(false)
    expect(asksUser("Should `isDone()` return false for an empty list?")).toBe(true)
  })
})
