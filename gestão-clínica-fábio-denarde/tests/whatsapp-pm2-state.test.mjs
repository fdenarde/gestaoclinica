import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  containsLikelyMojibake,
  decodeSanitizedStateBase64,
  encodeSanitizedStateBase64,
  getPm2CliScriptCandidates,
  getPm2CommandCandidates,
  parseAndSanitizePm2Json,
  readPm2JsonUtf8,
  sanitizePm2State,
} from '../scripts/read-pm2-whatsapp-state.js';

const projectRoot = 'D:\\Projeto Gestão Clínica - Repositório\\gestão-clínica-fábio-denarde';

function pm2Fixture(extraEnv = {}) {
  return [{
    name: 'RoboClinica',
    pid: 24376,
    pm2_env: {
      status: 'online',
      restart_time: 0,
      pm_exec_path: `${projectRoot}\\server.js`,
      pm_cwd: projectRoot,
      exec_mode: 'fork_mode',
      instances: 1,
      env: {
        WHATSAPP_PROCESS_ROLE: 'sender',
        WHATSAPP_SENDER_MODE: 'disabled',
        WHATSAPP_ADMIN_REPORT_PHONE: '27999072659',
        FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----fake-----END PRIVATE KEY-----',
        ACCESS_TOKEN: 'token-fake',
        username: 'lowercase-user',
        USERNAME: 'uppercase-user',
        path: 'lowercase-path',
        Path: 'uppercase-path',
        TEMP: 'temp-upper',
        temp: 'temp-lower',
        ...extraEnv,
      },
    },
  }];
}

test('helper interpreta JSON com username e USERNAME sem expor ambiente completo', () => {
  const sanitized = parseAndSanitizePm2Json(JSON.stringify(pm2Fixture()));
  assert.equal(sanitized.processes[0].name, 'RoboClinica');
  assert.equal(sanitized.processes[0].WHATSAPP_PROCESS_ROLE, 'sender');
  assert.equal(sanitized.processes[0].WHATSAPP_SENDER_MODE, 'disabled');
  assert.equal(sanitized.processes[0].WHATSAPP_ADMIN_REPORT_PHONE_MASKED, '***2659');
  const encoded = JSON.stringify(sanitized);
  assert.doesNotMatch(encoded, /username|USERNAME|lowercase-user|uppercase-user/);
  assert.doesNotMatch(encoded, /27999072659|5527999072659/);
});

test('helper interpreta path e Path e preserva caminho Windows com acentos', () => {
  const sanitized = parseAndSanitizePm2Json(JSON.stringify(pm2Fixture()));
  assert.equal(sanitized.processes[0].pm_exec_path, `${projectRoot}\\server.js`);
  assert.equal(sanitized.processes[0].pm_cwd, projectRoot);
  const encoded = JSON.stringify(sanitized);
  assert.doesNotMatch(encoded, /lowercase-path|uppercase-path|temp-upper|temp-lower/);
});

test('transporte Base64 preserva UTF-8 e produz somente ASCII', () => {
  const sanitized = parseAndSanitizePm2Json(JSON.stringify(pm2Fixture()));
  const encoded = encodeSanitizedStateBase64(sanitized);
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(Buffer.from(encoded, 'ascii').toString('ascii'), encoded);
  const decoded = decodeSanitizedStateBase64(encoded);
  assert.equal(decoded.processes[0].pm_exec_path, `${projectRoot}\\server.js`);
  assert.equal(decoded.processes[0].pm_cwd, projectRoot);
});

test('helper rejeita caminhos com mojibake antes de devolvê-los ao PowerShell', () => {
  const corruptedUtf8 = pm2Fixture();
  corruptedUtf8[0].pm2_env.pm_exec_path = 'D:\\Projeto GestÃ£o ClÃ­nica - RepositÃ³rio\\server.js';
  assert.throws(() => sanitizePm2State(corruptedUtf8), /corrompidos/);

  const corruptedOem = pm2Fixture();
  corruptedOem[0].pm2_env.pm_cwd = 'D:\\Projeto Gest├úo Cl├¡nica - Reposit├│rio';
  assert.throws(() => sanitizePm2State(corruptedOem), /corrompidos/);
  assert.equal(containsLikelyMojibake(corruptedOem[0].pm2_env.pm_cwd), true);
});

test('helper reduz ambiente PM2 grande sem credenciais, tokens ou sessão WhatsApp', () => {
  const largeEnv = {};
  for (let index = 0; index < 250; index += 1) {
    largeEnv[`NOISE_${index}`] = `value-${index}`;
  }
  const sanitized = sanitizePm2State(pm2Fixture(largeEnv));
  const processInfo = sanitized.processes[0];
  assert.deepEqual(Object.keys(processInfo).sort(), [
    'WHATSAPP_ADMIN_REPORT_PHONE_MASKED',
    'WHATSAPP_PROCESS_ROLE',
    'WHATSAPP_SENDER_MODE',
    'exec_mode',
    'instances',
    'name',
    'pid',
    'pm_cwd',
    'pm_exec_path',
    'restart_time',
    'status',
  ].sort());
  const encoded = JSON.stringify(sanitized);
  assert.doesNotMatch(encoded, /PRIVATE KEY|ACCESS_TOKEN|NOISE_249|wwebjs|session|credential/i);
});

test('helper retorna erro para JSON inválido, saída não array e Base64 inválido', () => {
  assert.throws(() => parseAndSanitizePm2Json('{'), /JSON PM2 inválido/);
  assert.throws(() => parseAndSanitizePm2Json('{}'), /array JSON/);
  assert.throws(() => decodeSanitizedStateBase64('não-é-base64'), /Base64 inválido/);
});

test('helper conhece candidatos PM2 e CLI global direta no Windows', () => {
  const env = {
    PM2_COMMAND: 'C:\\Tools\\pm2.cmd',
    PM2_CLI_JS: 'C:\\Tools\\node_modules\\pm2\\bin\\pm2',
    APPDATA: 'C:\\Users\\fdena\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\fdena',
  };
  const candidates = getPm2CommandCandidates(env);
  assert.ok(candidates.includes('C:\\Tools\\pm2.cmd'));
  assert.ok(candidates.includes('pm2'));

  const cliCandidates = getPm2CliScriptCandidates(env);
  assert.ok(cliCandidates.includes('C:\\Tools\\node_modules\\pm2\\bin\\pm2'));
  assert.ok(cliCandidates.some(candidate => candidate.endsWith('node_modules\\pm2\\bin\\pm2')));
});

test('CLI por stdin devolve JSON sanitizado em Base64 e código zero', () => {
  const script = path.resolve('scripts/read-pm2-whatsapp-state.js');
  const result = spawnSync(process.execPath, [script, '--base64'], {
    input: JSON.stringify(pm2Fixture()),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = decodeSanitizedStateBase64(result.stdout.trim());
  assert.equal(output.processes[0].WHATSAPP_ADMIN_REPORT_PHONE_MASKED, '***2659');
  assert.equal(output.processes[0].pm_exec_path, `${projectRoot}\\server.js`);
  assert.doesNotMatch(result.stdout, /27999072659|PRIVATE KEY|ACCESS_TOKEN|username|USERNAME|Gestão/);
});

test('CLI retorna código diferente de zero em caso de erro', () => {
  const script = path.resolve('scripts/read-pm2-whatsapp-state.js');
  const result = spawnSync(process.execPath, [script], {
    input: '{',
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JSON PM2 inválido/);
});


test('helper exporta leitura PM2 UTF-8 reutilizável pelo watchdog', () => {
  assert.equal(typeof readPm2JsonUtf8, 'function');
});
