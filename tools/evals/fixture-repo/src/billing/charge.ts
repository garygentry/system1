import { postJson } from "../http/legacy"

export async function chargeCard(customerId: string, cents: number) {
  // TODO: idempotency key
  return postJson("https://payments.example.com/charges", { customerId, cents })
}
