import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Minimal, app-plugin-free config: the suites cover pure calculation/aggregation
// helpers, so we avoid loading the TanStack/Cloudflare Vite plugins here.
export default defineConfig({
  // Mesmo alias do app, para as suítes importarem "@/lib/..." como o código.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
