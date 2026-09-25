// Refuses to publish a package whose build output is missing or stale.
// `npm publish` runs this through each package's prepublishOnly hook.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const pkgDir = process.cwd()
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
const problems = []

// Build rather than guess whether the output is current: `tsc -b` skips
// rewriting files it would emit identically, so timestamps lie. npm runs
// prepublishOnly before prepack, so run prepack too: on a fresh checkout (the
// release workflow) Pi's skills exist only once its prepack has copied them.
for (const script of ["build", "prepack"]) {
  if (!pkg.scripts?.[script]) continue
  try {
    execFileSync("npm", ["run", "--silent", script], { cwd: pkgDir, stdio: "inherit" })
  } catch {
    problems.push(`${script} failed`)
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
