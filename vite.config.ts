import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HUB = `http://127.0.0.1:${process.env.SYSDESIGN_PORT || 4321}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': HUB,
      '/ws': { target: HUB.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
