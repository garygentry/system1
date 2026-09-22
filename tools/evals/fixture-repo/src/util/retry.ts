export async function retry<T>(fn: () => Promise<T>, times = 3): Promise<T | undefined> {
  for (let i = 0; i < times; i++) {
    try {
      return await fn()
    } catch (e) {
      // ignore and try again
    }
  }
  return undefined
}
