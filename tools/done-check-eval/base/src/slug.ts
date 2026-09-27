import { createHash } from "node:crypto"

/** A short, stable slug for a URL: the first 7 characters of its sha256, base64url. */
export function makeSlug(url: string): string {
  return createHash("sha256").update(url).digest("base64url").slice(0, 7)
}
