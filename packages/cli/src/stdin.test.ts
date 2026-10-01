import { spawnSync } from "node:child_process"
import type { readSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { readStdinSync } from "./stdin.js"

describe("readStdinSync", () => {
  it("waits out EAGAIN on a non-blocking pipe and reads to EOF", () => {
    const parts = ["héllo ", "EAGAIN", "wörld", "EAGAIN", ""]
    const read = ((_fd: number, buffer: Buffer) => {
      const part = parts.shift() ?? ""
      if (part === "EAGAIN") throw Object.assign(new Error("again"), { code: "EAGAIN" })
      return buffer.write(part)
    }) as unknown as typeof readSync
    expect(readStdinSync(read)).toBe("héllo wörld")
  })

  it("rethrows anything but EAGAIN", () => {
    const read = (() => {
      throw Object.assign(new Error("bad"), { code: "EBADF" })
    }) as unknown as typeof readSync
    expect(() => readStdinSync(read)).toThrow("bad")
  })

  // The bug it fixes: with process.stdin touched, fd 0 is non-blocking, and
  // readFileSync(0) threw EAGAIN on an OS pipe a slow writer hadn't filled yet.
  it("reads a large request from a slow writer after process.stdin was touched", () => {
    const module = JSON.stringify(new URL("./stdin.ts", import.meta.url).href)
    const reader = `process.stdin.isTTY; const { readStdinSync } = await import(${module}); console.log(readStdinSync().length)`
    const writer = `for i in 1 2 3 4 5 6 7 8 9 10; do head -c 20000 /dev/zero | tr '\\0' x; sleep 0.01; done`
    const done = spawnSync(
      "sh",
      ["-c", `${writer} | "$0" --input-type=module -e "$1"`, process.execPath, reader],
      {
        encoding: "utf8",
      },
    )
    expect(done.stderr).toBe("")
    expect(done.stdout.trim()).toBe("200000")
  })
})
