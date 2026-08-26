import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient.ts';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
} from '../src/features/psychology-pilot/psychologyDomain';
import { normalizePhoneForComparison } from '../shared/phoneNormalization.js';

const pilotSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');

const scope = createPsychologyScope('synthetic-professional');
const emptyInput = {
  email: '',
  administrativeResponsible: { fullName: '', relationship: '', phone: '', email: '' },
  preferredModality: 'presencial',
  administrativeNote: '',
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
          };
        },
        async get() {
          return { docs: [] };
        },
      };
    },
  };
}

test('R51 — duas tentativas sequenciais partem de estado novo e preservam os payloads', async () => {
  const inputA = { ...emptyInput, name: 'Teste', phone: '27995963233' };
  const inputB = {
    ...emptyInput,
    name: 'Testando',
    phone: '27998665642',
    dateOfBirth: '2020-01-01',
    preferredModality: 'online',
    administrativeResponsible: { fullName: 'Ane', relationship: 'Mae', phone: '27998663225', email: '' },
  };
  assert.equal(inputA.phone, '27995963233');
  assert.equal(inputB.phone, '27998665642');
  const storeA = upsertPsychologyPatient(
    createEmptyPsychologyStore(scope),
    inputA,
  );
  const storeB = upsertPsychologyPatient(
    createEmptyPsychologyStore(scope),
    inputB,
  );
  const payloads = [];
  const client = createPsychologyRemotePatientClient({
    scope,
    api: {
      getToken: async () => 'synthetic-token',
      fetchImpl: async (_url, init = {}) => {
        payloads.push(JSON.parse(init.body));
        const body = payloads.at(-1);
        return new Response(JSON.stringify({ scope, patient: body }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });

  await client.updatePatient(storeA.patients[0]);
  await client.updatePatient(storeB.patients[0]);

  assert.equal(payloads[0].name, 'Teste');
  assert.equal(normalizePhoneForComparison(payloads[0].phone), normalizePhoneForComparison(inputA.phone));
  assert.equal(payloads[0].preferredModality, 'presencial');
  assert.equal(payloads[1].name, 'Testando');
  assert.equal(normalizePhoneForComparison(payloads[1].phone), normalizePhoneForComparison(inputB.phone));
  assert.equal(payloads[1].preferredModality, 'online');
  assert.equal(payloads[1].birthDate, '2020-01-01');
  assert.equal(payloads[1].administrativeResponsible.fullName, 'Ane');
  assert.equal(
    normalizePhoneForComparison(payloads[1].administrativeResponsible.phone),
    normalizePhoneForComparison(inputB.administrativeResponsible.phone),
  );
  assert.equal(payloads[0].phone === payloads[1].phone, false);
});

test('R51 — backend preserva semanticamente os telefones A e B sem troca', async () => {
  const db = fakeDb();
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
    resolveAccess: async () => runtimeScope,
    now: () => '2026-08-26T12:00:00.000Z',
    auditLogger: () => {},
  });
  const bodies = [
    { id: 'synthetic-a', name: 'Teste', phone: '27995963233', preferredModality: 'presencial' },
    { id: 'synthetic-b', name: 'Testando', phone: '27998665642', preferredModality: 'online', birthDate: '2020-01-01', administrativeResponsible: { fullName: 'Ane', relationship: 'Mae', phone: '27998663225', email: '' } },
  ];

  const responses = [];
  for (const body of bodies) {
    const response = responseRecorder();
    await handler({ method: 'POST', url: '/api/psychology/patients', headers: { authorization: 'Bearer synthetic-token' }, body }, response);
    responses.push(response);
  }

  assert.deepEqual(responses.map(response => response.statusCode), [201, 201]);
  assert.equal(normalizePhoneForComparison(responses[0].payload.patient.phone), normalizePhoneForComparison(bodies[0].phone));
  assert.equal(normalizePhoneForComparison(responses[1].payload.patient.phone), normalizePhoneForComparison(bodies[1].phone));
  assert.equal(responses[0].payload.patient.phone === responses[1].payload.patient.phone, false);
});

test('R51 — origem dos campos do modal é o estado atual e o submit envia esse estado', () => {
  assert.match(pilotSource, /const \[form, setForm\] = useState<PsychologyPatientInput>\(\{ name: value\?\.name[\s\S]*phone: value\?\.phone/);
  assert.match(pilotSource, /onSave\(\{ \.\.\.form, dateOfBirth: String\(form\.dateOfBirth \|\| form\.birthDate \|\| ''\), birthDate: undefined \}\)/);
  assert.match(pilotSource, /remoteClient\.updatePatient\(nextPatient\)/);
  assert.match(pilotSource, /setPatientDialog\(null\)/);
  assert.match(pilotSource, /setSubmitError\(''\)/);
  assert.match(pilotSource, /setSubmitError\('Não foi possível salvar o paciente\. Nenhuma alteração foi realizada\.'\)/);
});
