export async function loadSearch1(id: string) {
  const res = await fetch(`https://search.example.com/search/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
