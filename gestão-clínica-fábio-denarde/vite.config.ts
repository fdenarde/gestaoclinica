import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('jspdf') || id.includes('jspdf-autotable')) return 'vendor-pdf';
            if (id.includes('html2canvas')) return 'vendor-html2canvas';
            if (id.includes('dompurify')) return 'vendor-dompurify';
            if (id.includes('papaparse')) return 'vendor-papaparse';
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('motion') || id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('date-fns')) return 'vendor-date';
            if (id.includes('lucide-react') || id.includes('lucide')) return 'vendor-icons';
            if (id.includes('clsx') || id.includes('tailwind-merge')) return 'vendor-ui';
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        '/api/drive': {
          target: `http://127.0.0.1:${env.DRIVE_API_PORT || '3002'}`,
          changeOrigin: true,
        },
      },
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
