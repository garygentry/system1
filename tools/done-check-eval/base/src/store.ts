import { makeSlug } from "./slug.js"

/** Links in memory, by slug. */
export class LinkStore {
  private links = new Map<string, string>()

  /** Store a URL and return its slug. */
  put(url: string): string {
    const slug = makeSlug(url)
    this.links.set(slug, url)
    return slug
  }

  /** The URL for a slug, or undefined. */
  get(slug: string): string | undefined {
    return this.links.get(slug)
  }
}
