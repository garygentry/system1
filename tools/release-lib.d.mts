// Types for release-lib.mjs, so release-lib.test.ts typechecks.
export const ROOT: string
export const PACKAGES: string[]
export const STAGE_NPM: string
export function manifest(pkg: string): { name: string; version: string }
export function releaseVersion(): { version: string; error?: undefined } | { error: string }
export function checkTag(tag: string, version: string): string[]
export function atLeast(version: string, min: string): boolean
export function stageIdFrom(output: string): string | undefined
export interface StageItem {
  id: string
  packageName: string
  version: string
  [key: string]: unknown
}
export function stagedFor(items: StageItem[], name: string, version: string): StageItem[]
export function isPublished(name: string, version: string): boolean
export function waitUntilServed(
  names: string[],
  version: string,
  opts?: { waitMs?: number; stepMs?: number },
): string[]
