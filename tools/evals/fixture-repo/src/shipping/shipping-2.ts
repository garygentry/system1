export async function loadShipping2(id: string) {
  const res = await fetch(`https://shipping.example.com/shipping/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
