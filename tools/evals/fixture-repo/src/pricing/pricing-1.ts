export async function loadPricing1(id: string) {
  const res = await fetch(`https://pricing.example.com/pricing/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
