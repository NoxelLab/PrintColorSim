import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/prtcorsim/',
  plugins: [svelte()],
  build: { target: 'es2022' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['mupdf', 'lcms-wasm'] },
});
