import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { resolvePsychologyAdminMonitoringContext } from '../api/_lib/psychologyAccess.js';

const root = resolve(process.cwd());
const scope = {
  authUid: 'admin-synthetic',
  workspaceId: 'workspace-synthetic',
  tenantId: 'workspace-synthetic',
  professionalId: 'professional-psychology-synthetic',
  context: 'PSICOLOGIA',
  role: 'admin',
  permissions: ['monitoring.panel.view'],
  bindingMode: 'LEGACY_ONE_TO_ONE',
};

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) };
}

function createSyntheticDb(seed = {}) {
  const values = new Map(Object.entries(seed));
  const pathsRead = [];
  const collection = path => {
    const readValues = () => [...values.entries()]
      .filter(([key]) => key.startsWith(`${path}/`))
      .map(([key, value]) => ({ id: key.slice(path.length + 1), value }));
    const getSnapshot = entries => ({ docs: entries.map(item => snapshot(item.id, item.value)) });
    const query = (predicate = () => true) => ({
      async get() {
        pathsRead.push(path);
        return getSnapshot(readValues().filter(item => predicate(item.value)));
      },
      count() {
        return { async get() { return { data: () => ({ count: readValues().filter(item => predicate(item.value)).length }) }; } };
      },
    });
    return {
      where(field, operator, expected) {
        assert.equal(operator, '==');
        return query(value => value?.[field] === expected);
      },
      ...query(),
      doc(id) {
        return {
          async get() {
            pathsRead.push(`${path}/${id}`);
            return snapshot(id, values.get(`${path}/${id}`));
          },
        };
      },
    };
  };
  const db = {
    collection,
    doc(path) {
      const slash = path.lastIndexOf('/');
      return collection(path.slice(0, slash)).doc(path.slice(slash + 1));
    },
    pathsRead,
  };
  return db;
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

const psychologyPrefix = 'workspaces/workspace-synthetic/professionals/professional-psychology-synthetic/contexts/PSICOLOGIA';
const seed = {
  'professionalContexts/link-psychology': { professionalId: scope.professionalId, tenantId: scope.tenantId, context: 'PSICOLOGIA', active: true },
  [`${psychologyPrefix}/settings/settings`]: {
    settings: { professionalProfile: { displayName: 'Profissional Sintética', phone: '+5527999903553' } },
    updatedAt: '2026-08-24T12:00:00.000Z',
  },
  [`${psychologyPrefix}/patients/p1`]: { id: 'p1', inReview: true, clinicalNote: 'SEGREDO CLÍNICO NÃO DEVE SAIR' },
  [`${psychologyPrefix}/patients/p2`]: { id: 'p2', inReview: false, clinicalNote: 'OUTRO SEGREDO' },
  [`${psychologyPrefix}/sessions/s1`]: { id: 's1', patientId: 'p1' },
  [`${psychologyPrefix}/services/s1`]: { id: 's1', active: true },
  [`${psychologyPrefix}/locations/l1`]: { id: 'l1', active: true },
  [`${psychologyPrefix}/packages/pkg1`]: { id: 'pkg1' },
  [`${psychologyPrefix}/personalAppointments/a1`]: { id: 'a1' },
  [`${psychologyPrefix}/documents/d1`]: { id: 'd1', content: 'CLINICAL DOCUMENT CONTENT' },
  [`${psychologyPrefix}/attachments/a1`]: { id: 'a1', content: 'CLINICAL ATTACHMENT CONTENT' },
  'workspaces/workspace-synthetic/tenants/workspace-synthetic/professionals/professional-psychology-synthetic/contexts/PSICOLOGIA/publicBooking/state': { settings: { active: true } },
};

test('R12 — Lembretes é ocultado sem remover o contrato e Backup recebe nome funcional', async () => {
  const pilot = await fs.readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
  const domain = await fs.readFile(resolve(root, 'src/features/psychology-pilot/psychologyR2a.ts'), 'utf8');
  const backup = await fs.readFile(resolve(root, 'src/features/psychology-import-export/PsychologyImportExport.tsx'), 'utf8');
  assert.doesNotMatch(pilot, /Preparar lembretes|<h3[^>]*>Lembretes<\/h3>/);
  assert.match(domain, /reminders: PsychologyReminderSettings/);
  assert.match(backup, /Backup dos meus dados/);
  assert.match(backup, /Gerar backup/);
  assert.doesNotMatch(backup, /<button[^>]*>[^<]*(Restaurar|Restore)/i);
});
test('R12 — rota administrativa entrega somente agregados escopados e mascara telefone', async () => {
  const db = createSyntheticDb(seed);
  const auditEvents = [];
  const handler = createPsychologyApiHandler({
    getDb: () => db,
    resolveAdminMonitoring: async () => scope,
    auditLogger: event => auditEvents.push(event),
    now: () => '2026-08-24T12:01:00.000Z',
  });
  const result = response();
  await handler({ method: 'GET', url: '/api/psychology/monitoring?professionalId=professional-psychology-synthetic', query: { professionalId: scope.professionalId }, headers: { authorization: 'Bearer synthetic' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.scope.context, 'PSICOLOGIA');
  assert.equal(result.body.scope.professionalId, scope.professionalId);
  assert.equal(result.body.counts.patients, 2);
  assert.equal(result.body.counts.patientsInReview, 1);
  assert.equal(result.body.environment.professionalPhone, '(27) *****-3553');
  assert.equal(result.body.clinicalContent.loaded, false);
  assert.doesNotMatch(JSON.stringify(result.body), /SEGREDO|CLINICAL DOCUMENT|CLINICAL ATTACHMENT|NÃO DEVE SAIR/i);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actorRole, 'admin');
  assert.equal(auditEvents[0].operation, 'admin-operational-monitoring:read');
  assert.doesNotMatch(JSON.stringify(auditEvents[0]), /SEGREDO|token|secret|content/i);
  assert.ok(!db.pathsRead.some(path => path.includes('/sessionRecords')));
});

test('R12 — somente admin com permissão operacional resolve o ambiente, sem vínculo pessoal e sem Neuro', async () => {
  const db = createSyntheticDb({
    'professionalContexts/psychology': { professionalId: 'professional-psychology-synthetic', tenantId: 'workspace-synthetic', context: 'PSICOLOGIA', active: true },
    'professionalContexts/neuro': { professionalId: 'professional-neuro-synthetic', tenantId: 'workspace-synthetic', context: 'NEUROPSICOPEDAGOGIA', active: true },
  });
  const adminContext = await resolvePsychologyAdminMonitoringContext(
    { url: '/api/psychology/monitoring?professionalId=professional-psychology-synthetic', query: { professionalId: 'professional-psychology-synthetic' } },
    { db, resolveBaseAccessContext: async () => ({ userId: 'admin-synthetic', workspaceId: 'workspace-synthetic', role: 'admin', permissions: { 'monitoring.panel.view': true }, actorName: 'Admin Sintético' }) },
  );
  assert.equal(adminContext.role, 'admin');
  assert.equal(adminContext.professionalId, 'professional-psychology-synthetic');
  assert.equal(adminContext.context, 'PSICOLOGIA');
  await assert.rejects(
    () => resolvePsychologyAdminMonitoringContext(
      { url: '/api/psychology/monitoring?professionalId=professional-psychology-synthetic', query: { professionalId: 'professional-psychology-synthetic' } },
      { db, resolveBaseAccessContext: async () => ({ userId: 'professional-synthetic', workspaceId: 'workspace-synthetic', role: 'professional', permissions: { 'monitoring.panel.view': true } }) },
    ),
    error => error.code === 'psychology/monitoring-admin-required',
  );
});

test('R12 — frontend mantém o painel administrativo separado e backend não usa listener/N+1 clínico', async () => {
  const app = await fs.readFile(resolve(root, 'src/App.tsx'), 'utf8');
  const api = await fs.readFile(resolve(root, 'api/psychology.js'), 'utf8');
  const component = await fs.readFile(resolve(root, 'src/components/PsychologyOperationalMonitoringPanel.tsx'), 'utf8');
  assert.match(app, /accessProfile\?\.role === 'admin'[\s\S]*psicologia-monitoramento/);
  assert.match(app, /activeTab === 'psicologia-monitoramento' && accessProfile\?\.role === 'admin'/);
  assert.match(component, /firstAccessRef/);
  assert.match(component, /não consulta prontuários/);
  const start = api.indexOf('async function getPsychologyOperationalMonitoringData');
  const end = api.indexOf('function sendError', start);
  const monitoringSource = api.slice(start, end);
  assert.doesNotMatch(monitoringSource, /sessionRecords|onSnapshot|for \(const patient/);
});
