import 'dotenv/config';
import express from 'express';
import driveHandler from './api/drive.js';
import activityRecordsHandler from './api/activity-records.js';
import activityUploadChunkHandler from './api/activity-upload-chunk.js';
import accessHandler from './api/access.js';

const app = express();
const port = Number(process.env.DRIVE_API_PORT || 3002);

app.disable('x-powered-by');
app.all(
  '/api/activity-upload-chunk',
  express.raw({ type: 'application/octet-stream', limit: '4mb' }),
  activityUploadChunkHandler,
);
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'google-drive-api', port });
});

app.all('/api/drive', driveHandler);
app.all('/api/activity-records', activityRecordsHandler);
app.all('/api/access', accessHandler);

app.use('/api', (req, res) => {
  res.status(404).json({
    error: {
      code: 'local-api/route-not-found',
      message: `Rota local não encontrada: ${req.method} ${req.originalUrl}`,
    },
  });
});

app.use((error, _req, res, _next) => {
  console.error('[API LOCAL]', error?.stack || error?.message || error);
  if (res.headersSent) return;
  res.status(500).json({
    error: {
      code: 'local-api/internal-error',
      message: 'A API local encontrou um erro inesperado.',
    },
  });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`API privada do Google Drive disponível em http://127.0.0.1:${port}`);
});

server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[API LOCAL] A porta ${port} já está em uso. Encerre apenas o processo antigo dessa porta e tente novamente.`);
  } else {
    console.error('[API LOCAL] Não foi possível iniciar:', error?.stack || error?.message || error);
  }
  process.exitCode = 1;
});
