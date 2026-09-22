export function parsePayouts2(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("payouts: bad payload", error)
    throw error
  }
}
