import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Expose the package version to the app (shown in the header).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The vendored TeaVM engine is a large ES module; don't let esbuild choke pre-bundling it.
  optimizeDeps: { exclude: ['./src/engine/vendor/orkengine.mjs'] },
});
