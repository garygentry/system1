export async function loadCoupons2(id: string) {
  const res = await fetch(`https://coupons.example.com/coupons/${id}`)
  return res.json()
}
