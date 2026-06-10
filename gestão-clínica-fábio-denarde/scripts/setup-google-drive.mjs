import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { exec } from 'child_process';
import 'dotenv/config';

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2/callback`;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_FOLDER_NAME = 'Gestão Clínica Neuropsicopedagógica';
const ENV_PATH = path.resolve('.env');

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Variável ausente em .env: ${name}`);
    process.exit(1);
  }
  return value;
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

function updateEnvFile(values) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.trimEnd()}\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, content.replace(/^\s+/, ''), 'utf8');
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_DRIVE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!response.ok || !data.refresh_token) {
    throw new Error(data.error_description || data.error || 'O Google não retornou um refresh token. Revogue o acesso anterior e tente novamente.');
  }
  return data;
}

async function findOrCreateRootFolder(accessToken) {
  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    "appProperties has { key='category' and value='clinic-root-folder' }",
  ].join(' and ');
  const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
  searchUrl.search = new URLSearchParams({
    q: query,
    spaces: 'drive',
    fields: 'files(id,name)',
    pageSize: '10',
  }).toString();

  const searchResponse = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchResponse.json();
  if (!searchResponse.ok) {
    throw new Error(searchData?.error?.message || 'Não foi possível localizar a pasta principal no Google Drive.');
  }
  if (searchData.files?.length) return searchData.files[0];

  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: ROOT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { category: 'clinic-root-folder' },
    }),
  });

  const createData = await createResponse.json();
  if (!createResponse.ok) {
    throw new Error(createData?.error?.message || 'Não foi possível criar a pasta principal no Google Drive.');
  }
  return createData;
}

const clientId = requireEnv('GOOGLE_DRIVE_CLIENT_ID');
requireEnv('GOOGLE_DRIVE_CLIENT_SECRET');
const state = crypto.randomBytes(24).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: DRIVE_SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
  state,
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2/callback') {
    res.writeHead(404).end('Página não encontrada.');
    return;
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Estado de segurança inválido.');
    server.close();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Autorização cancelada ou código ausente.');
    server.close();
    return;
  }

  try {
    const tokenData = await exchangeCode(code);
    const folder = await findOrCreateRootFolder(tokenData.access_token);
    const signingSecret = crypto.randomBytes(48).toString('hex');

    updateEnvFile({
      GOOGLE_DRIVE_REFRESH_TOKEN: tokenData.refresh_token,
      GOOGLE_DRIVE_ROOT_FOLDER_ID: folder.id,
      DRIVE_FILE_SIGNING_SECRET: signingSecret,
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Google Drive autorizado</h1><p>A pasta da clínica foi criada e o arquivo .env foi atualizado. Você já pode fechar esta janela.</p>');
    console.log('\nGoogle Drive autorizado com sucesso.');
    console.log(`Pasta criada: ${folder.name}`);
    console.log('O arquivo .env recebeu o refresh token, o ID da pasta e o segredo de assinatura.');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Falha: ${error.message}`);
    console.error('Falha na autorização:', error.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Aguardando autorização do Google em ${REDIRECT_URI}`);
  console.log('O navegador será aberto automaticamente.');
  openBrowser(authUrl.toString());
});
