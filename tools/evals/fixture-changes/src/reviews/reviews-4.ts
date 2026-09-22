export async function loadReviews4(id: string) {
  const res = await fetch(`https://reviews.example.com/reviews/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
