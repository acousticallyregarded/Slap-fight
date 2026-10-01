import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode standalone` produces one self-contained HTML file that
// runs the full demo in the browser (no server, no live mode).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'standalone' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'standalone' ? 'dist-standalone' : 'dist', chunkSizeWarningLimit: 2000 },
  server: { proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
}));
