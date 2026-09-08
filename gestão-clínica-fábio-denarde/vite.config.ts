import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { analyzeDoctoraliaFiles, recognizeDoctoraliaAppointmentsCsv, recognizeDoctoraliaPatientsCsv } from './src/features/psychology-import-export/doctoralia';
import { createMemoryPublicBookingServerStore, createPublicBookingServerHandler } from './src/features/psychology-online-booking/publicServerRepository';

// Keep the local preview aligned with the R2B2A validation snapshot; this is not persisted or used by production code.
const DOCTORALIA_PREVIEW_REFERENCE_NOW = '2026-08-14T21:45:00.000Z';

function doctoraliaPreviewPlugin() {
  return {
    name: 'doctoralia-local-preview',
    configureServer(server: { middlewares: { use: (route: string, handler: (request: any, response: any, next: () => void) => void) => void } }) {
      server.middlewares.use('/api/psychology-doctoralia-preview', (request, response, next) => {
        const host = String(request.headers?.host || '').split(':')[0].replace(/^\[/, '').replace(/\]$/, '');
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Prévia Doctoralia disponível somente no ambiente local.' }));
          return;
        }
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET');
          response.end(JSON.stringify({ error: 'Método não permitido.' }));
          return;
        }
        try {
          const roots = [path.resolve('D:/Downloads'), path.resolve(process.env.USERPROFILE || '', 'Downloads')];
          const findFile = (fileName: string, recognize: (input: { source: 'doctoralia'; fileName: string; text: string }) => boolean) => roots
            .flatMap(root => fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()).map(entry => path.join(root, entry.name)) : [])
            .map(fullName => ({ fullName, modified: fs.statSync(fullName).mtimeMs }))
            .sort((a, b) => b.modified - a.modified)
            .map(item => ({ ...item, text: fs.readFileSync(item.fullName, 'utf8') }))
            .find(item => recognize({ source: 'doctoralia', fileName, text: item.text }));
          const patients = findFile('patients.csv', recognizeDoctoraliaPatientsCsv);
          const appointments = findFile('patients_appointments.csv', recognizeDoctoraliaAppointmentsCsv);
          if (!patients || !appointments) {
            response.statusCode = 404;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ error: 'Os dois CSVs Doctoralia não foram encontrados ou reconhecidos.' }));
            return;
          }
          const analysis = analyzeDoctoraliaFiles({
            patients: { source: 'doctoralia', fileName: 'patients.csv', text: patients.text },
            appointments: { source: 'doctoralia', fileName: 'patients_appointments.csv', text: appointments.text },
            now: DOCTORALIA_PREVIEW_REFERENCE_NOW,
          });
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ cutoff: analysis.cutoff, timezone: analysis.timezone, dryRun: analysis.dryRun }));
        } catch {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: 'Não foi possível carregar a prévia Doctoralia local.' }));
        }
      });
      server.middlewares.use('/api/psychology-local-backup', (request, response) => {
        const host = String(request.headers?.host || '').split(':')[0].replace(/^\[/, '').replace(/\]$/, '');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Backup local disponível somente no ambiente local.' }));
          return;
        }
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.setHeader('Allow', 'POST');
          response.end(JSON.stringify({ error: 'Método não permitido.' }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 20 * 1024 * 1024) chunks.push(chunk); });
        request.on('end', () => {
          try {
            if (size > 20 * 1024 * 1024) throw new Error('Backup excede o limite local.');
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { source?: string; store?: Record<string, unknown> };
            if (payload.source !== 'local-before-synthetic-test-cleanup' || !payload.store || typeof payload.store !== 'object') throw new Error('Payload de backup inválido.');
            const downloads = path.resolve('D:/Downloads');
            fs.mkdirSync(downloads, { recursive: true });
            const timestamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
            const fileName = `BACKUP-ANTES-LIMPEZA-PACIENTES-TESTE-PSICOLOGIA-${timestamp}.json`;
            const content = JSON.stringify(payload, null, 2);
            fs.writeFileSync(path.join(downloads, fileName), content, 'utf8');
            response.statusCode = 200;
            response.end(JSON.stringify({ fileName, sha256: createHash('sha256').update(content).digest('hex'), patientCount: Array.isArray(payload.store.patients) ? payload.store.patients.length : 0, sessionCount: Array.isArray(payload.store.sessions) ? payload.store.sessions.length : 0, recordCount: Array.isArray(payload.store.sessionRecords) ? payload.store.sessionRecords.length : 0 }));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'Não foi possível criar o backup local.' }));
          }
        });
      });
      server.middlewares.use('/consulta', (request, response, next) => {
        const originalSetHeader = response.setHeader.bind(response);
        response.setHeader = ((name: string, value: unknown) => {
          if (name.toLocaleLowerCase() === 'cache-control') return originalSetHeader(name, 'no-store');
          return originalSetHeader(name, value);
        }) as typeof response.setHeader;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
      });
      server.middlewares.use('/maps', (request, response, next) => {
        const originalSetHeader = response.setHeader.bind(response);
        response.setHeader = ((name: string, value: unknown) => {
          if (name.toLocaleLowerCase() === 'cache-control') return originalSetHeader(name, 'no-store');
          return originalSetHeader(name, value);
        }) as typeof response.setHeader;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
      });
    },
  };
}

function localPublicBookingBffPlugin() {
  const store = createMemoryPublicBookingServerStore();
  const handler = createPublicBookingServerHandler({ store, allowSettingsWrite: true });
  return {
    name: 'psychology-public-booking-bff-local',
    configureServer(server: { middlewares: { use: (route: string, handler: (request: any, response: any, next?: () => void) => void) => void } }) {
      server.middlewares.use('/api/public-booking', (request, response) => {
        const host = String(request.headers?.host || '').split(':')[0].replace(/^\[/, '').replace(/\]$/, '');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Robots-Tag', 'noindex, nofollow');
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: { code: 'public-booking/local-only', message: 'Persistência pública local disponível somente neste ambiente.' } }));
          return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', async () => {
          try {
            const url = new URL(request.url || '/', 'http://localhost');
            const query: Record<string, string | undefined> = {};
            url.searchParams.forEach((value, key) => { query[key] = value; });
            const bodyText = Buffer.concat(chunks).toString('utf8');
            const body = bodyText ? JSON.parse(bodyText) : undefined;
            const result = await handler({ method: request.method || 'GET', query, body });
            response.statusCode = result.status;
            response.end(JSON.stringify(result.body));
          } catch {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: { code: 'public-booking/internal-error', message: 'Não foi possível processar esta solicitação pública.' } }));
          }
        });
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    plugins: [doctoraliaPreviewPlugin(), localPublicBookingBffPlugin(), react(), tailwindcss()],
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
        '/api/activity-records': {
          target: `http://127.0.0.1:${env.DRIVE_API_PORT || '3002'}`,
          changeOrigin: true,
        },
        '/api/activity-upload-chunk': {
          target: `http://127.0.0.1:${env.DRIVE_API_PORT || '3002'}`,
          changeOrigin: true,
        },
        '/api/access': {
          target: `http://127.0.0.1:${env.DRIVE_API_PORT || '3002'}`,
          changeOrigin: true,
        },
        '/api/psychology': {
          target: `http://127.0.0.1:${env.DRIVE_API_PORT || '3002'}`,
          changeOrigin: true,
        },
        '/api/google-photos-albums': {
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
