import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/prtcorsim/',
  plugins: [svelte()],
  build: {
    target: 'es2022',
    rolldownOptions: { input: { index: 'index.html', en: 'en.html' } },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['mupdf', 'lcms-wasm'] },
});
