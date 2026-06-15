const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const apiScript = path.join(projectRoot, 'drive-api-server.js');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const apiPort = Number(process.env.DRIVE_API_PORT || 3002);
const frontendPort = Number(process.env.VITE_PORT || 3000);
const children = [];
let stopping = false;

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[${label}] Arquivo não encontrado: ${filePath}`);
  }
}

function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function requestJson(port, route) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: route,
      timeout: 1500,
      headers: { Accept: 'application/json' },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const contentType = String(response.headers['content-type'] || '');
        if (!contentType.includes('application/json')) {
          reject(new Error(`Resposta inesperada em http://127.0.0.1:${port}${route}: ${contentType || 'sem Content-Type'}`));
          return;
        }
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
        } catch {
          reject(new Error(`JSON inválido em http://127.0.0.1:${port}${route}`));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Tempo limite excedido.')));
    request.once('error', reject);
  });
}

async function waitForApi(attempts = 40) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await requestJson(apiPort, '/api/health');
      if (result.statusCode === 200 && result.body?.ok === true && result.body?.service === 'google-drive-api') {
        return;
      }
      lastError = new Error('A rota de saúde respondeu com conteúdo inesperado.');
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('A API local não respondeu.');
}

async function waitForFrontend(attempts = 40) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isPortOpen(frontendPort)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`O frontend não abriu a porta ${frontendPort}.`);
}

function startNodeScript(scriptPath, args, label) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
    windowsHide: false,
  });

  child.on('error', error => {
    if (stopping) return;
    console.error(`[${label}] Falha ao iniciar:`, error?.message || error);
    void stop(1);
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${label}] encerrou inesperadamente (${signal || code || 0}).`);
    void stop(code || 1);
  });

  children.push({ child, label });
  return child;
}

function terminateChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
      return;
    }

    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(({ child }) => terminateChild(child)));
  process.exit(code);
}

async function main() {
  assertFile(apiScript, 'Drive API');
  assertFile(viteCli, 'Vite');

  const occupied = [];
  if (await isPortOpen(apiPort)) occupied.push(apiPort);
  if (await isPortOpen(frontendPort)) occupied.push(frontendPort);
  if (occupied.length > 0) {
    throw new Error(
      `As portas ${occupied.join(' e ')} já estão em uso. Encerre apenas os servidores locais antigos antes de executar npm run dev novamente.`,
    );
  }

  console.log('Iniciando API privada do Google Drive...');
  startNodeScript(apiScript, [], 'Drive API');
  await waitForApi();
  console.log(`API local validada em http://127.0.0.1:${apiPort}/api/health`);

  console.log('Iniciando frontend local...');
  startNodeScript(
    viteCli,
    ['--port', String(frontendPort), '--host', '0.0.0.0', '--strictPort'],
    'Vite',
  );
  await waitForFrontend();
  console.log(`Frontend local validado na porta ${frontendPort}.`);
  console.log('Mantenha este terminal aberto durante todo o teste. Pressione Ctrl+C uma única vez para encerrar ambos os servidores.');
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
process.on('uncaughtException', error => {
  console.error(error?.stack || error?.message || error);
  void stop(1);
});
process.on('unhandledRejection', error => {
  console.error(error?.stack || error?.message || error);
  void stop(1);
});

main().catch(error => {
  console.error(error?.message || error);
  void stop(1);
});
