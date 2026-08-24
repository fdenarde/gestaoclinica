// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSyntheticPsychologyStore, buildPsychologyBackupJson } from '../src/features/psychology-import-export/backup';
import { selectPsychologyBackupData } from '../src/features/psychology-persistence/psychologyBackup';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  createPsychologyPersistenceScope,
  createMemoryStorage,
  createLocalPsychologyRepositories,
  createPsychologyRemotePatientClient,
} from '../src/features/psychology-persistence';
import { resolvePsychologyAgendaEventStyle } from '../src/features/psychology-pilot/psychologyR2a';
import { createPsychologyApiHandler } from '../api/psychology.js';

const root = resolve(process.cwd());
const fixedDate = '2026-08-24T01:48:00.000Z';

test('R3 Ajustes — menu ativo separa Backup e dados e mantém uma única paleta renderizada', async () => {
  const source = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const settingsView = source.slice(source.indexOf('function PsychologySettingsView'));
  assert.match(settingsView, /Backup e dados/);
  assert.match(settingsView, /onGenerateBackup/);
  assert.match(settingsView, /<PsychologyImportExport store=\{store\} onGenerateBackup=\{onGenerateBackup\} \/>/);
  const agendaPanel = settingsView.slice(settingsView.indexOf("activeTab === 'agenda'"), settingsView.indexOf("activeTab === 'online'"));
  assert.equal((agendaPanel.match(/<input type="color"/g) || []).length, 1);
  assert.match(agendaPanel, /Cor da Agenda Pessoal|Cor Agenda Pessoal|PSYCHOLOGY_CATEGORY_LABELS/);
});

test('R3 backup — JSON versionado seleciona campos permitidos e não altera o store', async () => {
  const store = createSyntheticPsychologyStore();
  const unsafe = structuredClone(store);
  unsafe.settings.apiKey = 'TOP_SECRET_API_KEY';
  unsafe.settings.professionalProfile.secret = 'TOP_SECRET_PROFILE';
  unsafe.settings.professionalProfile.env = 'production';
  unsafe.patients[0].password = 'TOP_SECRET_PASSWORD';
  unsafe.patients[0].externalReferences = [{ source: 'fixture', externalId: 'external-1', token: 'TOP_SECRET_REFERENCE' }];
  unsafe.sessions[0].sessionToken = 'TOP_SECRET_SESSION';
  unsafe.sessionRecords[0].workspaceId = 'other-workspace';
  const before = JSON.stringify(unsafe);

  const result = await buildPsychologyBackupJson(unsafe, {
    source: 'psychology-remote',
    workspaceId: 'workspace-r3-fixture',
    generatedAt: fixedDate,
  });
  const payload = JSON.parse(result.json);

  assert.equal(JSON.stringify(unsafe), before);
  assert.equal(result.source, 'psychology-remote');
  assert.match(result.fileName, /^backup-psicologia-2026-08-24-0148\.json$/);
  assert.equal(payload.manifest.version, 2);
  assert.equal(payload.manifest.generatedAt, fixedDate);
  assert.equal(payload.manifest.context, 'PSICOLOGIA');
  assert.equal(payload.manifest.workspaceId, 'workspace-r3-fixture');
  for (const path of [
    'patients.json', 'appointments.json', 'personal-appointments.json', 'services.json', 'locations.json',
    'session-packages.json', 'financial/charges.json', 'financial/payments.json', 'financial/expenses.json',
    'clinical/session-records.json', 'documents/manifest.json', 'attachments/manifest.json', 'settings.json',
  ]) assert.ok(payload.files[path], `seção ausente: ${path}`);
  assert.doesNotMatch(result.json, /TOP_SECRET|apiKey|password|sessionToken|secret|env/);
  assert.deepEqual(selectPsychologyBackupData(unsafe).patients[0].externalReferences, [{ source: 'fixture', externalId: 'external-1' }]);
});

test('R3 backup — fonte local e fonte remota são declaradas sem mistura silenciosa', async () => {
  const store = createSyntheticPsychologyStore();
  const local = await buildPsychologyBackupJson(store, { source: 'psychology-local', generatedAt: fixedDate });
  const remote = await buildPsychologyBackupJson(store, { source: 'psychology-remote', workspaceId: 'workspace-r3', generatedAt: fixedDate });
  assert.equal(JSON.parse(local.json).manifest.source, 'psychology-local');
  assert.equal(JSON.parse(remote.json).manifest.source, 'psychology-remote');
  assert.notEqual(local.source, remote.source);
});

test('R3 cores — Agenda Pessoal e sessões usam settings.colors como fonte canônica', () => {
  const store = createEmptyPsychologyStore(createPsychologyScope('professional-r3-colors'));
  const colors = { ...store.settings.colors, PERSONAL: '#123456', PRESENTIAL_PRIMARY: '#654321' };
  const personal = resolvePsychologyAgendaEventStyle({ source: 'PERSONAL_AGENDA', colors });
  const session = resolvePsychologyAgendaEventStyle({
    source: 'SESSION', colors, modality: 'presencial', location: { ...store.locations[0], color: '#FF0000' },
  });
  assert.equal(personal.baseColor, '#123456');
  assert.equal(session.baseColor, '#654321');
});

test('R3 provider local — settings persistem após reload e ficam isolados por profissional', async () => {
  const storage = createMemoryStorage();
  const scopeA = createPsychologyPersistenceScope('professional-r3-a', 'workspace-r3');
  const scopeB = createPsychologyPersistenceScope('professional-r3-b', 'workspace-r3');
  const base = createEmptyPsychologyStore(createPsychologyScope(scopeA.professionalId));
  const repositoryA = createLocalPsychologyRepositories({ scope: scopeA, storage });
  await repositoryA.settings.upsert(scopeA, {
    id: 'settings', ...scopeA,
    settings: { ...base.settings, professionalProfile: { ...base.settings.professionalProfile, displayName: 'Leila Chaves' }, colors: { ...base.settings.colors, PERSONAL: '#123456' } },
    createdAt: fixedDate,
    updatedAt: fixedDate,
  });
  const reloadedA = createLocalPsychologyRepositories({ scope: scopeA, storage });
  const savedA = await reloadedA.settings.get(scopeA, 'settings');
  const reloadedB = createLocalPsychologyRepositories({ scope: scopeB, storage });
  const savedB = await reloadedB.settings.get(scopeB, 'settings');
  assert.equal(savedA.settings.professionalProfile.displayName, 'Leila Chaves');
  assert.equal(savedA.settings.colors.PERSONAL, '#123456');
  assert.notEqual(savedB.settings.professionalProfile.displayName, 'Leila Chaves');
  assert.notEqual(savedB.settings.colors.PERSONAL, '#123456');
  assert.throws(() => createLocalPsychologyRepositories({ scope: { ...scopeA, context: 'NEUROPSICOPEDAGOGIA' }, storage }), /context|PSICOLOGIA/);
});

test('R3 provider remoto — backup consulta o escopo remoto e ajustes usam PUT sem escrita no snapshot', async () => {
  const scope = createPsychologyPersistenceScope('professional-r3-remote', 'workspace-r3');
  const base = createEmptyPsychologyStore(createPsychologyScope(scope.professionalId));
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const responseScope = { scope: { workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: scope.context } };
  const settingsRecord = { id: 'settings', ...scope, settings: base.settings, createdAt: fixedDate, updatedAt: fixedDate };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace('/api/psychology', '') || '/';
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (method === 'PUT') return new Response(JSON.stringify({ ...responseScope, settings: { ...settingsRecord, settings: { ...base.settings, ...body } } }), { status: 200 });
    if (path === '/settings') return new Response(JSON.stringify({ ...responseScope, settings: settingsRecord }), { status: 200 });
    return new Response(JSON.stringify({ ...responseScope, items: [] }), { status: 200 });
  };
  const client = createPsychologyRemotePatientClient({ scope, api: { baseUrl: '/api/psychology', fetchImpl, getToken: async () => 'fixture-token' }, now: () => fixedDate });
  const snapshot = await client.loadBackupSnapshot();
  const snapshotCalls = calls.slice();
  assert.equal(snapshot.scope.professionalId, scope.professionalId);
  assert.equal(snapshotCalls.length, 13);
  assert.equal(snapshotCalls.filter(call => call.method !== 'GET').length, 0);
  assert.deepEqual(new Set(snapshotCalls.map(call => call.path)), new Set([
    '/patients', '/sessions', '/personal-appointments', '/session-records', '/services', '/locations',
    '/charges', '/payments', '/expenses', '/packages', '/documents', '/attachments', '/settings',
  ]));
  const saved = await client.updateSettings({ colors: { ...base.settings.colors, PERSONAL: '#123456' } });
  const put = calls.find(call => call.method === 'PUT');
  assert.ok(put);
  assert.equal(put.path, '/settings');
  assert.equal(put.body.colors.PERSONAL, '#123456');
  assert.equal(saved.colors.PERSONAL, '#123456');
});

test('R3 API de settings — agenda, cores, serviços e locais persistem no registro do escopo', async () => {
  const scope = { workspaceId: 'workspace-r3-api', tenantId: 'workspace-r3-api', professionalId: 'professional-r3-api', context: 'PSICOLOGIA', authUid: 'auth-r3-api' };
  const values = new Map();
  const db = { collection: path => ({ doc: id => ({
    async get() { const value = values.get(`${path}/${id}`); return { exists: Boolean(value), id, data: () => value ? structuredClone(value) : undefined }; },
    async set(value) { values.set(`${path}/${id}`, structuredClone(value)); },
  }) }) };
  const handler = createPsychologyApiHandler({ getDb: () => db, resolveAccess: async () => ({ ...scope, role: 'professional', permissions: ['settings.clinic.manage'] }), now: () => fixedDate, auditLogger: () => {} });
  const response = () => ({ statusCode: 200, body: null, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });
  const call = async (method, body) => { const result = response(); await handler({ method, url: '/api/psychology/settings', headers: { authorization: 'Bearer fixture' }, body, query: {} }, result); return result; };
  const updated = await call('PUT', { professionalProfile: { displayName: 'Leila API' }, agenda: { defaultDurationMinutes: 60 }, colors: { PERSONAL: '#123456' }, services: [{ id: 'service-r3-api', name: 'Sessão API', defaultDurationMinutes: 60, modality: 'BOTH', active: true }], locations: [{ id: 'location-r3-api', type: 'OTHER', displayName: 'Local API', active: true, isPrimary: true }] });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.settings.settings.professionalProfile.displayName, 'Leila API');
  assert.equal(updated.body.settings.settings.agenda.defaultDurationMinutes, 60);
  assert.equal(updated.body.settings.settings.colors.PERSONAL, '#123456');
  assert.equal(updated.body.settings.settings.services[0].name, 'Sessão API');
  assert.equal(updated.body.settings.settings.locations[0].displayName, 'Local API');
  const reloaded = await call('GET');
  assert.equal(reloaded.body.settings.settings.professionalProfile.displayName, 'Leila API');
  assert.equal(reloaded.body.settings.professionalId, scope.professionalId);
});
