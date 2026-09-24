import picomatch from "picomatch"
import type { Skipped } from "./types.js"

export interface FilterResult<T> {
  items: T[]
  filtered: Skipped[]
}

/**
 * Drop what the caller asked to leave out (`--exclude <glob>`), by path.
 *
 * Unlike egress excludes this is a per-call choice, not a safety rule, so it is
 * reported as `filtered` rather than `excluded`: withheld secrets stay easy to
 * spot in the skipped summary. Items with no path (text, stdin) are never
 * filtered. Patterns are repo-relative, like `--glob`.
 */
export function applyFilter<T extends { path?: string }>(
  items: readonly T[],
  patterns: readonly string[] = [],
): FilterResult<T> {
  if (patterns.length === 0) return { items: [...items], filtered: [] }
  const matchers = patterns.map((p) => ({ p, test: picomatch(p, { dot: true }) }))
  const kept: T[] = []
  const filtered = new Map<string, Skipped>()
  for (const item of items) {
    const hit = item.path === undefined ? undefined : matchers.find((m) => m.test(item.path ?? ""))
    if (hit && item.path !== undefined) {
      filtered.set(item.path, { path: item.path, reason: "filtered", detail: hit.p })
    } else {
      kept.push(item)
    }
  }
  return { items: kept, filtered: [...filtered.values()] }
}
