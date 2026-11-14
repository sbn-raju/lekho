import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One in-memory replica set per file; files run in parallel workers.
    pool: 'forks',
  },
});
