export function parseOrders1(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("orders: bad payload", error)
    throw error
  }
}
