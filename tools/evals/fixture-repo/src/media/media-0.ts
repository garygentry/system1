export async function loadMedia0(id: string) {
  const res = await fetch(`https://media.example.com/media/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
