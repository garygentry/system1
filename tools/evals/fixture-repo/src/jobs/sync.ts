import { getJson } from "../http/client"

export async function syncCatalog() {
  try {
    return await getJson("https://catalog.example.com/items")
  } catch (error) {
    console.error("catalog sync failed", error)
    throw error
  }
}
