import { readSync } from "node:fs"

/**
 * All of stdin, read synchronously to EOF. `readFileSync(0)` throws EAGAIN
 * when fd 0 is a non-blocking pipe and the writer hasn't caught up, which is
 * how a request larger than the pipe buffer arrives from a slow writer (an
 * adopted Python module spawning `decide runtime`). Here an empty, non-blocking
 * pipe is waited on instead, and only 0 bytes read is the end.
 */
export function readStdinSync(read: typeof readSync = readSync, fd = 0): string {
  const chunks: Buffer[] = []
  const buffer = Buffer.alloc(64 * 1024)
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    let n: number
    try {
      n = read(fd, buffer, 0, buffer.length, null)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error
      Atomics.wait(pause, 0, 0, 5)
      continue
    }
    if (n === 0) break
    chunks.push(Buffer.from(buffer.subarray(0, n)))
  }
  return Buffer.concat(chunks).toString("utf8")
}
