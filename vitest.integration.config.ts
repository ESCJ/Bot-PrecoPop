import { defineConfig } from "vitest/config";

/**
 * Testes de integração: exigem um PostgreSQL real acessível via DATABASE_URL.
 * Rodam em série (`singleFork`) porque compartilham o mesmo schema, e com
 * `isolate` ligado para que cada arquivo receba o próprio pool de conexões —
 * sem isso, o `pool.end()` de um arquivo derrubaria os seguintes.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    isolate: true,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
