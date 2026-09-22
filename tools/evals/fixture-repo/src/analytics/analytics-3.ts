export function parseAnalytics3(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("analytics: bad payload", error)
    throw error
  }
}
