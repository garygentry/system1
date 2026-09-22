export async function loadCoupons2(id: string) {
  const res = await fetch(`https://coupons.example.com/coupons/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
