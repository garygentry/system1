export async function loadAccounts2(id: string) {
  const res = await fetch(`https://accounts.example.com/accounts/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
