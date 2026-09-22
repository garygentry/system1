import picomatch from "picomatch"
import type { Item, Skipped } from "../sources/types.js"

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

export interface ExcludeResult {
  items: Item[]
  excluded: Skipped[]
}

/**
 * Drop items whose path matches an exclude pattern. Every drop is reported
 * with the pattern that caused it, so the caller can say what was withheld.
 */
export function applyExcludes(
  items: readonly Item[],
  extra: readonly string[] = [],
): ExcludeResult {
  const patterns = [...DEFAULT_EXCLUDES, ...extra]
  const matchers = patterns.map((p) => ({ p, test: picomatch(p, { dot: true }) }))
  const kept: Item[] = []
  const excluded = new Map<string, Skipped>()
  for (const item of items) {
    const hit = item.path ? matchers.find((m) => m.test(item.path as string)) : undefined
    if (hit && item.path) {
      excluded.set(item.path, { path: item.path, reason: "excluded", detail: hit.p })
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
