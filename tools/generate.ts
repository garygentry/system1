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
const PLUGIN_DIR = "plugins/decisions"

export interface Catalog {
  version: string
  owner: { name: string; email: string }
  repository: string
  license: string
  npm: { scope: string; cli: string; core: string }
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
      content: json({ ...common, displayName: plugin.displayName }),
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
    {
      path: "packages/core/src/version.ts",
      content: `// GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)\nexport const VERSION = "${version}"\n`,
    },
  ]

  // Stamp the one version into every package manifest, keeping everything else.
  for (const pkg of ["package.json", "packages/core/package.json", "packages/cli/package.json"]) {
    const current = JSON.parse(readFileSync(join(root, pkg), "utf8")) as Record<string, unknown>
    outputs.push({ path: pkg, content: json({ ...current, version }) })
  }
  return outputs
}

/**
 * The `decide` on PATH inside Claude Code (plugin `bin/` is added to the Bash
 * tool's PATH), and the entry the smoke tests put on PATH for Codex and Pi.
 *
 * Resolution order: an explicit override, then a repo checkout's build (dev and
 * smoke), then the pinned npm release.
 */
function shim(catalog: Catalog): string {
  return `#!/bin/sh
# GENERATED — DO NOT EDIT (source: catalog.yaml, via tools/generate.ts)
# Runs the decisions CLI pinned to this plugin's version.
set -e
if [ -n "\${DECISIONS_CLI:-}" ]; then
  exec node "$DECISIONS_CLI" "$@"
fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dev="$here/../../../packages/cli/dist/bin.js"
if [ -f "$dev" ]; then
  exec node "$dev" "$@"
fi
exec npx --yes "${cliPackageName(catalog)}@${catalog.version}" "$@"
`
}

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
