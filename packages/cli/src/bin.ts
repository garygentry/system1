#!/usr/bin/env node
import { isatty } from "node:tty"
import { main } from "./main.js"
import { readStdinSync } from "./stdin.js"

const line = (stream: NodeJS.WriteStream) => (text: string) =>
  stream.write(text.endsWith("\n") ? text : `${text}\n`)

process.exitCode = await main(process.argv.slice(2), {
  out: line(process.stdout),
  err: line(process.stderr),
  env: process.env,
  cwd: process.cwd(),
  readStdin: () => readStdinSync(),
  // isatty, not process.stdin.isTTY: touching process.stdin makes a piped fd 0
  // non-blocking, and a synchronous read of it then fails with EAGAIN.
  interactive: isatty(0) && isatty(1),
  exitWhenFlushed: () => process.stdout.write("", () => process.exit(0)),
})
