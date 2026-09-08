import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient, patientStoreWithUpdates } from '../src/features/psychology-persistence/remotePatientClient.ts';
import { createPsychologyScope } from '../src/features/psychology-pilot/psychologyDomain';

const pilotSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');

const scope = {
  ...createPsychologyScope('synthetic-professional'),
  workspaceId: 'synthetic-workspace',
  context: 'PSICOLOGIA',
};

const patient = {
  id: 'synthetic-created-patient',
  ...scope,
  name: 'Paciente Sintético',
  phone: '27999990000',
  preferredModality: 'presencial',
  active: true,
};

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function fakeSnapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function fakeDb() {
  const records = new Map();
  return {
    records,
    collection(path) {
      return {
        doc(id) {
          const key = `${path}/${id}`;
          return {
            async get() {
              return fakeSnapshot(id, records.get(key));
            },
            async set(value) {
              records.set(key, value);
            },
            async delete() {
              records.delete(key);
            },
          };
        },
        async get() {
          const prefix = `${path}/`;
          return {
            docs: [...records.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => fakeSnapshot(key.slice(prefix.length), value)),
          };
        },
      };
    },
  };
}

test('R46 — POST de paciente aceita adulto e menor com responsável parcial e retorna 201', async () => {
  const db = fakeDb();
  const permissionChecks = [];
  const runtimeScope = {
    authUid: 'synthetic-auth',
    workspaceId: 'synthetic-workspace',
    tenantId: 'synthetic-workspace',
    professionalId: 'synthetic-professional',
    context: 'PSICOLOGIA',
    role: 'professional',
    permissions: { 'patients.create': true },
    bindingMode: 'LEGACY_ONE_TO_ONE',
  };
  const handler = createPsychologyApiHandler({
    getDb: () => db,
    resolveAccess: async (_req, options) => {
      permissionChecks.push(options.requiredPermissions[0]);
      return runtimeScope;
    },
    now: () => '2026-08-26T12:00:00.000Z',
    auditLogger: () => {},
  });

  const payloads = [
    { id: 'synthetic-adult', name: 'Adulto Sintético', phone: '27999990000', preferredModality: 'presencial' },
    {
      id: 'synthetic-minor',
      name: 'Menor Sintético',
      birthDate: '2015-08-26',
      phone: '27999991111',
      preferredModality: 'online',
      administrativeResponsible: { fullName: 'Responsável Sintético', relationship: 'Mãe', phone: '', email: '' },
    },
  ];

  const responses = [];
  for (const body of payloads) {
    const response = responseRecorder();
    await handler({ method: 'POST', url: '/api/psychology/patients', headers: { authorization: 'Bearer synthetic-token' }, body }, response);
    responses.push(response);
  }

  assert.deepEqual(responses.map(response => response.statusCode), [201, 201]);
  assert.deepEqual(permissionChecks, ['patients.create', 'patients.create']);
  assert.equal(db.records.size, 2);
  assert.equal(responses[1].payload.patient.administrativeResponsible.phone, '');
  assert.equal(responses[1].payload.patient.administrativeResponsible.email, '');
});

test('R46 — retorno criado é anexado ao remoteStore sem duplicar atualizações existentes', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ path: new URL(String(url), 'http://localhost').pathname, method: init.method || 'GET' });
    return new Response(JSON.stringify({ scope, patient }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createPsychologyRemotePatientClient({ scope, api: { fetchImpl, getToken: async () => 'synthetic-token' } });
  const savedPatient = await client.updatePatient(patient);
  const initialStore = { patients: [], sessions: [], settings: {}, sessionRecords: [], personalCommitments: [], services: [], locations: [], charges: [], payments: [], expenses: [], sessionPackages: [], documents: [], attachments: [] };
  const nextStore = patientStoreWithUpdates(initialStore, [savedPatient]);
  const updatedStore = patientStoreWithUpdates(nextStore, [{ ...savedPatient, name: 'Paciente Sintético Atualizado' }]);

  assert.equal(savedPatient.id, patient.id);
  assert.deepEqual(calls, [{ path: '/api/psychology/patients', method: 'POST' }]);
  assert.equal(nextStore.patients.length, 1);
  assert.equal(updatedStore.patients.length, 1);
  assert.equal(updatedStore.patients[0].name, 'Paciente Sintético Atualizado');
});

test('R46 — submit mostra progresso, impede duplicidade e exibe falha sanitizada', () => {
  assert.match(pilotSource, /const \[isSubmitting, setIsSubmitting\] = useState\(false\)/);
  assert.match(pilotSource, /setIsSubmitting\(true\)/);
  assert.match(pilotSource, /disabled=\{isSubmitting\}/);
  assert.match(pilotSource, /Salvando\.\.\./);
  assert.match(pilotSource, /data-testid="psychology-patient-save-error"/);
  assert.match(pilotSource, /Não foi possível salvar o paciente\. Nenhuma alteração foi realizada\./);
  assert.match(pilotSource, /submitLock\.current/);
  assert.match(pilotSource, /setPatientDialog\(null\)/);
});
