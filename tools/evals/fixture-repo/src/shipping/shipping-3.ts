export function parseShipping3(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("shipping: bad payload", error)
    throw error
  }
}
