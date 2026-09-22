export async function loadAnalytics4(id: string) {
  const res = await fetch(`https://analytics.example.com/analytics/${id}`)
  return res.json()
}
