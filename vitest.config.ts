import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests spin real Postgres via testcontainers; they need
    // generous timeouts and serial execution to avoid port/container churn.
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    // Single fork so all suites share one testcontainer rather than
    // spinning up N concurrent Postgres instances.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
