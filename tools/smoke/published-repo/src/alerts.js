export async function postAlert(webhook, text) {
  const ctrl = AbortSignal.timeout(5000);
  await fetch(webhook, { method: "POST", body: JSON.stringify({ text }), signal: ctrl });
}
