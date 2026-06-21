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
        WHATSAPP_PROCESS_ROLE: 'sender',
        WHATSAPP_SENDER_MODE: 'disabled',
        WHATSAPP_ADMIN_REPORT_PHONE: '27999072659',
        ALLOW_WHATSAPP_QR: 'NAO',
        WHATSAPP_ADMIN_MONITOR_TEST: 'NAO',
        WHATSAPP_ADMIN_MONITOR_TEST_ONLY: 'NAO'
      }
    },
    {
      name: 'RoboClinicaScheduler',
      script: path.join(projectRoot, 'scripts', 'whatsapp-reminder-scheduler.js'),
      cwd: projectRoot,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      min_uptime: '30s',
      max_restarts: 10,
      max_memory_restart: '256M',
      kill_timeout: 15000,
      time: true,
      merge_logs: true,
      out_file: path.join(logDirectory, 'RoboClinicaScheduler-out.log'),
      error_file: path.join(logDirectory, 'RoboClinicaScheduler-error.log'),
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo',
        WHATSAPP_PROCESS_ROLE: 'scheduler',
        WHATSAPP_SCHEDULER_MODE: 'disabled',
        ALLOW_WHATSAPP_QR: 'NAO'
      }
    },
    {
      name: 'RoboClinicaWatchdog',
      script: path.join(projectRoot, 'scripts', 'whatsapp-reminder-watchdog.js'),
      cwd: projectRoot,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      min_uptime: '30s',
      max_restarts: 10,
      max_memory_restart: '256M',
      kill_timeout: 15000,
      time: true,
      merge_logs: true,
      out_file: path.join(logDirectory, 'RoboClinicaWatchdog-out.log'),
      error_file: path.join(logDirectory, 'RoboClinicaWatchdog-error.log'),
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo',
        WHATSAPP_PROCESS_ROLE: 'watchdog',
        WHATSAPP_WATCHDOG_MODE: 'disabled',
        ALLOW_WHATSAPP_QR: 'NAO'
      }
    }
  ]
};
