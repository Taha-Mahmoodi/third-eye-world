import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pin postcss to an empty config so Vite does not walk up the directory
  // tree looking for one and accidentally pick up an unrelated project's
  // PostCSS / Tailwind config. Server tests are Node-only, no CSS.
  css: { postcss: { plugins: [] } },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/llm/**', 'src/routes/**', 'src/lib/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
