# linkr

A tiny URL shortener: `POST /` with a URL returns a short slug, and `GET /<slug>`
redirects to it.

## Usage

```ts
import { LinkStore } from "./src/store.js"

const store = new LinkStore()
const slug = store.put("https://example.com/a/long/path")
store.get(slug) // "https://example.com/a/long/path"
```
