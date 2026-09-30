import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Excluded by default: these need the disposable Hasura fixture running.
    exclude: ['tests/integration/**', 'node_modules/**'],
    coverage: { include: ['src/**/*.ts'], reporter: ['text', 'lcov'] },
  },
});
