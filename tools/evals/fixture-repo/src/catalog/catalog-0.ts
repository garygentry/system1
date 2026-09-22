export function parseCatalog0(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    console.error("catalog: bad payload", error)
    throw error
  }
}
