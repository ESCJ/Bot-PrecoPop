import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/services/**", "src/bot/ui/**"],
      reporter: ["text", "lcov"],
    },
  },
});
