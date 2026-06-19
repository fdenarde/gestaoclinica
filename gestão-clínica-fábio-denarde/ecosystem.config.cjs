const path = require('path');

const projectRoot = __dirname;
const logDirectory = path.join(projectRoot, 'logs', 'pm2');

module.exports = {
  apps: [
    {
      name: 'RoboClinica',
      script: path.join(projectRoot, 'server.js'),
      cwd: projectRoot,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      min_uptime: '30s',
      max_restarts: 10,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      time: true,
      merge_logs: true,
      out_file: path.join(logDirectory, 'RoboClinica-out.log'),
      error_file: path.join(logDirectory, 'RoboClinica-error.log'),
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo',
        ALLOW_WHATSAPP_QR: 'NAO',
        WHATSAPP_ADMIN_MONITOR_TEST: 'NAO',
        WHATSAPP_ADMIN_MONITOR_TEST_ONLY: 'NAO'
      }
    }
  ]
};
