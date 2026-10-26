import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { localApi } from './scripts/local-api.js';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Loaded only in the Node development server. Never prefix credentials with VITE_.
  const local = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(local)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return {
    plugins: [react(), localApi()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
