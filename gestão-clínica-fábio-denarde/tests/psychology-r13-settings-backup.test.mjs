import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { requestAuthenticatedPsychologyBackup } from '../src/lib/psychologyBackupApi.ts';

const root = resolve(process.cwd());
const scope = {
  authUid: 'leila-auth',
  workspaceId: 'workspace-leila',
  tenantId: 'workspace-leila',
  professionalId: 'professional-leila',
  context: 'PSICOLOGIA',
  role: 'professional',
  permissions: ['patients.clinical_notes.view'],
  bindingMode: 'LEGACY_ONE_TO_ONE',
};
const prefix = `workspaces/${scope.workspaceId}/professionals/${scope.professionalId}/contexts/PSICOLOGIA`;

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) };
}

function createBackupDb(seed) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [
    key,
    key.startsWith(`${prefix}/`)
      ? { ...value, workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: scope.context }
      : value,
  ]));
  const writes = [];
  const collection = path => ({
    async get() {
      const docs = [...values.entries()]
        .filter(([key]) => key.startsWith(`${path}/`))
        .map(([key, value]) => snapshot(key.slice(path.length + 1), value));
      return { docs };
    },
    doc(id) {
      return {
        async get() { return snapshot(id, values.get(`${path}/${id}`)); },
        async set() { writes.push(`${path}/${id}:set`); },
        async delete() { writes.push(`${path}/${id}:delete`); },
      };
    },
  });
  return { collection, writes };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

const seed = {
  [`${prefix}/settings/settings`]: {
    settings: {
      professionalProfile: { displayName: 'Leila Chaves', phone: '(27) 99999-0000', apiKey: 'DO_NOT_EXPORT' },
      reminders: { enabled: true, advanceMinutes: 30 },
      secret: 'DO_NOT_EXPORT',
    },
    updatedAt: '2026-08-24T12:00:00.000Z',
  },
  [`${prefix}/patients/leila-patient`]: { id: 'leila-patient', name: 'Paciente da Leila', birthDate: '1990-05-10', clinicalNote: 'ADMINISTRATIVE SECRET' },
  [`${prefix}/sessions/leila-session`]: { id: 'leila-session', patientId: 'leila-patient', date: '2026-08-24', time: '09:00', durationMinutes: 50, modality: 'online' },
  [`${prefix}/sessionRecords/leila-record`]: { id: 'leila-record', patientId: 'leila-patient', content: 'REGISTRO CLÍNICO DA LEILA', authorProfessionalId: scope.professionalId },
  [`${prefix}/services/leila-service`]: { id: 'leila-service', name: 'Sessão', active: true },
  [`${prefix}/locations/leila-location`]: { id: 'leila-location', displayName: 'Consultório', active: true },
  [`${prefix}/packages/leila-package`]: { id: 'leila-package', patientId: 'leila-patient', totalSessions: 4 },
  [`${prefix}/personalAppointments/leila-personal`]: { id: 'leila-personal', title: 'Compromisso pessoal' },
  [`${prefix}/charges/leila-charge`]: { id: 'leila-charge', patientId: 'leila-patient', amount: 100 },
  [`${prefix}/payments/leila-payment`]: { id: 'leila-payment', patientId: 'leila-patient', amount: 100 },
  [`${prefix}/expenses/leila-expense`]: { id: 'leila-expense', amount: 10 },
  [`${prefix}/documents/leila-document`]: { id: 'leila-document', patientId: 'leila-patient', classification: 'CLINICAL', content: 'BINARY MUST NOT EXPORT' },
  [`${prefix}/attachments/leila-attachment`]: { id: 'leila-attachment', patientId: 'leila-patient', classification: 'CLINICAL', contentBase64: 'BINARY MUST NOT EXPORT' },
  'workspaces/workspace-other/professionals/professional-other/contexts/PSICOLOGIA/patients/other': { id: 'other', name: 'Outro profissional' },
  'workspaces/workspace-leila/professionals/professional-leila/contexts/NEUROPSICOPEDAGOGIA/patients/neuro': { id: 'neuro', name: 'Neuro' },
};

test('R13 — Ajustes expõe somente Backup dos meus dados e não expõe controles de desenvolvimento', async () => {
  const component = await fs.readFile(resolve(root, 'src/features/psychology-import-export/PsychologyImportExport.tsx'), 'utf8');
  const pilot = await fs.readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const backupApi = await fs.readFile(resolve(root, 'src/lib/psychologyBackupApi.ts'), 'utf8');
  assert.match(component, /Backup dos meus dados/);
  assert.match(component, /Gerar backup/);
  assert.match(component, /restauração não está disponível/i);
  assert.doesNotMatch(component, /Usar CSV sintético|Doctoralia|Importar dados|Verificar backup|Firestore|canonical data|psychology-local-synthetic/i);
  assert.match(pilot, /id: 'backup', label: 'Backup e dados'/);
  assert.match(pilot, /activeTab === 'backup'[\s\S]*PsychologyImportExport store=\{store\} onGenerateBackup=\{onGenerateBackup\}/);
  assert.doesNotMatch(pilot, /Preparar lembretes locais|Nenhuma mensagem externa é disparada/);
  assert.doesNotMatch(component + backupApi, /whatsapp|meta/i);
});
test('R13 — backup usa provider autenticado, ignora professionalId do cliente e mantém escopo PSICOLOGIA', async () => {
  const db = createBackupDb(seed);
  let resolverOptions;
  const handler = createPsychologyApiHandler({
    getDb: () => db,
    resolveAccess: async (_req, options) => { resolverOptions = options; return scope; },
    auditLogger: () => {},
    now: () => '2026-08-24T12:01:00.000Z',
  });
  const result = response();
  await handler({
    method: 'GET',
    url: '/api/psychology/backup?professionalId=professional-other&workspaceId=workspace-other&context=NEUROPSICOPEDAGOGIA',
    query: { professionalId: 'professional-other', workspaceId: 'workspace-other', context: 'NEUROPSICOPEDAGOGIA' },
    headers: { authorization: 'Bearer leila-token' },
  }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(resolverOptions.ignoreRequestedProfessionalId, true);
  assert.deepEqual(result.body.scope, {
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    professionalId: scope.professionalId,
    context: scope.context,
    bindingMode: scope.bindingMode,
  });
  const payload = JSON.parse(result.body.json);
  assert.equal(result.body.source, 'psychology-remote');
  assert.equal(payload.manifest.professionalId, scope.professionalId);
  assert.equal(payload.manifest.workspaceId, scope.workspaceId);
  assert.equal(payload.manifest.context, 'PSICOLOGIA');
  assert.equal(payload.manifest.source, 'psychology-remote');
  assert.equal(payload.files['patients.json'].length, 1);
  assert.equal(payload.files['patients.json'][0].id, 'leila-patient');
  assert.equal(payload.files['appointments.json'][0].id, 'leila-session');
  assert.equal(payload.files['clinical/session-records.json'][0].content, 'REGISTRO CLÍNICO DA LEILA');
  assert.equal(payload.files['financial/charges.json'][0].id, 'leila-charge');
  assert.doesNotMatch(result.body.json, /DO_NOT_EXPORT|ADMINISTRATIVE SECRET|BINARY MUST NOT EXPORT|professional-other|NEUROPSICOPEDAGOGIA/);
  assert.equal(db.writes.length, 0);
});

test('R13 — cliente solicita rota fixa sem professionalId e aceita somente confirmação remota', async () => {
  let request;
  const result = await requestAuthenticatedPsychologyBackup({
    getToken: async () => 'leila-token',
    fetchImpl: async (input, init) => {
      request = { input: String(input), init };
      return new Response(JSON.stringify({
        fileName: 'backup-psicologia-2026-08-24-1201.json',
        json: '{"manifest":{"source":"psychology-remote","context":"PSICOLOGIA"}}',
        source: 'psychology-remote',
        counts: {},
        scope: { workspaceId: 'workspace-leila', professionalId: 'professional-leila', context: 'PSICOLOGIA' },
      }), { status: 200 });
    },
  });
  assert.equal(result.source, 'psychology-remote');
  assert.equal(request.input, '/api/psychology/backup');
  assert.equal(request.init.headers.Authorization, 'Bearer leila-token');
  assert.equal(request.init.method, 'GET');
  assert.doesNotMatch(request.input, /professionalId|workspaceId|context=/);
});
