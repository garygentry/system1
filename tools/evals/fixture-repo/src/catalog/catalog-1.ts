export async function loadCatalog1(id: string) {
  const res = await fetch(`https://catalog.example.com/catalog/${id}`)
  return res.json()
}
