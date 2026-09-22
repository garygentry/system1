export async function loadCoupons1(id: string) {
  const res = await fetch(`https://coupons.example.com/coupons/${id}`)
  return res.json()
}
