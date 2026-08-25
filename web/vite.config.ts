import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The vendored TeaVM engine is a large ES module; don't let esbuild choke pre-bundling it.
  optimizeDeps: { exclude: ['./src/engine/vendor/orkengine.mjs'] },
});
