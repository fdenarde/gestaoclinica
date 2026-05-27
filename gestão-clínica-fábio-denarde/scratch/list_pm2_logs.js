import fs from 'fs';
import path from 'path';
import os from 'os';

const homeDir = os.homedir();
const logDir = path.join(homeDir, '.pm2', 'logs');

if (fs.existsSync(logDir)) {
  const files = fs.readdirSync(logDir);
  console.log("PM2 Logs directory files:");
  files.forEach(f => {
    const stats = fs.statSync(path.join(logDir, f));
    console.log(`- ${f} (${stats.size} bytes)`);
  });
} else {
  console.log("PM2 Logs directory does not exist:", logDir);
}
