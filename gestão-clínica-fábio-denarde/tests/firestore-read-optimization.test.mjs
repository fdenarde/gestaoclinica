import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('ambiente local nao duplica listeners pelo StrictMode', () => {
  const main = read('src/main.tsx');
  assert.doesNotMatch(main, /<StrictMode>/);
  assert.match(main, /render\(<App \/>\)/);
});

test('atividades pendentes usam um resumo de presenca em vez de ler todos os registros por atendente', () => {
  const loader = read('src/lib/unregisteredActivities.ts');
  assert.match(loader, /listActivityMediaPresence/);
  assert.doesNotMatch(loader, /listActivityRecords\(/);
  assert.match(loader, /mapWithConcurrency\(packageModel\.packages, 3/);
});

test('API de presenca le somente a colecao resumida e valida paciente e perfil', () => {
  const repository = read('api/_lib/activityGalleryRepository.js');
  const route = read('api/activity-records.js');
  assert.match(repository, /export async function listActivityMediaPresence/);
  const presenceSection = repository.split('export async function listActivityMediaPresence')[1]
    .split('export async function listProfessionalActivityGallery')[0];
  assert.match(presenceSection, /getSnapshotsInChunks/);
  assert.match(presenceSection, /activityUploadStatusRef/);
  assert.doesNotMatch(presenceSection, /\.collection\(`users\/\$\{context\.ownerUserId\}\/activityUploadStatus`\)/);
  assert.match(presenceSection, /storedPatientId !== requestedPatientId/);
  assert.match(presenceSection, /allowedPatientIds/);
  assert.match(route, /body\.action === 'listActivityMediaPresence'/);
});

test('atualizacoes de sessoes e galeria respeitam cache e debounce', () => {
  const app = read('src/App.tsx');
  assert.match(app, /coreCollectionsReady/);
  assert.match(app, /refreshUnregisteredActivities\(false\)/);
  assert.doesNotMatch(app, /const refresh = \(\) => \{ void refreshUnregisteredActivities\(true\); \}/);
  assert.match(app, /1200/);
});
