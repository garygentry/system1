import { existsSync } from "node:fs"
import { defineConfig } from "vitest/config"

// The only place this repo's `.env` is read: the engine and CLI never load one
// (a project's .env belongs to that project). Tests skip when no key is set.
if (existsSync(".env")) process.loadEnvFile(".env")

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.live.test.ts"],
    testTimeout: 60_000,
  },
})
