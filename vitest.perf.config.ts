import { defineConfig } from 'vitest/config';

/** Performance-Budgets – getrennt von den normalen Tests, ohne Coverage-Instrumentierung. */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.perf.ts'],
    testTimeout: 300_000,
  },
});
