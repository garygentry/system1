import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * Generic specs shipped with the plugin. In a repo checkout they live at
 * `plugins/decisions/specs`. A published CLI carries a copy in its own
 * `specs/` (M6).
 */
export function bundledSpecsDir(): string | undefined {
  const candidates = ["../../../plugins/decisions/specs", "../specs"].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  )
  return candidates.find((dir) => existsSync(dir))
}
