import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/scenario/**/*.scenario.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Scenarios should be deterministic; keep them sequential.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
  },
});

