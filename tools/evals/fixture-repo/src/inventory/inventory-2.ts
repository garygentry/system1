export async function loadInventory2(id: string) {
  const res = await fetch(`https://inventory.example.com/inventory/${id}`)
  return res.json()
}
