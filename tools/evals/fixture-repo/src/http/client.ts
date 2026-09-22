export async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.json()
}
