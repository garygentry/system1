// Older helper still used by billing. TODO: migrate callers to client.ts
export async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(body) })
  return res.json()
}
