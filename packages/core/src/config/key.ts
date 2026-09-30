import { DecisionsError } from "../errors.js"

/**
 * Trim, then remove one matching pair of `"` or `'`; a lone quote is left alone.
 * A key with a space or control character inside is refused without echoing it:
 * `fetch` would reject the header and quote the whole value in its error.
 */
export function unquoteKey(
  raw: string | undefined,
  source = "OPENROUTER_API_KEY",
): { value: string; quoted: boolean } | undefined {
  const value = nonEmpty(raw)
  if (!value) return undefined
  const quoted = /^(["']).*\1$/s.test(value)
  const key = quoted ? nonEmpty(value.slice(1, -1)) : value
  if (!key) return undefined
  if (/[^\x21-\x7e]/.test(key)) {
    throw new DecisionsError(
      "config-error",
      `${source} contains a space, line break or other character an API key can't have; set it again`,
    )
  }
  return { value: key, quoted }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim()
}
