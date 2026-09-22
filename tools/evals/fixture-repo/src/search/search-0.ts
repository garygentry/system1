export function parseSearch0(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("search: bad payload", error)
    throw error
  }
}
