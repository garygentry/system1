export async function loadWishlist1(id: string) {
  const res = await fetch(`https://wishlist.example.com/wishlist/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
