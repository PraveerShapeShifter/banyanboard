/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The SPA calls a same-origin, prefixed path (`/api/*`). In dev, Vite forwards
// `/api/*` to the running Express API and strips the `/api` prefix, so the
// browser only ever makes same-origin requests (CORS never engages) and the
// backend stays untouched. The `/api` prefix also resolves the `/boards`
// API-path vs. `/boards/:id` client-route collision. See
// memory-bank/creative/TASK-004-react-frontend-architecture.md (Q4A).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
