// Bundles the CLI and its dependencies into dist/bundle/ as split ESM chunks.
// Each command's chunk loads only when that command runs (see main.ts), which
// keeps `decide version` / `help` startup close to bare node.
import { renameSync, rmSync } from "node:fs"
import { build } from "esbuild"

// Build beside the live bundle and swap it in, so a concurrent `decide` (the
// shim runs this bundle) never finds it missing mid-build.
rmSync("dist/bundle.next", { recursive: true, force: true })

await build({
  entryPoints: { decide: "src/entry.ts" },
  outdir: "dist/bundle.next",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outExtension: { ".js": ".mjs" },
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  // CommonJS dependencies (yaml) call require(); give every chunk a real one.
  banner: {
    js: 'import { createRequire as __decideRequire } from "node:module"; const require = __decideRequire(import.meta.url);',
  },
  logLevel: "warning",
})

rmSync("dist/bundle.old", { recursive: true, force: true })
try {
  renameSync("dist/bundle", "dist/bundle.old")
} catch {}
renameSync("dist/bundle.next", "dist/bundle")
rmSync("dist/bundle.old", { recursive: true, force: true })
