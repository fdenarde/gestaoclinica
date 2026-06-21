import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GOOGLE_PHOTOS_ALBUMS_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
  createEmptyGooglePhotosAlbum,
  getGooglePhotosCredentialPresence,
} from '../api/_lib/googlePhotosClient.js';
import { buildGooglePhotosAlbumCreationOperationId } from '../api/_lib/googlePhotosAlbumsRepository.js';

const testPlaceholder = (label) => ['placeholder', label, 'not-a-credential'].join('-');

const TEST_ENV = Object.freeze({
  GOOGLE_PHOTOS_CLIENT_ID: testPlaceholder('client-id'),
  GOOGLE_PHOTOS_CLIENT_SECRET: testPlaceholder('client-secret'),
  GOOGLE_PHOTOS_REFRESH_TOKEN: testPlaceholder('refresh-token'),
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('cliente privado preserva exatamente o título pronto e cria somente álbum vazio', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) return jsonResponse({ access_token: testPlaceholder('access-token') });
    if (url === GOOGLE_PHOTOS_ALBUMS_ENDPOINT) {
      return jsonResponse({
        id: 'google-album-id-1',
        productUrl: 'https://photos.google.com/lr/album/album-created-by-test',
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const title = 'Atividade de Intervenção - Sessão 4';
  const result = await createEmptyGooglePhotosAlbum({ title, fetchImpl, env: TEST_ENV });

  assert.deepEqual(result, {
    id: 'google-album-id-1',
    productUrl: 'https://photos.google.com/lr/album/album-created-by-test',
    title,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, GOOGLE_OAUTH_TOKEN_ENDPOINT);
  assert.equal(calls[1].url, GOOGLE_PHOTOS_ALBUMS_ENDPOINT);
  assert.deepEqual(JSON.parse(calls[1].options.body), { album: { title } });
  assert.doesNotMatch(calls[1].options.body, /mediaItem|share|participant|guardian/i);
});

test('credenciais são lidas somente como presença no backend', () => {
  assert.deepEqual(getGooglePhotosCredentialPresence(TEST_ENV), {
    clientId: true,
    clientSecret: true,
    refreshToken: true,
  });
  assert.deepEqual(getGooglePhotosCredentialPresence({}), {
    clientId: false,
    clientSecret: false,
    refreshToken: false,
  });
});

test('falha antes da criação é retryable, mas resposta externa ambígua bloqueia duplicidade', async () => {
  await assert.rejects(
    createEmptyGooglePhotosAlbum({
      title: 'Título de teste',
      env: TEST_ENV,
      fetchImpl: async () => jsonResponse({ error: 'invalid_grant' }, 400),
    }),
    error => error?.creationOutcome === 'not_created' && error?.code === 'google-photos-albums/oauth-refresh-failed',
  );

  let call = 0;
  await assert.rejects(
    createEmptyGooglePhotosAlbum({
      title: 'Título de teste',
      env: TEST_ENV,
      fetchImpl: async () => {
        call += 1;
        if (call === 1) return jsonResponse({ access_token: testPlaceholder('access-token') });
        throw new Error('conexão interrompida após envio');
      },
    }),
    error => error?.creationOutcome === 'unknown' && error?.code === 'google-photos-albums/google-create-unknown',
  );
});

test('chave de criação é determinística por atendente, pacote e grupo de sessões', () => {
  const first = buildGooglePhotosAlbumCreationOperationId({
    patientId: 'patient-1',
    packageNumber: 2,
    sessionGroupKey: 'sessions:patient-1:2026-06-21:session-a',
  });
  const repeated = buildGooglePhotosAlbumCreationOperationId({
    patientId: 'patient-1',
    packageNumber: 2,
    sessionGroupKey: 'sessions:patient-1:2026-06-21:session-a',
  });
  const different = buildGooglePhotosAlbumCreationOperationId({
    patientId: 'patient-1',
    packageNumber: 2,
    sessionGroupKey: 'sessions:patient-1:2026-06-21:session-b',
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, different);
});

test('backend exige permissão, vínculo e reserva antes de chamar o Google', () => {
  const repositorySource = fs.readFileSync(new URL('../api/_lib/googlePhotosAlbumsRepository.js', import.meta.url), 'utf8');
  const endpointSource = fs.readFileSync(new URL('../api/google-photos-albums.js', import.meta.url), 'utf8');

  assert.match(repositorySource, /assertCapability\(context, 'canCreate'\)/);
  assert.match(repositorySource, /const patient = await getPatient\(context, input\?\.patientId\)/);
  assert.match(repositorySource, /assertActivityPatientAccess\(context, patientId\)/);
  assert.match(repositorySource, /creationOperationCollection\(context\)\.doc\(operationId\)/);
  assert.match(repositorySource, /status: 'creating'/);
  assert.match(repositorySource, /operation\.status === 'creating' \|\| operation\.status === 'unknown'/);
  assert.match(repositorySource, /await db\.runTransaction/);
  assert.match(repositorySource, /externalAlbum = await createAlbum\(\{ title: normalized\.title \}\)/);
  assert.match(endpointSource, /body\.action === 'createAlbum'/);
  assert.match(endpointSource, /resolveAccessContext/);
});

test('frontend bloqueia cliques repetidos e não recebe credenciais', () => {
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const apiClientSource = fs.readFileSync(new URL('../src/lib/googlePhotosAlbumsApi.ts', import.meta.url), 'utf8');
  const allFrontendSource = `${professionalSource}\n${apiClientSource}`;

  assert.match(professionalSource, /Criar álbum no Google Fotos/);
  assert.match(professionalSource, /permissions\.canCreate/);
  assert.match(professionalSource, /creatingCardIdsRef\.current\.has\(card\.id\)/);
  assert.match(professionalSource, /disabled=\{creatingAlbum \|\| saving\}/);
  assert.match(professionalSource, /Criando álbum\.\.\./);
  assert.match(apiClientSource, /action: 'createAlbum'/);
  assert.doesNotMatch(allFrontendSource, /GOOGLE_PHOTOS_CLIENT_ID|GOOGLE_PHOTOS_CLIENT_SECRET|GOOGLE_PHOTOS_REFRESH_TOKEN/);
  assert.doesNotMatch(allFrontendSource, /photoslibrary\.googleapis\.com|oauth2\.googleapis\.com/);
});

test('implementação automática não envia mídia nem compartilha álbum', () => {
  const helperSource = fs.readFileSync(new URL('../api/_lib/googlePhotosClient.js', import.meta.url), 'utf8');
  const createRequest = helperSource.slice(helperSource.indexOf('export async function createEmptyGooglePhotosAlbum'));

  assert.match(createRequest, /JSON\.stringify\(\{ album: \{ title: normalizedTitle \} \}\)/);
  assert.doesNotMatch(createRequest, /mediaItems|batchAddMediaItems|shareInfo|sharedAlbumOptions|enrichment/i);
});


test('criação rápida fica visível no pacote e exige seleção explícita da sessão', () => {
  const source = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  assert.match(source, /Criar álbum no Google Fotos/);
  assert.match(source, /Selecione a sessão/);
  assert.match(source, /const canCreateAlbum = permissions\.canCreate \|\| permissions\.canEdit/);
  assert.match(source, /disabled=\{!quickCreateCard \|\| saving/);
  assert.match(source, /if \(quickCreateCard\) void createAlbumForCard\(quickCreateCard\)/);
  assert.match(source, /permissionsRef\.current\.canCreate \|\| permissionsRef\.current\.canEdit/);
});
