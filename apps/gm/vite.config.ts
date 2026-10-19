import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const serverUrl = process.env.HOT_SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: { '/api': serverUrl },
  },
});
