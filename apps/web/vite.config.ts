import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** サーバー（CAMP）の番号。手元で2つ目の開発サーバーを別の番号で動かすときは CAMP_PORT を渡す */
const camp = process.env.CAMP_PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/camp': { target: `ws://localhost:${camp}`, ws: true },
      '/api': { target: `http://localhost:${camp}` },
      '/voice': { target: `ws://localhost:${camp}`, ws: true },
    },
  },
});
