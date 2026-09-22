export function parsePricing3(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
