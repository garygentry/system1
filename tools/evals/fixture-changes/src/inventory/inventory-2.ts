export async function loadInventory2(id: string) {
  const res = await fetch(`https://inventory.example.com/inventory/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
