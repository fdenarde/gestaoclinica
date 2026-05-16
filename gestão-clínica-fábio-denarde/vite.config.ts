import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: mode === 'production' ? '/gestaoclinica/' : '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Use polling on Windows and ignore problematic paths to avoid file‑watcher crashes
      watch: {
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/gestão-clínica-fábio-denarde/**',
          '**/.wwebjs_auth/**',
          '**/.wwebjs_cache/**',
          '**/.wwebjs_auth_temp/**'
        ],
        usePolling: true,
        interval: 1000,
      },

      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
