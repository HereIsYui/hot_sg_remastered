import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const serverUrl = process.env.HOT_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': serverUrl,
      '/ws': { target: serverUrl.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    environment: 'node',
  },
});
