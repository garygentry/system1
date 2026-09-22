// Bundles the CLI and its dependencies into dist/bundle/ as split ESM chunks.
// Each command's chunk loads only when that command runs (see main.ts), which
// keeps `decide version` / `help` startup close to bare node.
import { rmSync } from "node:fs"
import { build } from "esbuild"

rmSync("dist/bundle", { recursive: true, force: true })

await build({
  entryPoints: { decide: "src/entry.ts" },
  outdir: "dist/bundle",
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
