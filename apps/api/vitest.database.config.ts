import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Database suites intentionally rebuild the shared test schema. Running
    // files concurrently would let one suite drop another suite's tables.
    fileParallelism: false,
    include: ['src/**/*.database.test.ts'],
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
