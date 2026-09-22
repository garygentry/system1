export async function loadShipping1(id: string) {
  const res = await fetch(`https://shipping.example.com/shipping/${id}`)
  return res.json()
}
