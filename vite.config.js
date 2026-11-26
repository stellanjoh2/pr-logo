import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The single-file plugin inlines everything per entry, so each page is built in its own pass.
const page = process.env.PAGE ?? 'index';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    emptyOutDir: page === 'index',
    rollupOptions: {
      input: resolve(__dirname, `${page}.html`),
    },
  },
  server: {
    open: true,
  },
});
