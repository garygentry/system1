import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "tools/**/*.test.ts"],
    // Live tests spend real money; they run only via `pnpm test:live`.
    exclude: [
      "**/*.live.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      // Files agents act on in evals, not tests of this repo.
      "tools/evals/fixture-*/**",
    ],
  },
})
