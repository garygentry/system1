export async function loadSearch1(id: string) {
  const res = await fetch(`https://search.example.com/search/${id}`)
  return res.json()
}
