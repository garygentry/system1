export async function loadMedia3(id: string) {
  const res = await fetch(`https://media.example.com/media/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
