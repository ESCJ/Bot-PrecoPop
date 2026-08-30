import { defineConfig } from "vitest/config";

/**
 * Testes de integração: exigem um PostgreSQL real acessível via DATABASE_URL.
 * Rodam em série (`singleFork`) porque compartilham o mesmo schema.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
