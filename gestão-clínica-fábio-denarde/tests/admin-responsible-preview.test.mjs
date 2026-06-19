import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  patients: new URL('../src/components/Patients.tsx', import.meta.url),
  portal: new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url),
  accessApi: new URL('../src/lib/accessApi.ts', import.meta.url),
  accessServer: new URL('../api/access.js', import.meta.url),
  activityServer: new URL('../api/activity-records.js', import.meta.url),
};

async function source(file) {
  return readFile(file, 'utf8');
}

test('botão administrativo abre o portal do atendente sem trocar a autenticação', async () => {
  const patients = await source(files.patients);
  assert.match(patients, /auth\.currentUser\?\.email\?\.trim\(\)\.toLowerCase\(\) === 'fdenarde@gmail\.com'/);
  assert.match(patients, /setAdminPortalPreviewPatientId\(patient\.id\)/);
  assert.match(patients, /<ResponsiblePortal[\s\S]*adminPreview=\{\{/);
  assert.match(patients, /Voltar para Administração|onBack/);
});

test('portal administrativo é identificado como somente leitura e bloqueia ações da família', async () => {
  const portal = await source(files.portal);
  assert.match(portal, /Visualização administrativa/);
  assert.match(portal, /Somente leitura/);
  assert.match(portal, /if \(isAdminPreview\) return;/);
  assert.match(portal, /!isAdminPreview && profileEditOpen/);
  assert.match(portal, /Interações desativadas/);
  assert.match(portal, /novos comentários não podem ser enviados/);
  assert.match(portal, /getAdminResponsiblePortalData/);
});

test('backend exige o administrador principal e não grava acesso como responsável', async () => {
  const accessServer = await source(files.accessServer);
  const start = accessServer.indexOf('async function getAdminResponsiblePortalData');
  const end = accessServer.indexOf('function patientPhotoFileId', start);
  assert.ok(start >= 0 && end > start, 'Função de prévia administrativa não localizada.');
  const previewFunction = accessServer.slice(start, end);
  assert.match(previewFunction, /requirePrimaryAdmin\(decodedToken\)/);
  assert.match(previewFunction, /responsibleOptions/);
  assert.doesNotMatch(previewFunction, /portalNotifications/);
  assert.match(accessServer, /mode === 'adminResponsiblePreview'/);
  assert.match(accessServer, /getAdminResponsiblePatientPhotoUrl/);
});

test('mídias compartilhadas usam uma ação administrativa exclusiva', async () => {
  const accessApi = await source(files.accessApi);
  const activityServer = await source(files.activityServer);
  assert.match(accessApi, /getAdminResponsiblePreviewFileUrl/);
  assert.match(activityServer, /body\.action === 'getAdminResponsiblePreviewFileUrl'/);
  assert.match(activityServer, /PRIMARY_ADMIN_EMAIL/);
  assert.match(activityServer, /canShareActivityWithGuardian/);
});
