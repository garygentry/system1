import { postJson } from "../http/legacy"

export async function refund(chargeId: string) {
  try {
    return await postJson("https://payments.example.com/refunds", { chargeId })
  } catch {
    return null
  }
}
