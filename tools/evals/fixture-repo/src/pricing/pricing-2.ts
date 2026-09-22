export function parsePricing2(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("pricing: bad payload", error)
    throw error
  }
}
