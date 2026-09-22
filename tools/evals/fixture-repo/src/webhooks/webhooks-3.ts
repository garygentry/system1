export function parseWebhooks3(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("webhooks: bad payload", error)
    throw error
  }
}
