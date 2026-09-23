#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { main } from "./main.js"

const line = (stream: NodeJS.WriteStream) => (text: string) =>
  stream.write(text.endsWith("\n") ? text : `${text}\n`)

process.exitCode = await main(process.argv.slice(2), {
  out: line(process.stdout),
  err: line(process.stderr),
  env: process.env,
  cwd: process.cwd(),
  readStdin: () => readFileSync(0, "utf8"),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
})
