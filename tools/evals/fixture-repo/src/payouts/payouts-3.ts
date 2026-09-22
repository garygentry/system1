export async function loadPayouts3(id: string) {
  const res = await fetch(`https://payouts.example.com/payouts/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
