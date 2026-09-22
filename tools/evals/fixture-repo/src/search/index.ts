export function score(query: string, doc: string): number {
  const terms = query.toLowerCase().split(/\s+/)
  return terms.filter((t) => doc.toLowerCase().includes(t)).length / terms.length
}
