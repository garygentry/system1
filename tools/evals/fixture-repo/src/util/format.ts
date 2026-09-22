export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`
export const pad = (s: string, n: number) => s.padStart(n, " ")
