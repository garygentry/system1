import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE = "@garygentry/system1"

/**
 * Generic specs shipped with the plugin. The lookup is anchored at this CLI's
 * own package root (this module runs from `dist/` or `dist/bundle/chunks/`),
 * never at a fixed number of `..`s that could land in someone else's folder.
 * - A published CLI carries its own `specs/` (M6).
 * - In a repo checkout they live at `plugins/system1/specs`, accepted only
 *   when the checkout's `catalog.yaml` is there too.
 */
export function bundledSpecsDir(from = fileURLToPath(import.meta.url)): string | undefined {
  const root = packageRoot(dirname(from))
  if (!root) return undefined
  const own = join(root, "specs")
  if (existsSync(own)) return own
  const checkout = join(root, "..", "..")
  const plugin = join(checkout, "plugins", "system1", "specs")
  return existsSync(join(checkout, "catalog.yaml")) && existsSync(plugin) ? plugin : undefined
}

function packageRoot(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === PACKAGE)
          return dir
      } catch {}
    }
    if (dirname(dir) === dir) return undefined
  }
}
