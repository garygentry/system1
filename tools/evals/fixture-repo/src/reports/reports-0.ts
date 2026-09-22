export async function loadReports0(id: string) {
  const res = await fetch(`https://reports.example.com/reports/${id}`, {
    signal: AbortSignal.timeout(4_000),
  })
  return res.json()
}
