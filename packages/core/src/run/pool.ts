/**
 * Run `worker` over every item, never more than `limit` at once.
 *
 * Results come back in input order whatever the completion order, so callers
 * can zip them against their inputs by index.
 *
 * A rejected worker never aborts the run: in a wide fan-out, one transient
 * upstream error would otherwise throw away every sibling result that was
 * already paid for. Failures are captured per item instead.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Array<{ value: R } | { error: Error }>> {
  const width = Math.max(1, Math.min(limit, items.length || 1))
  const results = new Array<{ value: R } | { error: Error }>(items.length)
  let next = 0
  let completed = 0

  async function run(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        results[index] = { value: await worker(items[index] as T, index) }
      } catch (error) {
        results[index] = { error: error instanceof Error ? error : new Error(String(error)) }
      }
      completed += 1
      onProgress?.(completed, items.length)
    }
  }

  await Promise.all(Array.from({ length: width }, run))
  return results
}
