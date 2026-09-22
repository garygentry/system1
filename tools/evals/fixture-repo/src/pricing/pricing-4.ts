export function parsePricing4(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
