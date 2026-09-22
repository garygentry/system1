export async function loadCatalog1(id: string) {
  const res = await fetch(`https://catalog.example.com/catalog/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
