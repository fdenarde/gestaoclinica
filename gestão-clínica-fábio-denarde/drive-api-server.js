import 'dotenv/config';
import express from 'express';
import driveHandler from './api/drive.js';
import activityRecordsHandler from './api/activity-records.js';

const app = express();
const port = Number(process.env.DRIVE_API_PORT || 3002);

app.use(express.json({ limit: '4mb' }));
app.all('/api/drive', driveHandler);
app.all('/api/activity-records', activityRecordsHandler);
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'google-drive-api' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`API privada do Google Drive disponível em http://127.0.0.1:${port}`);
});
