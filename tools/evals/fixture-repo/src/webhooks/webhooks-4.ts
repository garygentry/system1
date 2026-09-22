export function totalWebhooks4(items: { cents: number; qty: number }[]): number {
  return items.reduce((sum, i) => sum + i.cents * i.qty, 0)
}
