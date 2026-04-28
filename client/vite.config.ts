import { defineConfig } from 'vite';

export default defineConfig({
  // Empty postcss config so Vite does not walk up the directory tree and
  // accidentally pick up an unrelated project's PostCSS config. This client
  // ships no CSS framework — the UI is one button per screen (§ 6.2 hard rule
  // #2).
  css: { postcss: { plugins: [] } },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
