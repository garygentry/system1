export function parseReports2(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("reports: bad payload", error)
    throw error
  }
}
