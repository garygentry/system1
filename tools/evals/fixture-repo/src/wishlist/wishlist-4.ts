export async function loadWishlist4(id: string) {
  const res = await fetch(`https://wishlist.example.com/wishlist/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
