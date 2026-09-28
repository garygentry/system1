// Asks Codex which hooks it would run in a directory, through `codex app-server`
// (`hooks/list`), and prints the system1 ones: `codex hooks: system1 session_start stop (untrusted)`.
// Codex loads plugin hooks silently or not at all (a root plugin.json once hid
// them, 0007), so smoke asserts on what Codex itself reports.
//   node tools/smoke/codex-hooks.mjs <dir>        (CODEX_HOME from the environment)
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const cwd = resolve(process.argv[2] ?? ".")
const server = spawn("codex", ["app-server"], { cwd, stdio: ["pipe", "pipe", "ignore"] })
const send = (message) => server.stdin.write(`${JSON.stringify(message)}\n`)
const timer = setTimeout(() => finish("codex hooks: no answer from codex app-server"), 30_000)
let buffer = ""

function finish(line) {
  clearTimeout(timer)
  console.log(line)
  server.kill()
}

server.stdout.on("data", (chunk) => {
  buffer += chunk
  for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
    const line = buffer.slice(0, i)
    buffer = buffer.slice(i + 1)
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.id !== 2) continue
    const hooks = (message.result?.data?.[0]?.hooks ?? []).filter((h) =>
      h.pluginId?.startsWith("system1@"),
    )
    if (hooks.length === 0) return finish("codex hooks: none from system1")
    const events = hooks.map((h) => h.key.split(":").at(-3)).join(" ")
    const trust = [...new Set(hooks.map((h) => h.trustStatus))].join(",")
    finish(`codex hooks: system1 ${events} (${trust})`)
  }
})

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { clientInfo: { name: "smoke", version: "0" } },
})
send({ jsonrpc: "2.0", method: "initialized", params: {} })
send({ jsonrpc: "2.0", id: 2, method: "hooks/list", params: { cwds: [cwd] } })
