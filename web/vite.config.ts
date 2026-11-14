import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** The Worker's API paths. Everything else (the app itself) is served by Vite. */
const API_PATHS = ['files', 'health', 'links', 'me', 'trash', 'uploads', 'usage'];

// Builds straight into the Worker's static assets folder so `wrangler deploy` ships the PWA with the API.
export default defineConfig(({ mode }) => {
  // FATUP_SERVER (in web/.env.local or the shell): the deployed Worker, e.g. https://fatup.<you>.workers.dev. `npm run dev:web` then
  // forwards the API to it, so the dev app works on the real database and files. The Worker sends no CORS headers (it serves the
  // PWA itself), hence the proxy rather than calling it directly; on the setup screen keep the address that is filled in.
  const server = process.env.FATUP_SERVER ?? loadEnv(mode, import.meta.dirname, 'FATUP_').FATUP_SERVER;
  return {
    root: import.meta.dirname,
    plugins: [react()],
    server: {
      fs: { allow: ['..'] },
      proxy: server ? { [`^/(${API_PATHS.join('|')})(/|\\?|$)`]: { target: server.replace(/\/+$/, ''), changeOrigin: true, secure: true } } : undefined,
    },
    build: { outDir: '../worker/public', emptyOutDir: true, minify: true },
    test: { environment: 'node' },
  };
});
