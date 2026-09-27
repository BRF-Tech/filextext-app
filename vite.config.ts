import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The interface is served by filex from `/_appui/<app>/<bundle-sha>/`, so
// every asset path is relative. Everything is bundled: the frame has no
// network (connect-src 'none') and loads nothing from anywhere else.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@brftech/filex-app-ui': fileURLToPath(new URL('./vendor/filex-app-ui/filex-app-ui.js', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
    // No inlined assets: `data:` would need a wider CSP than the one filex
    // generates for fonts and scripts.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
