import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Same postcss pin as vite.config.ts — see comment there.
  css: { postcss: { plugins: [] } },
  test: {
    globals: false,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/audio/**', 'src/voice/**', 'src/commands/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
