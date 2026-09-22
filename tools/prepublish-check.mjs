// Refuses to publish a package whose build output is missing or stale.
// `npm publish` runs this through each package's prepublishOnly hook.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const pkgDir = process.cwd()
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
const problems = []

// Build rather than guess whether the output is current: `tsc -b` skips
// rewriting files it would emit identically, so timestamps lie.
if (pkg.scripts?.build) {
  try {
    execFileSync("npm", ["run", "--silent", "build"], { cwd: pkgDir, stdio: "inherit" })
  } catch {
    problems.push("build failed")
  }
}

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

if (problems.length) {
  console.error(`${pkg.name}: refusing to publish\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log(`${pkg.name}: build output present`)
