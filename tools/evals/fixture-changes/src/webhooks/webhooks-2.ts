export async function loadWebhooks2(id: string) {
  const res = await fetch(`https://webhooks.example.com/webhooks/${id}`, { signal: AbortSignal.timeout(4_000) })
  console.log('debug', res.status)
  return res.json()
}
