import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The real package throws outside a React Server context; tests
      // exercise server modules directly.
      "server-only": path.resolve(__dirname, "src/test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    globalSetup: ["src/test/global-setup.ts"],
  },
});
