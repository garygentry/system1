import picomatch from "picomatch"
import type { Skipped } from "../sources/types.js"

/**
 * Paths never sent to the provider, whatever the source. Config adds to these
 * (`egress.exclude`); it cannot remove them.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/.git-credentials",
  "**/.aws/credentials",
  "**/.ssh/**",
  "**/.docker/config.json",
  "**/*.tfstate",
  "**/*.tfstate.*",
  "**/secrets/**",
  "**/.system1/credentials",
]

export interface ExcludeResult<T> {
  items: T[]
  excluded: Skipped[]
}

/** Anything path-labelled: a document before splitting, or an item after it. */
type PathLabelled = { path?: string; realPath?: string }

/**
 * Drop items whose path matches an exclude pattern. Every drop is reported
 * with the pattern that caused it, so the caller can say what was withheld.
 */
export function applyExcludes<T extends PathLabelled>(
  items: readonly T[],
  extra: readonly string[] = [],
): ExcludeResult<T> {
  const patterns = [...DEFAULT_EXCLUDES, ...extra]
  const matchers = patterns.map((p) => ({ p, test: picomatch(p, { dot: true }) }))
  const kept: T[] = []
  const excluded = new Map<string, Skipped>()
  for (const item of items) {
    // Both spellings: a symlink's own name and what it resolves to.
    const paths = [item.path, item.realPath].filter((p): p is string => p !== undefined)
    const hit = paths.length ? matchers.find((m) => paths.some((p) => m.test(p))) : undefined
    if (hit && item.path) {
      excluded.set(item.path, {
        path: item.path,
        reason: "excluded",
        detail:
          item.realPath && item.realPath !== item.path ? `${hit.p} (via ${item.realPath})` : hit.p,
      })
    } else {
      kept.push(item)
    }
  }
  return { items: kept, excluded: [...excluded.values()] }
}

/** Whether one path is excluded, for checks before a source is read. */
export function isExcluded(path: string, extra: readonly string[] = []): string | undefined {
  return [...DEFAULT_EXCLUDES, ...extra].find((p) => picomatch(p, { dot: true })(path))
}
