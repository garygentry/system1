/** Minimal leveled logger that writes JSON lines to stderr. */
export function log(level: "info" | "warn" | "error", message: string): void {
  process.stderr.write(`${JSON.stringify({ level, message, at: new Date().toISOString() })}\n`)
}
