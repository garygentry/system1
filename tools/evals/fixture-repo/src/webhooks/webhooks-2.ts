export async function loadWebhooks2(id: string) {
  const res = await fetch(`https://webhooks.example.com/webhooks/${id}`)
  return res.json()
}
