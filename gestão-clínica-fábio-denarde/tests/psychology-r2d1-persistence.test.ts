import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPsychologyCollectionPath,
  buildPsychologyDocumentPath,
  buildPsychologyMigrationPlan,
  canonicalPsychologyStorageKey,
  createFirestorePsychologyRepositories,
  createMemoryPsychologyRepositories,
  createMemoryStorage,
  createPsychologyMemoryState,
  createPsychologyPersistenceProvider,
  createPsychologyPersistenceScope,
  createLocalPsychologyRepositories,
  legacyPsychologyStorageKey,
  type FirestorePsychologyEmulatorClient,
  type PsychologyAttachmentRecord,
  type PsychologyChargeRecord,
  type PsychologyClinicalSessionRecord,
  type PsychologyDocumentRecord,
  type PsychologyExpenseRecord,
  type PsychologyLocationRecord,
  type PsychologyPatientRecord,
  type PsychologyPaymentRecord,
  type PsychologyPackageRecord,
  type PsychologyPersonalAppointmentRecord,
  type PsychologyServiceRecord,
  type PsychologySessionRecordEntity,
  type PsychologySettingsRecord,
} from '../src/features/psychology-persistence';
import {
  createEmptyPsychologyStore,
  serializePsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
} from '../src/features/psychology-pilot/psychologyDomain';

const scopeA = createPsychologyPersistenceScope('professional-a', 'workspace-test');
const scopeB = createPsychologyPersistenceScope('professional-b', 'workspace-test');
const legacyScopeA = createPsychologyScope(scopeA.professionalId);
const now = '2026-08-14T12:00:00.000Z';

const base = (scope: typeof scopeA, id: string) => ({
  id,
  workspaceId: scope.workspaceId,
  professionalId: scope.professionalId,
  context: scope.context,
  createdAt: now,
  updatedAt: now,
});

function patient(scope = scopeA, id = 'patient-a'): PsychologyPatientRecord {
  return { ...base(scope, id), name: `Paciente ${id}`, birthDate: '1990-01-01', phone: '27999990000', email: 'synthetic@example.test', preferredModality: 'online', administrativeNote: 'administrativo', active: true };
}

function session(scope = scopeA, id = 'session-a'): PsychologySessionRecordEntity {
  return { ...base(scope, id), patientId: 'patient-a', date: '2026-08-14', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada' };
}

function clinicalRecord(scope = scopeA, id = 'record-a'): PsychologyClinicalSessionRecord {
  return { ...base(scope, id), patientId: 'patient-a', sessionId: 'session-a', sessionDate: '2026-08-14', sessionTime: '09:00', date: '2026-08-14', authorProfessionalId: scope.professionalId, content: 'CONTEUDO_CLINICO_SINTETICO' };
}

function personal(scope = scopeA, id = 'personal-a'): PsychologyPersonalAppointmentRecord {
  return { ...base(scope, id), date: '2026-08-14', time: '12:00', durationMinutes: 30, type: 'Outro', note: 'compromisso sintético', recurrence: 'Não repetir', alarmEnabled: true, alarmAdvance: '15 min', isDone: false };
}

function service(scope = scopeA, id = 'service-a'): PsychologyServiceRecord {
  return { ...base(scope, id), name: 'Serviço sintético', defaultDurationMinutes: 50, defaultPrice: 150, modality: 'BOTH', active: true };
}

function location(scope = scopeA, id = 'location-a'): PsychologyLocationRecord {
  return { ...base(scope, id), type: 'PRIMARY_OFFICE', displayName: 'Local sintético', address: '', active: true, isPrimary: true, color: '#DC2626' };
}

function charge(scope = scopeA, id = 'charge-a'): PsychologyChargeRecord {
  return { ...base(scope, id), patientId: 'patient-a', description: 'Cobrança sintética', amount: 150, status: 'pending' };
}

function payment(scope = scopeA, id = 'payment-a'): PsychologyPaymentRecord {
  return { ...base(scope, id), chargeId: 'charge-a', patientId: 'patient-a', amount: 150, date: '2026-08-14', method: 'PIX', status: 'active', operationKey: 'op-payment-a' };
}

function expense(scope = scopeA, id = 'expense-a'): PsychologyExpenseRecord {
  return { ...base(scope, id), description: 'Despesa sintética', amount: 20, date: '2026-08-14', category: 'Tecnologia', status: 'REALIZED' };
}

function documentRecord(scope = scopeA, classification: 'ADMINISTRATIVE' | 'CLINICAL' = 'ADMINISTRATIVE', id = 'document-a'): PsychologyDocumentRecord {
  return { ...base(scope, id), patientId: 'patient-a', category: 'documento', classification, filename: 'sintetico.pdf', mimeType: 'application/pdf', size: 10 };
}

function attachment(scope = scopeA, classification: 'ADMINISTRATIVE' | 'CLINICAL' = 'ADMINISTRATIVE', id = 'attachment-a'): PsychologyAttachmentRecord {
  return { ...base(scope, id), patientId: 'patient-a', classification, filename: 'anexo.pdf', mimeType: 'application/pdf', size: 10, documentId: 'document-a' };
}

test('R2D1 01 — namespace possui workspace, profissional e contexto explícitos', () => {
  assert.equal(buildPsychologyCollectionPath(scopeA, 'patients'), 'workspaces/workspace-test/professionals/professional-a/contexts/PSICOLOGIA/patients');
  assert.equal(buildPsychologyDocumentPath(scopeA, 'patients', 'patient-a').endsWith('/patient-a'), true);
});

test('R2D1 02 — IDs com barra e escopo inválido falham fechado', () => {
  assert.throws(() => buildPsychologyDocumentPath(scopeA, 'patients', 'a/b'));
  assert.throws(() => createPsychologyPersistenceProvider({ scope: { ...scopeA, context: 'NEUROPSICOPEDAGOGIA' } as never, backend: 'memory' }));
});

test('R2D1 03 — Patient é criado e lido no próprio scope', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.patients.upsert(scopeA, patient());
  assert.equal((await repositories.patients.get(scopeA, 'patient-a'))?.name, 'Paciente patient-a');
});

test('R2D1 04 — profissional B não lê Patient de A', async () => {
  const state = createPsychologyMemoryState();
  const a = createMemoryPsychologyRepositories(scopeA, { state });
  const b = createMemoryPsychologyRepositories(scopeB, { state });
  await a.patients.upsert(scopeA, patient());
  assert.equal((await b.patients.list(scopeB)).length, 0);
  assert.equal(await b.patients.get(scopeB, 'patient-a'), null);
});

test('R2D1 05 — gravação cruzada e update de escopo falham', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await assert.rejects(() => repositories.patients.upsert(scopeA, patient(scopeB, 'foreign')));
  await repositories.patients.upsert(scopeA, patient());
  await assert.rejects(() => repositories.patients.update(scopeA, 'patient-a', { professionalId: scopeB.professionalId }));
});

test('R2D1 06 — externalReferences e paciente inativo permanecem recuperáveis', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  const value = { ...patient(), externalReferences: [{ source: 'import-sintetico', externalId: 'source-1' }], active: false };
  await repositories.patients.upsert(scopeA, value);
  assert.deepEqual((await repositories.patients.get(scopeA, 'patient-a'))?.externalReferences, value.externalReferences);
  assert.equal((await repositories.patients.list(scopeA)).length, 1);
});

test('R2D1 07 — Session administrativa preserva patient, local, serviço e não aceita content clínico', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.sessions.upsert(scopeA, { ...session(), locationId: 'location-a', serviceId: 'service-a' });
  const saved = await repositories.sessions.get(scopeA, 'session-a');
  assert.equal(saved?.patientId, 'patient-a');
  assert.equal(saved?.locationId, 'location-a');
  assert.equal(saved?.serviceId, 'service-a');
  await assert.rejects(() => repositories.sessions.upsert(scopeA, { ...session(), content: 'não permitido' } as never));
});

test('R2D1 08 — Session Record clínico fica em repository separado', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.sessionRecords.upsert(scopeA, clinicalRecord());
  assert.equal((await repositories.sessions.list(scopeA)).length, 0);
  assert.equal((await repositories.sessionRecords.list(scopeA))[0].content, 'CONTEUDO_CLINICO_SINTETICO');
});

test('R2D1 09 — registro clínico de B não aparece para A', async () => {
  const state = createPsychologyMemoryState();
  const a = createMemoryPsychologyRepositories(scopeA, { state });
  const b = createMemoryPsychologyRepositories(scopeB, { state });
  await b.sessionRecords.upsert(scopeB, clinicalRecord(scopeB, 'record-b'));
  assert.equal((await a.sessionRecords.list(scopeA)).length, 0);
});

test('R2D1 10 — agenda pessoal não exige patientId e preserva recorrência/alarmes', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.personalAppointments.upsert(scopeA, personal());
  const saved = await repositories.personalAppointments.get(scopeA, 'personal-a');
  assert.equal('patientId' in (saved || {}), false);
  assert.equal(saved?.recurrence, 'Não repetir');
  assert.equal(saved?.alarmAdvance, '15 min');
  assert.equal((await repositories.sessions.list(scopeA)).length, 0);
});

test('R2D1 11 — financeiro mantém Charge, Payment e Expense separados', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.financial.upsertCharge(scopeA, charge());
  await repositories.financial.createPayment(scopeA, payment());
  await repositories.financial.upsertExpense(scopeA, expense());
  assert.equal((await repositories.financial.listCharges(scopeA)).length, 1);
  assert.equal((await repositories.financial.listPayments(scopeA))[0].amount, 150);
  assert.equal((await repositories.financial.listExpenses(scopeA))[0].amount, 20);
});

test('R2D1 12 — operationKey torna dupla submissão idempotente', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  const first = await repositories.financial.createPayment(scopeA, payment());
  const second = await repositories.financial.createPayment(scopeA, { ...payment(), id: 'payment-duplicate' });
  assert.equal(first.id, second.id);
  assert.equal((await repositories.financial.listPayments(scopeA)).length, 1);
});

test('R2D1 13 — cancelamento e estorno são atualizações lógicas, não delete físico', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.financial.upsertCharge(scopeA, charge());
  await repositories.financial.createPayment(scopeA, payment());
  await repositories.financial.updateCharge(scopeA, 'charge-a', { status: 'cancelled', cancelledAt: now, cancellationReason: 'teste' });
  await repositories.financial.updatePayment(scopeA, 'payment-a', { status: 'voided', reversedAt: now, reversalReason: 'teste' });
  assert.equal((await repositories.financial.getCharge(scopeA, 'charge-a'))?.cancellationReason, 'teste');
  assert.equal((await repositories.financial.getPayment(scopeA, 'payment-a'))?.status, 'voided');
});

test('R2D1 14 — serviços e locais são agregados escopados e rename mantém id', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.services.upsert(scopeA, service());
  await repositories.locations.upsert(scopeA, location());
  await repositories.locations.update(scopeA, 'location-a', { displayName: 'Local renomeado' });
  assert.equal((await repositories.services.list(scopeA)).length, 1);
  assert.equal((await repositories.locations.get(scopeA, 'location-a'))?.displayName, 'Local renomeado');
});

test('R2D1 15 — documentos administrativos não carregam clínica por consulta administrativa', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.documents.upsert(scopeA, documentRecord(scopeA, 'ADMINISTRATIVE', 'doc-admin'));
  await repositories.documents.upsert(scopeA, documentRecord(scopeA, 'CLINICAL', 'doc-clinical'));
  assert.deepEqual((await repositories.documents.listAdministrative(scopeA)).map(item => item.id), ['doc-admin']);
  assert.deepEqual((await repositories.documents.listClinical(scopeA)).map(item => item.id), ['doc-clinical']);
});

test('R2D1 16 — attachments são metadata e não aceitam binário', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  await repositories.attachments.upsert(scopeA, attachment());
  await assert.rejects(() => repositories.attachments.upsert(scopeA, { ...attachment(scopeA, 'CLINICAL', 'binary'), data: 'base64' } as never));
  assert.equal((await repositories.attachments.listAdministrative(scopeA)).length, 1);
});

test('R2D1 17 — Provider memory é explícito e produção falha fechado', () => {
  const provider = createPsychologyPersistenceProvider({ scope: scopeA, backend: 'memory' });
  assert.equal(provider.backend, 'memory');
  assert.equal(provider.productionEnabled, false);
  assert.throws(() => createPsychologyPersistenceProvider({ scope: scopeA, backend: 'production' }));
  assert.throws(() => createPsychologyPersistenceProvider({ scope: scopeA, backend: 'firebase' }));
});

test('R2D1 18 — Provider local preserva fallback legado e não apaga a chave antiga', async () => {
  let legacyStore = createEmptyPsychologyStore(legacyScopeA);
  legacyStore = upsertPsychologyPatient(legacyStore, { name: 'Paciente legado sintético', birthDate: '', phone: '', email: '', preferredModality: 'online', administrativeNote: '', active: true }, 'legacy-patient', now);
  const storage = createMemoryStorage({ [legacyPsychologyStorageKey(scopeA)]: serializePsychologyStore(legacyStore) });
  const legacyBefore = storage.values[legacyPsychologyStorageKey(scopeA)];
  const repositories = createLocalPsychologyRepositories({ scope: scopeA, storage, now: () => now });
  assert.equal((await repositories.patients.list(scopeA)).length, 1);
  await repositories.patients.upsert(scopeA, patient());
  assert.equal(storage.values[legacyPsychologyStorageKey(scopeA)], legacyBefore);
  assert.ok(storage.values[canonicalPsychologyStorageKey(scopeA)]);
  assert.equal((await repositories.patients.list(scopeA)).length, 2);
});

class FakeEmulatorClient implements FirestorePsychologyEmulatorClient {
  readonly data = new Map<string, unknown>();
  async list<T>(collectionPath: string): Promise<readonly T[]> { return [...this.data.entries()].filter(([path]) => path.startsWith(`${collectionPath}/`)).map(([, value]) => value as T); }
  async get<T>(documentPath: string): Promise<T | null> { return (this.data.get(documentPath) as T | undefined) || null; }
  async upsert<T>(documentPath: string, value: T): Promise<T> { this.data.set(documentPath, value); return value; }
  async update<T>(documentPath: string, patch: Partial<T>): Promise<T | null> { const current = await this.get<T>(documentPath); if (!current) return null; const next = { ...current, ...patch } as T; this.data.set(documentPath, next); return next; }
}

test('R2D1 19 — adapter Firestore funciona somente com client explícito de emulator', async () => {
  const client = new FakeEmulatorClient();
  const repositories = createFirestorePsychologyRepositories({ mode: 'emulator', scope: scopeA, client });
  await repositories.patients.upsert(scopeA, patient());
  assert.equal((await repositories.patients.get(scopeA, 'patient-a'))?.id, 'patient-a');
  assert.throws(() => createFirestorePsychologyRepositories({ mode: 'emulator', scope: scopeA }));
  assert.throws(() => createFirestorePsychologyRepositories({ mode: 'production', scope: scopeA } as never));
});

test('R2D1 20 — adapter emulator não permite leitura cruzada', async () => {
  const client = new FakeEmulatorClient();
  const a = createFirestorePsychologyRepositories({ mode: 'emulator', scope: scopeA, client });
  const b = createFirestorePsychologyRepositories({ mode: 'emulator', scope: scopeB, client });
  await a.patients.upsert(scopeA, patient());
  assert.equal((await b.patients.list(scopeB)).length, 0);
});

test('R2D1 20A — Package e Settings também possuem repository e escopo próprios', async () => {
  const repositories = createMemoryPsychologyRepositories(scopeA);
  const packageRecord: PsychologyPackageRecord = { ...base(scopeA, 'package-a'), patientId: 'patient-a', name: 'Pacote sintético', totalSessions: 4, usedSessions: 0, startDate: '2026-08-14', active: true };
  const settingsRecord: PsychologySettingsRecord = { ...base(scopeA, 'settings'), id: 'settings', settings: createEmptyPsychologyStore(legacyScopeA).settings };
  await repositories.packages.upsert(scopeA, packageRecord);
  await repositories.settings.upsert(scopeA, settingsRecord);
  assert.equal((await repositories.packages.get(scopeA, 'package-a'))?.totalSessions, 4);
  assert.equal((await repositories.settings.get(scopeA, 'settings'))?.settings.scope.professionalId, scopeA.professionalId);
});

test('R2D1 21 — migration plan identifica scope ausente, referência quebrada e duplicidade sem escrever', () => {
  const source = {
    schemaVersion: 2,
    patients: [patient(), patient(scopeA, 'patient-a')],
    sessions: [{ ...session(), id: 'session-broken', patientId: 'patient-missing' }],
    sessionRecords: [], personalCommitments: [], services: [], locations: [], charges: [], payments: [], expenses: [], sessionPackages: [], documents: [], attachments: [],
  };
  const plan = buildPsychologyMigrationPlan(source, scopeA);
  assert.equal(plan.writesPerformed, false);
  assert.equal(plan.requiresBackup, true);
  assert.equal(plan.totals.patients, 2);
  assert.ok(plan.conflicts.some(item => item.includes('ID duplicado')));
  assert.ok(plan.conflicts.some(item => item.includes('patient-missing')));
});

test('R2D1 22 — migration plan é determinístico e marca pré-condição de backup/rollback', () => {
  const source = { schemaVersion: 2, patients: [{ id: 'p', professionalId: scopeA.professionalId, context: scopeA.context, createdAt: now, updatedAt: now }] };
  const first = buildPsychologyMigrationPlan(source, scopeA);
  const second = buildPsychologyMigrationPlan(source, scopeA);
  assert.deepEqual(first, second);
  assert.ok(first.actions.includes('would-create-backup-before-real-migration'));
  assert.match(first.rollbackPlan, /R2B1/);
});

test('R2D1 23 — dados com profissional ausente são inválidos, não normalizados por nome', () => {
  const plan = buildPsychologyMigrationPlan({ patients: [{ id: 'p', name: 'Nome sem escopo' }] }, scopeA);
  assert.equal(plan.invalidRecords[0].reason, 'professionalId ausente');
});

test('R2D1 24 — escopo Neuro não pode ser criado como repository Psicologia', () => {
  const neuro = { workspaceId: scopeA.workspaceId, professionalId: scopeA.professionalId, context: 'NEUROPSICOPEDAGOGIA' } as never;
  assert.throws(() => createMemoryPsychologyRepositories(neuro));
});
