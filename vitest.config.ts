import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/setup/global.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
