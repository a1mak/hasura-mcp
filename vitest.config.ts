import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests need the disposable Hasura fixture on :8299 and are
    // opt-in; see docs/superpowers/fixture/README.md and issue #2.
    exclude: ['tests/integration/**', 'node_modules/**'],
    coverage: { include: ['src/**/*.ts'], reporter: ['text', 'lcov'] },
  },
});
