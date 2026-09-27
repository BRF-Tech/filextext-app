import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname,
  base: './',
  build: { outDir: '../out/probe', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 8000 },
});
