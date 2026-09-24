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
 * spot in the skipped summary. Egress excludes run first, so a path both would
 * drop is always reported as `excluded`. Items with no path (text, stdin) are never
 * filtered. Patterns are repo-relative, like `--glob`.
 */
export function applyFilter<T extends { path?: string; realPath?: string }>(
  items: readonly T[],
  patterns: readonly string[] = [],
): FilterResult<T> {
  if (patterns.length === 0) return { items: [...items], filtered: [] }
  const matchers = patterns.map((p) => ({ p, test: picomatch(p, { dot: true }) }))
  const kept: T[] = []
  const filtered = new Map<string, Skipped>()
  for (const item of items) {
    // Both spellings, as egress excludes do: a symlink's own name and its target.
    const paths = [item.path, item.realPath].filter((p): p is string => p !== undefined)
    const hit =
      item.path === undefined ? undefined : matchers.find((m) => paths.some((p) => m.test(p)))
    if (hit && item.path !== undefined) {
      filtered.set(item.path, { path: item.path, reason: "filtered", detail: hit.p })
    } else {
      kept.push(item)
    }
  }
  return { items: kept, filtered: [...filtered.values()] }
}
