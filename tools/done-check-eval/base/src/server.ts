import { createServer } from "node:http"
import { LinkStore } from "./store.js"

const store = new LinkStore()

export const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/") {
    let body = ""
    for await (const chunk of req) body += chunk
    const slug = store.put(body.trim())
    res.writeHead(201, { "content-type": "text/plain" }).end(slug)
    return
  }
  const url = store.get((req.url ?? "/").slice(1))
  if (!url) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(302, { location: url }).end()
})
