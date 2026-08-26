import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { validatePsychologyPatientProfile } from '../src/features/psychology-pilot/psychologyDomain';
import { profileCompleteness } from '../src/lib/psychologyPatientAdministrative';

const pilotSource = readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/psychology.js', import.meta.url), 'utf8');
const deletionSource = readFileSync(new URL('../src/features/psychology-pilot/psychologyPatientDeletion.ts', import.meta.url), 'utf8');

class SyntheticDb {
  records = new Map<string, Record<string, unknown>>();
  collection(path: string) {
    return {
      doc: (id: string) => ({
        get: async () => {
          const value = this.records.get(`${path}/${id}`);
          return { exists: Boolean(value), id, data: () => value };
        },
        set: async (value: Record<string, unknown>) => { this.records.set(`${path}/${id}`, structuredClone(value)); },
        delete: async () => { this.records.delete(`${path}/${id}`); },
      }),
      get: async () => ({ docs: [] }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    };
  }
}

const syntheticScope = {
  workspaceId: 'workspace-r31-synthetic',
  tenantId: 'workspace-r31-synthetic',
  professionalId: 'professional-r31-synthetic',
  context: 'PSICOLOGIA',
  role: 'professional',
  authUid: 'auth-r31-synthetic',
  permissions: ['patients.create', 'patients.edit', 'patients.delete'],
};

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() { return this; },
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
}

test('R31 campos mínimos aceitam nascimento, e-mail e responsável vazios', () => {
  assert.deepEqual(validatePsychologyPatientProfile({
    name: 'Paciente sintético',
    dateOfBirth: '',
    phone: '27999990000',
    email: '',
    preferredModality: 'presencial',
    administrativeNote: '',
    active: true,
    administrativeResponsible: { fullName: '', relationship: '', phone: '', email: '' },
  }), {});
  assert.deepEqual(profileCompleteness({
    name: 'Menor sintético',
    dateOfBirth: '2018-05-10',
    phone: '27999990001',
    email: '',
    administrativeResponsible: undefined,
  }, '2026-08-25'), {
    complete: true,
    missingFields: [],
    requiresResponsible: false,
  });
});

test('R31 asteriscos ficam somente nos três campos obrigatórios do diálogo ativo', () => {
  const dialog = pilotSource.slice(pilotSource.indexOf('function PatientDialogR2F3E'), pilotSource.indexOf('function PatientDialog('));
  assert.match(dialog, /Nome completo \*/);
  assert.match(dialog, /Telefone \*/);
  assert.match(dialog, /Modalidade preferencial \*/);
  assert.doesNotMatch(dialog, /Data de nascimento \*/);
  assert.doesNotMatch(dialog, /E-mail \*/);
  assert.doesNotMatch(dialog, /responsável\*|parentesco\*|responsável[^<]*\*/i);
});

test('R31 API exige somente nome, telefone e modalidade', () => {
  assert.match(apiSource, /if \(birthDate && !\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/u\.test\(birthDate\)\)/);
  assert.match(apiSource, /if \(!name \|\| !phone \|\| !\['presencial', 'online'\]\.includes\(preferredModality\)\)/);
  assert.doesNotMatch(apiSource, /if \(!name \|\| !birthDate \|\| !phone/);
});

test('R31 API grava campos opcionais vazios e preserva responsável em edição parcial', async () => {
  const db = new SyntheticDb();
  const handler = createPsychologyApiHandler({
    getDb: () => db,
    now: () => '2026-08-25T12:00:00.000Z',
    resolveAccess: async () => syntheticScope,
    auditLogger: () => undefined,
  });
  const createResponse = responseCapture();
  await handler({ method: 'POST', url: '/api/psychology?path=patients', query: { path: 'patients' }, headers: { authorization: 'Bearer synthetic' }, body: {
    id: 'patient-r31-optional',
    name: 'Menor sintético',
    phone: '27999990002',
    preferredModality: 'presencial',
    birthDate: '',
    email: '',
    administrativeResponsible: undefined,
  } }, createResponse);
  assert.equal(createResponse.statusCode, 201);
  const created = (createResponse.body as { patient: Record<string, unknown> }).patient;
  assert.equal(created.birthDate, undefined);
  assert.equal(created.email, '');
  assert.equal(created.administrativeResponsible, undefined);

  const seedPath = 'workspaces/workspace-r31-synthetic/professionals/professional-r31-synthetic/contexts/PSICOLOGIA/patients/patient-r31-optional';
  db.records.set(seedPath, {
    ...created,
    administrativeResponsible: { fullName: 'Responsável sintético', relationship: 'Mãe', phone: '27999990003', email: 'responsavel@example.test' },
  });
  const patchResponse = responseCapture();
  await handler({ method: 'PATCH', url: '/api/psychology?path=patients/patient-r31-optional', query: { path: 'patients/patient-r31-optional' }, headers: { authorization: 'Bearer synthetic' }, body: {
    name: 'Menor sintético editado',
    phone: '27999990002',
    preferredModality: 'online',
  } }, patchResponse);
  assert.equal(patchResponse.statusCode, 200);
  assert.equal((patchResponse.body as { patient: { administrativeResponsible?: { fullName?: string } } }).patient.administrativeResponsible?.fullName, 'Responsável sintético');
});

test('R31 exclusão não contém inativação, arquivamento ou preservação financeira', () => {
  assert.doesNotMatch(deletionSource, /active\s*[:=]\s*false|inativ|arquiv|preserv/i);
  assert.doesNotMatch(pilotSource.slice(pilotSource.indexOf('function DeletePatientDialog')), /Pagamentos já realizados serão preservados/);
});
