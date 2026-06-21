#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { maskPhoneShort } from '../src/lib/whatsappPhone.js';

const execFileAsync = promisify(execFile);

const ALLOWED_ENV_KEYS = [
  'WHATSAPP_PROCESS_ROLE',
  'WHATSAPP_SENDER_MODE',
  'WHATSAPP_SCHEDULER_MODE',
  'WHATSAPP_WATCHDOG_MODE',
];

const SECRET_PATTERN = /(secret|token|credential|password|passwd|firebase|session|auth|cookie|private|cert)/i;
const PHONE_PATTERN = /\b(?:55)?27\d{8,9}\b/g;
const MOJIBAKE_PATTERN = /[\uFFFDÃÂ├│┬┤┐└─]/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function redactText(value) {
  return String(value || '').replace(PHONE_PATTERN, match => maskPhoneShort(match));
}

export function containsLikelyMojibake(value) {
  return MOJIBAKE_PATTERN.test(String(value || ''));
}

function assertCleanPath(value, label) {
  const text = String(value || '');
  if (text && containsLikelyMojibake(text)) {
    throw new Error(`${label} contém caracteres corrompidos: ${text}`);
  }
  return text;
}

function sanitizeEnv(pm2Env = {}) {
  const source = {
    ...(pm2Env.env && typeof pm2Env.env === 'object' ? pm2Env.env : {}),
    ...pm2Env,
  };
  const sanitized = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (source[key] !== undefined && source[key] !== null) {
      sanitized[key] = String(source[key]);
    }
  }

  const adminPhone = source.WHATSAPP_ADMIN_REPORT_PHONE;
  if (adminPhone) {
    sanitized.WHATSAPP_ADMIN_REPORT_PHONE_MASKED = maskPhoneShort(adminPhone);
  }

  return sanitized;
}

export function sanitizePm2Process(processInfo = {}) {
  const pm2Env = processInfo.pm2_env || {};
  const env = sanitizeEnv(pm2Env);
  return {
    name: String(processInfo.name || ''),
    status: String(pm2Env.status || processInfo.status || ''),
    pid: processInfo.pid || null,
    restart_time: Number(pm2Env.restart_time || processInfo.restart_time || 0),
    pm_exec_path: redactText(assertCleanPath(pm2Env.pm_exec_path || processInfo.pm_exec_path || '', 'pm_exec_path')),
    pm_cwd: redactText(assertCleanPath(pm2Env.pm_cwd || processInfo.pm_cwd || '', 'pm_cwd')),
    exec_mode: String(pm2Env.exec_mode || processInfo.exec_mode || ''),
    instances: Number(pm2Env.instances || processInfo.instances || 1),
    ...env,
  };
}

export function sanitizePm2State(rawProcesses) {
  if (!Array.isArray(rawProcesses)) {
    throw new Error('pm2 jlist deve retornar um array JSON.');
  }

  const processes = rawProcesses.map(sanitizePm2Process);
  const encoded = JSON.stringify(processes);
  if (SECRET_PATTERN.test(encoded)) {
    throw new Error('Saída sanitizada contém possível segredo ou campo proibido.');
  }
  if (/\b(?:55)?27\d{8,9}\b/.test(encoded)) {
    throw new Error('Saída sanitizada contém telefone completo.');
  }
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    processes,
  };
}

export function parseAndSanitizePm2Json(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText || ''));
  } catch (error) {
    throw new Error(`JSON PM2 inválido: ${error.message}`);
  }
  return sanitizePm2State(parsed);
}

export function encodeSanitizedStateBase64(sanitizedState) {
  const json = JSON.stringify(sanitizedState);
  return Buffer.from(json, 'utf8').toString('base64');
}

export function decodeSanitizedStateBase64(encoded) {
  const text = String(encoded || '').trim();
  if (!text || !BASE64_PATTERN.test(text)) {
    throw new Error('Payload Base64 inválido.');
  }
  const json = Buffer.from(text, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export function getPm2CommandCandidates(env = process.env) {
  const candidates = [];
  if (env.PM2_COMMAND) candidates.push(env.PM2_COMMAND);
  candidates.push('pm2');
  if (process.platform === 'win32') {
    candidates.push('pm2.cmd');
    if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', 'pm2.cmd'));
    if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'pm2.cmd'));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function getPm2CliScriptCandidates(env = process.env) {
  const candidates = [];
  if (env.PM2_CLI_JS) candidates.push(env.PM2_CLI_JS);
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', 'node_modules', 'pm2', 'bin', 'pm2'));
  if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'node_modules', 'pm2', 'bin', 'pm2'));
  for (const command of getPm2CommandCandidates(env)) {
    if (/\.cmd$/i.test(command)) {
      candidates.push(path.join(path.dirname(command), 'node_modules', 'pm2', 'bin', 'pm2'));
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

function decodeUtf8Strict(buffer, sourceLabel) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${sourceLabel} não retornou UTF-8 válido. A leitura foi recusada para evitar corrupção de caminhos.`);
  }
}

async function runNodePm2Cli(cliScript) {
  const { stdout } = await execFileAsync(process.execPath, [cliScript, 'jlist'], {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 25 * 1024 * 1024,
    encoding: 'buffer',
  });
  return decodeUtf8Strict(stdout, `PM2 CLI ${cliScript}`);
}

function quoteCmdPath(value) {
  const text = String(value || '');
  if (/[&|<>^\r\n]/.test(text)) {
    throw new Error(`Caminho PM2 inseguro recusado: ${text}`);
  }
  return `"${text.replace(/"/g, '""')}"`;
}

async function runPm2JlistCommand(command) {
  const options = {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 25 * 1024 * 1024,
    encoding: 'buffer',
  };
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
    const comSpec = process.env.ComSpec || 'cmd.exe';
    const commandLine = `chcp 65001>nul & call ${quoteCmdPath(command)} jlist`;
    const { stdout } = await execFileAsync(comSpec, ['/d', '/s', '/c', commandLine], options);
    return decodeUtf8Strict(stdout, `PM2 shim ${command}`);
  }
  const { stdout } = await execFileAsync(command, ['jlist'], options);
  return decodeUtf8Strict(stdout, `PM2 comando ${command}`);
}

export async function readPm2JsonUtf8() {
  const errors = [];

  for (const cliScript of getPm2CliScriptCandidates()) {
    if (!path.isAbsolute(cliScript) || !fs.existsSync(cliScript)) continue;
    try {
      return await runNodePm2Cli(cliScript);
    } catch (error) {
      errors.push(`${cliScript}: ${error?.message || 'falha'}`);
    }
  }

  for (const command of getPm2CommandCandidates()) {
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
      errors.push(`${command}: ausente`);
      continue;
    }
    try {
      return await runPm2JlistCommand(command);
    } catch (error) {
      const diagnostic = `${error?.message || ''}\n${error?.stderr || ''}`.toLowerCase();
      if (
        error?.code === 'ENOENT' ||
        error?.code === 'EINVAL' ||
        diagnostic.includes('not recognized') ||
        diagnostic.includes('nao reconhecido') ||
        diagnostic.includes('não reconhecido')
      ) {
        errors.push(`${command}: não encontrado`);
        continue;
      }
      errors.push(`${command}: ${error?.message || 'falha'}`);
    }
  }
  throw new Error(`PM2 não pôde ser lido em UTF-8 seguro. Tentativas: ${errors.join('; ')}`);
}

async function main() {
  const fromPm2 = process.argv.includes('--from-pm2');
  const base64 = process.argv.includes('--base64');
  const jsonText = fromPm2 ? await readPm2JsonUtf8() : await readStdin();
  const sanitized = parseAndSanitizePm2Json(jsonText);
  if (base64) {
    process.stdout.write(`${encodeSanitizedStateBase64(sanitized)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`read-pm2-whatsapp-state: ${error.message}\n`);
    process.exitCode = 1;
  });
}
