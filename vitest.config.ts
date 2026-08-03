import { defineConfig } from "vitest/config";

// Minimal, app-plugin-free config: the suites cover pure calculation/aggregation
// helpers, so we avoid loading the TanStack/Cloudflare Vite plugins here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
