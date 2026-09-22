import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * Generic specs shipped with the plugin. In a repo checkout they live at
 * `plugins/decisions/specs`. A published CLI carries a copy in its own
 * `specs/` (M6). This module runs from `dist/` (tsc) or from
 * `dist/bundle/chunks/` (the esbuild bundle), so both depths are tried.
 */
export function bundledSpecsDir(): string | undefined {
  const candidates = [
    "../../../plugins/decisions/specs",
    "../../../../../plugins/decisions/specs",
    "../specs",
    "../../../specs",
  ].map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
  return candidates.find((dir) => existsSync(dir))
}
