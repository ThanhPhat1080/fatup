import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds straight into the Worker's static assets folder so `wrangler deploy` ships the PWA with the API.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../worker/public', emptyOutDir: true, minify: true },
  test: { environment: 'node' },
});
