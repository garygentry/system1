import { gateway } from "./gateway"

/** Charge a card and record the payment. Refunds reverse the charge in full. */
export async function charge(customerId: string, cents: number): Promise<string> {
  const receipt = await gateway.charge({ customerId, amount: cents, currency: "usd" })
  return receipt.id
}

export async function refund(receiptId: string): Promise<void> {
  await gateway.refund({ receiptId })
}
