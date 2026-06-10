const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const apiScript = path.join(projectRoot, 'drive-api-server.js');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];
let stopping = false;

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`[${label}] Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }
}

function startNodeScript(scriptPath, args, label) {
  let child;

  try {
    child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env },
      windowsHide: false,
    });
  } catch (error) {
    console.error(`[${label}] Não foi possível iniciar o processo:`, error);
    stop(1);
    return null;
  }

  child.on('error', (error) => {
    if (stopping) return;
    console.error(`[${label}] Falha ao iniciar:`, error);
    stop(1);
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;

    if (code !== 0) {
      console.error(`[${label}] encerrou inesperadamente (${signal || code}).`);
      stop(code || 1);
      return;
    }

    console.log(`[${label}] encerrado.`);
    stop(0);
  });

  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

assertFile(apiScript, 'Drive API');
assertFile(viteCli, 'Vite');

console.log('Iniciando API privada do Google Drive e frontend local...');
startNodeScript(apiScript, [], 'Drive API');
startNodeScript(viteCli, ['--port', '3000', '--host', '0.0.0.0'], 'Vite');
