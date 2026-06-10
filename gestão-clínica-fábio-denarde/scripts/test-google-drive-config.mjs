import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável ausente em .env: ${name}`);
  return value;
}

async function main() {
  const clientId = requireEnv('GOOGLE_DRIVE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_DRIVE_CLIENT_SECRET');
  const refreshToken = requireEnv('GOOGLE_DRIVE_REFRESH_TOKEN');
  const rootFolderId = requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const signingSecret = requireEnv('DRIVE_FILE_SIGNING_SECRET');

  if (signingSecret.length < 48) {
    throw new Error('DRIVE_FILE_SIGNING_SECRET está curto demais. Execute novamente npm run setup:drive.');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(tokenData.error_description || tokenData.error || 'Falha ao renovar o acesso ao Google Drive.');
  }

  const folderResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootFolderId)}?fields=id,name,mimeType,trashed`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
  );
  const folder = await folderResponse.json();
  if (!folderResponse.ok) {
    throw new Error(folder?.error?.message || 'A pasta principal não está acessível.');
  }
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('O GOOGLE_DRIVE_ROOT_FOLDER_ID não aponta para uma pasta ativa.');
  }

  console.log('Google Drive configurado corretamente.');
  console.log(`Pasta privada: ${folder.name}`);
  console.log('Nenhum arquivo foi enviado ou alterado durante este teste.');
}

main().catch(error => {
  console.error(`Falha na configuração do Google Drive: ${error.message}`);
  process.exit(1);
});
