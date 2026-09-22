export function parseReviews2(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("reviews: bad payload", error)
    throw error
  }
}
