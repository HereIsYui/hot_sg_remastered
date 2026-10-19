import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
  // SWC emits decorator metadata, which Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
