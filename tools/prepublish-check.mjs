// Refuses to publish a package whose build output is missing or stale.
// `npm publish` runs this through each package's prepublishOnly hook.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const pkgDir = process.cwd()
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
const problems = []

const required = [
  ...(pkg.bin ? Object.values(pkg.bin) : []),
  ...(pkg.exports
    ? Object.values(pkg.exports).flatMap((e) => (typeof e === "string" ? [e] : Object.values(e)))
    : []),
  ...(pkg.files ?? []).filter((f) => !f.includes("*")),
]
for (const rel of required) {
  if (!existsSync(join(pkgDir, rel))) problems.push(`missing ${rel} (run \`pnpm build\`)`)
}

// Stale check: any source newer than the newest build output.
const newest = (dir) => {
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => statSync(join(e.parentPath ?? e.path, e.name)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0)
}
const src = newest(join(pkgDir, "src"))
const out = newest(join(pkgDir, "dist"))
if (src && out && src > out) problems.push("dist is older than src (run `pnpm build`)")

if (problems.length) {
  console.error(`${pkg.name}: refusing to publish\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log(`${pkg.name}: build output present`)
