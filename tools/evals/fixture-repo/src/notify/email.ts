export async function sendEmail(to: string, subject: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  try {
    await fetch("https://mail.example.com/send", {
      method: "POST",
      body: JSON.stringify({ to, subject }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
