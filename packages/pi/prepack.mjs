// GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)
// Copies the authored skills into this package just before it is packed, so
// they are written in one place only (plugins/system1/skills).
import { cpSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, "../../plugins/system1/skills")
const to = join(here, "skills")
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log(`system1-pi: copied skills from ${from}`)
