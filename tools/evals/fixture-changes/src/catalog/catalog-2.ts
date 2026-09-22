export async function loadCatalog2(id: string) {
  const res = await fetch(`https://catalog.example.com/catalog/${id}`, { signal: AbortSignal.timeout(4_000) })
  console.log('debug', res.status)
  return res.json()
}
