/**
 * Emits every per-harness artifact from `catalog.yaml`.
 *
 *   pnpm generate          write the files
 *   pnpm generate --check  exit 1 if any file on disk differs (CI drift guard)
 *
 * The rule this enforces: no authored duplication. Manifests differ per harness
 * only because their schemas differ; their content comes from one place.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PLUGIN_DIR = "plugins/system1"

export interface Catalog {
  version: string
  owner: { name: string; email: string }
  repository: string
  license: string
  npm: { scope: string; cli: string; core: string; pi: string }
  marketplace: { name: string }
  plugin: {
    name: string
    displayName: string
    description: string
    shortDescription: string
    category: string
    keywords: string[]
  }
}

export interface Output {
  path: string
  content: string
  executable?: boolean
}

export function loadCatalog(root = ROOT): Catalog {
  return parse(readFileSync(join(root, "catalog.yaml"), "utf8")) as Catalog
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export function cliPackageName(catalog: Catalog): string {
  return `${catalog.npm.scope}/${catalog.npm.cli}`
}

export function piPackageName(catalog: Catalog): string {
  return `${catalog.npm.scope}/${catalog.npm.pi}`
}

export function render(catalog: Catalog, root = ROOT): Output[] {
  const { plugin, version, owner, repository, license } = catalog
  const author = { name: owner.name, email: owner.email }
  const common = {
    name: plugin.name,
    version,
    description: plugin.description,
    author,
    homepage: repository,
    repository,
    license,
    keywords: plugin.keywords,
  }

  const outputs: Output[] = [
    // Claude Code: skills/ and bin/ are discovered by convention.
    {
      path: `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
      // Hooks are Claude-only (decision 0018), so they are named here rather
      // than left at hooks/hooks.json, where another host might discover them.
      content: json({
        ...common,
        displayName: plugin.displayName,
        hooks: "./hooks/claude-hooks.json",
      }),
    },
    // Codex: the shape its own shipped plugins use.
    {
      path: `${PLUGIN_DIR}/.codex-plugin/plugin.json`,
      content: json({
        ...common,
        skills: "./skills/",
        interface: {
          displayName: plugin.displayName,
          shortDescription: plugin.shortDescription,
          longDescription: plugin.description,
          developerName: owner.name,
          category: plugin.category,
          capabilities: ["Read"],
          websiteURL: repository,
        },
      }),
    },
    // Agent Plugins 1.0: the portable baseline for best-effort hosts.
    {
      path: `${PLUGIN_DIR}/plugin.json`,
      content: json({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        ...common,
      }),
    },
    {
      path: ".claude-plugin/marketplace.json",
      content: json({
        name: catalog.marketplace.name,
        owner: author,
        metadata: { description: plugin.shortDescription, version },
        plugins: [
          {
            name: plugin.name,
            source: `./${PLUGIN_DIR}`,
            description: plugin.description,
            version,
            category: plugin.category,
            keywords: plugin.keywords,
          },
        ],
      }),
    },
    {
      path: ".agents/plugins/marketplace.json",
      content: json({
        name: catalog.marketplace.name,
        interface: { displayName: plugin.displayName },
        plugins: [
          {
            name: plugin.name,
            source: { source: "local", path: `./${PLUGIN_DIR}` },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: plugin.category,
          },
        ],
      }),
    },
    { path: `${PLUGIN_DIR}/bin/decide`, content: shim(catalog), executable: true },
    { path: `${PLUGIN_DIR}/hooks/claude-hooks.json`, content: json(claudeHooks()) },
    // Pi reads skills through a package's `pi` key. This package is only that
    // key plus a copy of the skills, so `pi install npm:…` pulls no
    // devDependencies. The copy is made at pack time (prepack), not committed.
    {
      path: "packages/pi/package.json",
      content: json({
        name: piPackageName(catalog),
        version,
        description: `${plugin.description} Skills only, for Pi.`,
        type: "module",
        author,
        homepage: repository,
        repository: { type: "git", url: repository, directory: "packages/pi" },
        license,
        keywords: [...plugin.keywords, "pi-package"],
        engines: { node: ">=22" },
        pi: { skills: ["./skills"] },
        // prepack.mjs ships too, so an unpacked tarball can be repacked.
        files: ["skills", "prepack.mjs", "README.md", "LICENSE"],
        scripts: {
          prepack: "node prepack.mjs",
          prepublishOnly: "node ../../tools/prepublish-check.mjs",
        },
        publishConfig: { access: "public" },
      }),
    },
    {
      path: "packages/pi/prepack.mjs",
      content: `// GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)
// Copies the authored skills into this package just before it is packed, so
// they are written in one place only (${PLUGIN_DIR}/skills).
import { cpSync, existsSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, "../../${PLUGIN_DIR}/skills")
const to = join(here, "skills")
if (existsSync(from)) {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  console.log(\`system1-pi: copied skills from \${from}\`)
} else if (existsSync(to)) {
  // Repacking an unpacked tarball: the skills are already beside this script.
  console.log("system1-pi: skills already present")
} else {
  throw new Error(\`system1-pi: no skills at \${from}\`)
}
`,
    },
    {
      path: "packages/core/src/version.ts",
      content: `// GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)\nexport const VERSION = "${version}"\n/** The npm package that provides \`decide\`. */\nexport const CLI_PACKAGE = "${cliPackageName(catalog)}"\n`,
    },
  ]

  // Stamp the one version into every package manifest, keeping everything else.
  for (const pkg of ["package.json", "packages/core/package.json", "packages/cli/package.json"]) {
    if (!existsSync(join(root, pkg))) continue
    const current = JSON.parse(readFileSync(join(root, pkg), "utf8")) as Record<string, unknown>
    outputs.push({ path: pkg, content: json({ ...current, version }) })
  }
  return outputs
}

/**
 * Claude Code hooks (decision 0018). UserPromptSubmit asks \`decide route\`
 * whether the prompt calls for the ask skill; plain stdout becomes context.
 *
 * The hook must never get in the user's way: it prints only when decide exits
 * 0, always exits 0 itself (exit 2 would block the prompt), never lets the shim
 * download the CLI mid-prompt, and has a short timeout. Users tune or disable
 * it through \`route:\` in config, or \`SYSTEM1_ROUTE=off\`.
 */
function claudeHooks() {
  const command =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable that Claude Code expands
    'out=$(SYSTEM1_NO_NPX=1 "${CLAUDE_PLUGIN_ROOT}/bin/decide" route --hook --format brief 2>/dev/null) && printf \'%s\' "$out"; exit 0'
  return {
    description: "System 1: hint the ask skill for prompts that ask for closed judgements",
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command, timeout: 10 }] }],
    },
  }
}

/**
 * The `decide` on PATH inside Claude Code (plugin `bin/` is added to the Bash
 * tool's PATH), and the entry the smoke tests put on PATH for Codex and Pi.
 *
 * Resolution order: an explicit override, then a repo checkout's bundle (dev
 * and smoke), then a global install, then the pinned npm release.
 * - `$0` is resolved through symlinks first, so `ln -s <checkout>/…/bin/decide
 *   ~/bin/decide` still finds the checkout.
 * - The global lookup skips its own directory and every copy of this shim
 *   (recognised by its marker line); when grep cannot tell, it skips too, so
 *   shims can never exec each other. It wants a regular executable file and
 *   does not glob PATH entries.
 */
function shim(catalog: Catalog): string {
  const pinned = `${cliPackageName(catalog)}@${catalog.version}`
  // The path an npm install of this package always contains.
  const pkgPath = `${cliPackageName(catalog)}/`
  return `#!/bin/sh
# GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)
# ${SHIM_MARKER}
set -e
if [ -n "\${SYSTEM1_CLI:-}" ]; then
  exec node "$SYSTEM1_CLI" "$@"
fi
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname -- "$self")/$link ;;
  esac
done
here=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd -P)
dev="$here/../../../packages/cli/dist/bundle/decide.mjs"
if [ -f "$dev" ]; then
  exec node "$dev" "$@"
fi
set -f
old_ifs=$IFS; IFS=:
for dir in $PATH; do
  cand="$dir/decide"
  [ -n "$dir" ] && [ -f "$cand" ] && [ -x "$cand" ] || continue
  [ "$(CDPATH= cd -- "$dir" 2>/dev/null && pwd -P)" = "$here" ] && continue
  # grep: 0 = a shim, 1 = not a shim, 2 = can't tell. Only exec on 1, so a
  # missing or broken grep can never make shims exec each other.
  rc=0; grep -qs "${SHIM_MARKER}" "$cand" || rc=$?
  [ "$rc" -eq 1 ] || continue
  # Only a real install of this package counts. Without this, any executable
  # named decide on PATH would silently replace the pinned CLI.
  target=$cand
  while [ -L "$target" ]; do
    link=$(readlink "$target")
    case $link in
      /*) target=$link ;;
      *) target=$(dirname -- "$target")/$link ;;
    esac
  done
  case $target in
    *"${pkgPath}"*) ;;
    *) continue ;;
  esac
  IFS=$old_ifs; set +f
  exec "$cand" "$@"
done
IFS=$old_ifs; set +f
# SYSTEM1_NO_NPX: never download (doctor's version probe sets it).
if [ -z "\${SYSTEM1_NO_NPX:-}" ] && command -v npx >/dev/null 2>&1; then
  exec npx --yes "${pinned}" "$@"
fi
echo "decide: the System 1 CLI is not installed. Install it with: npm i -g ${pinned}" >&2
exit 127
`
}

/** Identifies a copy of the shim, so the global lookup can skip it. */
const SHIM_MARKER = "system1-shim: runs the System 1 CLI pinned to this plugin's version"

export function drift(outputs: Output[], root = ROOT): string[] {
  return outputs
    .filter((o) => {
      const file = join(root, o.path)
      return !existsSync(file) || readFileSync(file, "utf8") !== o.content
    })
    .map((o) => o.path)
}

function write(outputs: Output[], root = ROOT): void {
  for (const o of outputs) {
    const file = join(root, o.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, o.content)
    if (o.executable) chmodSync(file, 0o755)
  }
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") {
  const outputs = render(loadCatalog())
  const changed = drift(outputs)
  if (process.argv.includes("--check")) {
    if (changed.length > 0) {
      console.error(
        `Generated files are out of date. Run \`pnpm generate\`:\n  ${changed.join("\n  ")}`,
      )
      process.exit(1)
    }
    console.log(`generate: ${outputs.length} files up to date`)
  } else {
    write(outputs)
    console.log(`generate: wrote ${outputs.length} files (${changed.length} changed)`)
  }
}
