export async function loadCatalog2(id: string) {
  const res = await fetch(`https://catalog.example.com/catalog/${id}`)
  return res.json()
}
