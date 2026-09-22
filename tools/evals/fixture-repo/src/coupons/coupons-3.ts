export function parseCoupons3(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("coupons: bad payload", error)
    throw error
  }
}
