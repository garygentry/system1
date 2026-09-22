export function parseWishlist0(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("wishlist: bad payload", error)
    throw error
  }
}
