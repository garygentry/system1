export async function loadReviews4(id: string) {
  const res = await fetch(`https://reviews.example.com/reviews/${id}`)
  return res.json()
}
