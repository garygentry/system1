/**
 * Does the agent's last message stop to ask the user something? (M10
 * decision 2, deferred until §8 measured it: done-check blocked 9 of 12 stops
 * where the agent paused mid-task to ask a question.)
 *
 * Local and deterministic: the message is never sent. It errs toward
 * checking, since a stop it lets through unchecked can hide unfinished work,
 * while a stop it wrongly checks is only what done-check did before. So a stop
 * counts as a question only when all of these hold:
 * - the last paragraph asks something (a sentence ending in `?`);
 * - the message claims nothing is finished ("done", "complete", "ready to…");
 * - no question is an offer of more work after finishing ("Anything else?",
 *   "Should I also…?", "Want me to…?").
 *
 * It can't tell a real question from an offer phrased like one ("Should I
 * look for other places that use the old name?", "Do you want a PNG version
 * as well?"); those stops are skipped. The eval counts them.
 */

/** Words that say the work is finished. A match means: check this stop. */
const CLAIMS_DONE =
  /\b(?:done|finished|complete|completed|all set|ready (?:for|to)|implemented|committed)\b/i

/**
 * A question where the agent offers more of its own work after finishing, not
 * one the work waits on. "Too" or "as well" alone isn't an offer: "Should a
 * HEAD request count too?" asks about behaviour.
 */
const OFFERS = [
  /\banything else\b/i,
  /^(?:want|would you like|shall i)\b/i,
  /\b(?:i|me)\b.*\b(?:also|too|as well)\b/i,
]

/** Sentences, each with its end mark, after code blocks and inline code are gone. */
function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean)
}

/** Strip what is quoted rather than said: code blocks and inline code. */
function prose(message: string): string {
  return message.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, "code")
}

export function asksUser(message: string | null | undefined): boolean {
  if (typeof message !== "string") return false
  const text = prose(message).trim()
  if (!text || CLAIMS_DONE.test(text)) return false
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim())
  const last = paragraphs.at(-1) ?? ""
  // A trailing quote, bracket or emoji after the `?` still ends a question.
  const questions = sentences(last).filter((s) =>
    /\?[\s"')\]*_\p{Extended_Pictographic}]*$/u.test(s),
  )
  if (questions.length === 0) return false
  return !questions.some((q) => OFFERS.some((offer) => offer.test(q)))
}
