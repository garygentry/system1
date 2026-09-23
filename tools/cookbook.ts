/**
 * The cookbook: tested question sets in `cookbook/<name>.yaml`, with their
 * recorded answers in `cookbook/fixtures/<name>/`. `cookbook.test.ts` replays
 * every recipe the way a user adopts one (copied into a repo's `.system1/`),
 * so a recipe that stops passing fails `pnpm test`.
 *
 *   tsx tools/cookbook.ts record [name…]    # live; needs a key and this repo's consent
 *
 * Recording runs `decide spec check <name> --live` in this repo, with the
 * cookbook as the bundled spec directory, into a cleared fixture namespace, and
 * then moves the answers to `cookbook/fixtures/<name>/`. Only answers for the
 * current wording are kept. It never reads `.env`: put the key in the
 * environment yourself.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { main } from "../packages/cli/src/main.js"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const COOKBOOK = join(ROOT, "cookbook")

export function recipeNames(): string[] {
  return readdirSync(COOKBOOK)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -".yaml".length))
    .sort()
}

/** What a user does to adopt a recipe: copy the spec and its answers into `.system1/`. */
export function adopt(name: string, repo: string): void {
  mkdirSync(join(repo, ".system1/specs"), { recursive: true })
  cpSync(join(COOKBOOK, `${name}.yaml`), join(repo, ".system1/specs", `${name}.yaml`))
  const fixtures = join(COOKBOOK, "fixtures", name)
  if (existsSync(fixtures)) {
    cpSync(fixtures, join(repo, ".system1/fixtures", name), { recursive: true })
  }
}

async function record(names: string[]): Promise<number> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("cookbook: recording is live and needs OPENROUTER_API_KEY in the environment")
    return 2
  }
  let status = 0
  for (const name of names) {
    const scratch = join(ROOT, ".system1/fixtures", name)
    rmSync(scratch, { recursive: true, force: true })
    const code = await main(["spec", "check", name, "--live", "--format", "brief"], {
      out: (t) => console.log(t),
      err: (t) => console.error(t),
      env: { ...process.env, SYSTEM1_SPECS_PATH: COOKBOOK },
      cwd: ROOT,
    })
    // spec check exits 0 with failing examples (a result, not an error), so
    // the answers are kept either way: read the output before committing.
    if (code !== 0) {
      status = code
      continue
    }
    const target = join(COOKBOOK, "fixtures", name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    renameSync(scratch, target)
  }
  return status
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2)
  if (command !== "record") {
    console.error("usage: tsx tools/cookbook.ts record [name…]")
    process.exit(2)
  }
  const names = rest.length > 0 ? rest : recipeNames()
  process.exit(await record(names))
}
