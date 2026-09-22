export async function loadAnalytics4(id: string) {
  const res = await fetch(`https://analytics.example.com/analytics/${id}`, { signal: AbortSignal.timeout(4_000) })
  return res.json()
}
