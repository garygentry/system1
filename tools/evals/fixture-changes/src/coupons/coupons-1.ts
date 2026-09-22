export async function loadCoupons1(id: string) {
  const res = await fetch(`https://coupons.example.com/coupons/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
