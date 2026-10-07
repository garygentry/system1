// Types for release-lib.mjs, so release-lib.test.ts typechecks.
export const ROOT: string
export const PACKAGES: string[]
export function manifest(pkg: string): { name: string; version: string }
export function releaseVersion(): { version: string; error?: undefined } | { error: string }
export function checkTag(tag: string, version: string): string[]
export function fenced(text: string): string
export function releaseSummary(release: {
  version: string
  tag: string
  previous?: string
  previousProblem?: string
  packages: string[]
  message: string
  log: string
  diffStat: string
  github: string[]
}): string
export function npmEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function isPublished(name: string, version: string): boolean
export function waitUntilServed(
  names: string[],
  version: string,
  opts?: { waitMs?: number; stepMs?: number },
): string[]
