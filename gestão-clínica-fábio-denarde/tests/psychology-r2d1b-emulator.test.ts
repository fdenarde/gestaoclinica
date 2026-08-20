import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPsychologyCollectionPath,
  buildPsychologyDocumentPath,
  buildPsychologyMigrationPlan,
  checkFirebaseFirestoreEmulator,
  createFirebaseFirestoreEmulatorClient,
  createPsychologyPersistenceProvider,
  createPsychologyPersistenceScope,
  resolvePsychologyRuntimeScope,
  simulatePsychologyMigrationToEmulator,
  type FirestorePsychologyEmulatorClient,
  type PsychologyAttachmentRecord,
  type PsychologyChargeRecord,
  type PsychologyClinicalSessionRecord,
  type PsychologyDocumentRecord,
  type PsychologyExpenseRecord,
  type PsychologyLocationRecord,
  type PsychologyPackageRecord,
  type PsychologyPatientRecord,
  type PsychologyPersonalAppointmentRecord,
  type PsychologyPaymentRecord,
  type PsychologyServiceRecord,
  type PsychologySessionRecordEntity,
} from '../src/features/psychology-persistence';
import type { AccessPermissionKey } from '../src/types/access';
import type { ProfessionalId } from '../src/types/professional';

const PROJECT_ID = 'psychology-r2d1b-local';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8081;
const AUTH_BASE_URL = 'http://127.0.0.1:9099';
const TENANT_ID = 'tenant-synthetic-1';
const WORKSPACE_ID = 'workspace-synthetic-1';
const PROFESSIONAL_A = 'professional-synthetic-a';
const PROFESSIONAL_B = 'professional-synthetic-b';
const now = '2026-08-14T15:00:00.000Z';
const scopeA = createPsychologyPersistenceScope(PROFESSIONAL_A, WORKSPACE_ID);
const scopeB = createPsychologyPersistenceScope(PROFESSIONAL_B, WORKSPACE_ID);

type AuthFixture = { email: string; uid: string; idToken: string };
type Fixture = {
  clientA: FirestorePsychologyEmulatorClient;
  clientB: FirestorePsychologyEmulatorClient;
  clientAdmin: FirestorePsychologyEmulatorClient;
  clientClinical: FirestorePsychologyEmulatorClient;
  clientLimited: FirestorePsychologyEmulatorClient;
  clientNeuro: FirestorePsychologyEmulatorClient;
  repoA: ReturnType<typeof createPsychologyPersistenceProvider>['repositories'];
  repoB: ReturnType<typeof createPsychologyPersistenceProvider>['repositories'];
  repoAdmin: ReturnType<typeof createPsychologyPersistenceProvider>['repositories'];
  repoClinical: ReturnType<typeof createPsychologyPersistenceProvider>['repositories'];
  authA: AuthFixture;
  authB: AuthFixture;
  authAdmin: AuthFixture;
  authClinical: AuthFixture;
  authLimited: AuthFixture;
  authNeuro: AuthFixture;
};
let fixturePromise: Promise<Fixture> | undefined;

function base(scope: typeof scopeA, id: string) {
  return { id, workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: scope.context, createdAt: now, updatedAt: now };
}
function patient(scope = scopeA, id = 'patient-ana'): PsychologyPatientRecord {
  return { ...base(scope, id), name: 'Ana Sintética', birthDate: '1990-01-01', phone: '27999990000', email: 'ana.synthetic@example.test', preferredModality: 'online', administrativeNote: 'fixture local', active: true };
}
function session(scope = scopeA, id = 'session-ana'): PsychologySessionRecordEntity {
  return { ...base(scope, id), patientId: 'patient-ana', date: '2026-08-14', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada' };
}
function clinicalRecord(scope = scopeA, id = 'record-ana'): PsychologyClinicalSessionRecord {
  return { ...base(scope, id), patientId: 'patient-ana', sessionId: 'session-ana', sessionDate: '2026-08-14', sessionTime: '09:00', date: '2026-08-14', authorProfessionalId: scope.professionalId, content: 'REGISTRO_CLINICO_SINTETICO' };
}
function personal(scope = scopeA, id = 'personal-ana'): PsychologyPersonalAppointmentRecord {
  return { ...base(scope, id), date: '2026-08-14', time: '12:00', durationMinutes: 30, type: 'Outro', note: 'compromisso pessoal sintético', recurrence: 'Não repetir', alarmEnabled: false, alarmAdvance: '15 min', isDone: false };
}
function service(scope = scopeA, id = 'service-ana'): PsychologyServiceRecord {
  return { ...base(scope, id), name: 'Serviço sintético', defaultDurationMinutes: 50, defaultPrice: 150, modality: 'BOTH', active: true };
}
function location(scope = scopeA, id = 'location-ana'): PsychologyLocationRecord {
  return { ...base(scope, id), type: 'PRIMARY_OFFICE', displayName: 'Local sintético', address: '', active: true, isPrimary: true, color: '#DC2626' };
}
function charge(scope = scopeA, id = 'charge-ana'): PsychologyChargeRecord {
  return { ...base(scope, id), patientId: 'patient-ana', description: 'Cobrança sintética', amount: 150, status: 'pending' };
}
function payment(scope = scopeA, id = 'payment-ana'): PsychologyPaymentRecord {
  return { ...base(scope, id), chargeId: 'charge-ana', patientId: 'patient-ana', amount: 150, date: '2026-08-14', method: 'PIX', status: 'active', operationKey: 'operation-ana' };
}
function expense(scope = scopeA, id = 'expense-ana'): PsychologyExpenseRecord {
  return { ...base(scope, id), description: 'Despesa sintética', amount: 20, date: '2026-08-14', category: 'Tecnologia', status: 'REALIZED' };
}
function documentRecord(scope = scopeA, classification: 'ADMINISTRATIVE' | 'CLINICAL' = 'ADMINISTRATIVE', id = 'document-ana'): PsychologyDocumentRecord {
  return { ...base(scope, id), patientId: 'patient-ana', category: 'documento', classification, filename: 'sintetico.pdf', mimeType: 'application/pdf', size: 10 };
}
function attachment(scope = scopeA, classification: 'ADMINISTRATIVE' | 'CLINICAL' = 'ADMINISTRATIVE', id = 'attachment-ana'): PsychologyAttachmentRecord {
  return { ...base(scope, id), patientId: 'patient-ana', classification, filename: 'anexo.pdf', mimeType: 'application/pdf', size: 10, documentId: 'document-ana' };
}
function packageRecord(scope = scopeA, id = 'package-ana'): PsychologyPackageRecord {
  return { ...base(scope, id), patientId: 'patient-ana', name: 'Pacote sintético', totalSessions: 4, usedSessions: 0, startDate: '2026-08-14', active: true };
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<AuthFixture> {
  const response = await fetch(AUTH_BASE_URL + '/identitytoolkit.googleapis.com/v1/' + path + '?key=demo-r2d1b-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json() as Record<string, string>;
  if (!response.ok) throw new Error('Auth emulator ' + response.status + ': ' + JSON.stringify(payload));
  return { email: String(body.email), uid: payload.localId, idToken: payload.idToken };
}
async function createSyntheticAuthUser(label: string): Promise<AuthFixture> {
  const email = label + '@r2d1b.local';
  const password = 'R2d1b-local-password!';
  try { return await authRequest('accounts:signUp', { email, password, returnSecureToken: true }); }
  catch { return authRequest('accounts:signInWithPassword', { email, password, returnSecureToken: true }); }
}
async function seedRuntimeAccess(ownerClient: FirestorePsychologyEmulatorClient, user: AuthFixture, input: { workspaceId: string; professionalId: string; tenantId: string; context?: 'PSICOLOGIA' | 'NEUROPSICOPEDAGOGIA'; role: 'admin' | 'professional'; permissions: readonly AccessPermissionKey[] }): Promise<void> {
  const context = input.context || 'PSICOLOGIA';
  await ownerClient.upsert('accessProfiles/' + user.uid, { uid: user.uid, status: 'approved', role: input.role, workspaceId: input.workspaceId, linkedProfessionalIds: [input.professionalId], permissions: input.permissions, enabledContexts: [context] });
  await ownerClient.upsert('authProfessionalLinks/' + user.uid, { authUid: user.uid, tenantId: input.tenantId, workspaceId: input.workspaceId, professionalId: input.professionalId, context, active: true });
  await ownerClient.upsert('professionals/' + input.professionalId, { professionalId: input.professionalId, tenantId: input.tenantId, active: true });
  if (context === 'PSICOLOGIA') await ownerClient.upsert('professionalContextLinks/' + input.workspaceId + '__' + input.professionalId + '__PSICOLOGIA', { tenantId: input.tenantId, workspaceId: input.workspaceId, professionalId: input.professionalId, context, active: true });
}
async function fixture(): Promise<Fixture> {
  if (fixturePromise) return fixturePromise;
  fixturePromise = (async () => {
    await checkFirebaseFirestoreEmulator({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT });
    const ownerClient = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: 'owner' });
    const users = await Promise.all(['r2d1b-a', 'r2d1b-b', 'r2d1b-admin', 'r2d1b-clinical', 'r2d1b-limited', 'r2d1b-neuro'].map(createSyntheticAuthUser));
    const [authA, authB, authAdmin, authClinical, authLimited, authNeuro] = users;
    const administrativePermissions: AccessPermissionKey[] = ['patients.list', 'patients.create', 'patients.edit', 'agenda.own.view', 'agenda.edit', 'finance.global.view', 'finance.patient.view', 'finance.manage', 'documents.view', 'documents.upload', 'reports.view', 'settings.clinic.manage', 'consumption.view', 'consumption.manage'];
    const clinicalPermissions: AccessPermissionKey[] = ['patients.list', 'patients.create', 'patients.edit', 'agenda.own.view', 'agenda.edit', 'sessions.history.view', 'patients.clinical_notes.view', 'documents.view', 'documents.upload'];
    await Promise.all([
      seedRuntimeAccess(ownerClient, authA, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_A, tenantId: TENANT_ID, role: 'professional', permissions: administrativePermissions }),
      seedRuntimeAccess(ownerClient, authB, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_B, tenantId: TENANT_ID, role: 'professional', permissions: administrativePermissions }),
      seedRuntimeAccess(ownerClient, authAdmin, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_A, tenantId: TENANT_ID, role: 'admin', permissions: administrativePermissions }),
      seedRuntimeAccess(ownerClient, authClinical, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_A, tenantId: TENANT_ID, role: 'professional', permissions: clinicalPermissions }),
      seedRuntimeAccess(ownerClient, authLimited, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_A, tenantId: TENANT_ID, role: 'professional', permissions: ['agenda.own.view'] }),
      seedRuntimeAccess(ownerClient, authNeuro, { workspaceId: WORKSPACE_ID, professionalId: PROFESSIONAL_A, tenantId: TENANT_ID, context: 'NEUROPSICOPEDAGOGIA', role: 'professional', permissions: ['patients.list', 'patients.clinical_notes.view'] }),
    ]);
    const clientA = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authA.idToken });
    const clientB = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authB.idToken });
    const clientAdmin = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authAdmin.idToken });
    const clientClinical = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authClinical.idToken });
    const clientLimited = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authLimited.idToken });
    const clientNeuro = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: FIRESTORE_HOST, port: FIRESTORE_PORT, idToken: authNeuro.idToken });
    return {
      clientA, clientB, clientAdmin, clientClinical, clientLimited, clientNeuro,
      repoA: createPsychologyPersistenceProvider({ scope: scopeA, backend: 'emulator', emulatorClient: clientA }).repositories,
      repoB: createPsychologyPersistenceProvider({ scope: scopeB, backend: 'emulator', emulatorClient: clientB }).repositories,
      repoAdmin: createPsychologyPersistenceProvider({ scope: scopeA, backend: 'emulator', emulatorClient: clientAdmin }).repositories,
      repoClinical: createPsychologyPersistenceProvider({ scope: scopeA, backend: 'emulator', emulatorClient: clientClinical }).repositories,
      authA, authB, authAdmin, authClinical, authLimited, authNeuro,
    };
  })();
  return fixturePromise;
}
function runtimeInput(user: AuthFixture, professionalId: string, permissions: readonly AccessPermissionKey[], role: 'admin' | 'professional' = 'professional') {
  return {
    scope: createPsychologyPersistenceScope(professionalId, WORKSPACE_ID),
    tenantId: TENANT_ID,
    workspaceTenantBinding: { workspaceId: WORKSPACE_ID, tenantId: TENANT_ID },
    accessProfile: { uid: user.uid, status: 'approved' as const, role, workspaceId: WORKSPACE_ID, linkedProfessionalIds: [professionalId], effectivePermissions: Object.fromEntries(permissions.map(permission => [permission, true])) },
    professional: { professionalId: professionalId as ProfessionalId, tenantId: TENANT_ID, authUid: user.uid },
    contextLink: { tenantId: TENANT_ID, professionalId: professionalId as ProfessionalId, context: 'PSICOLOGIA' as const },
    authLink: { tenantId: TENANT_ID, professionalId: professionalId as ProfessionalId, authUid: user.uid },
  };
}

test('R2D1B 01 — Firestore e Auth emulator respondem apenas em loopback', async () => {
  const fx = await fixture();
  assert.match((fx.clientA as { baseUrl?: string }).baseUrl || '', /^http:\/\/127\.0\.0\.1:8081\//);
  await assert.rejects(() => checkFirebaseFirestoreEmulator({ projectId: PROJECT_ID, host: 'firestore.googleapis.com' }));
  assert.throws(() => createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: 'firestore.googleapis.com' }));
  assert.equal((await fetch(AUTH_BASE_URL + '/', { method: 'GET' })).ok, true);
});
test('R2D1B 02 — provider emulator é explícito e produção continua fail-closed', async () => {
  const fx = await fixture();
  assert.equal(createPsychologyPersistenceProvider({ scope: scopeA, backend: 'emulator', emulatorClient: fx.clientA }).backend, 'emulator');
  assert.throws(() => createPsychologyPersistenceProvider({ scope: scopeA, backend: 'production' }));
  assert.throws(() => createPsychologyPersistenceProvider({ scope: scopeA, backend: 'firebase' }));
  assert.throws(() => createPsychologyPersistenceProvider({ scope: scopeA, backend: 'emulator' }));
});
test('R2D1B 03 — Auth A resolve professional A e a ponte tenant/workspace é explícita', async () => {
  const fx = await fixture();
  const runtime = resolvePsychologyRuntimeScope(runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']));
  assert.equal(runtime.workspaceId, WORKSPACE_ID);
  assert.equal(runtime.tenantId, TENANT_ID);
  assert.equal(runtime.professionalId, PROFESSIONAL_A);
  assert.equal(runtime.context, 'PSICOLOGIA');
  assert.deepEqual(runtime.permissions, ['patients.list']);
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), workspaceTenantBinding: null }));
});
test('R2D1B 04 — Auth B resolve professional B e não herda o escopo A', async () => {
  const fx = await fixture();
  const runtime = resolvePsychologyRuntimeScope(runtimeInput(fx.authB, PROFESSIONAL_B, ['patients.list']));
  assert.equal(runtime.professionalId, PROFESSIONAL_B);
  assert.notEqual(runtime.authUid, fx.authA.uid);
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authB, PROFESSIONAL_A, ['patients.list']), accessProfile: { ...runtimeInput(fx.authB, PROFESSIONAL_B, ['patients.list']).accessProfile, linkedProfessionalIds: [PROFESSIONAL_B] } }));
});
test('R2D1B 05 — tenantId nunca é igualado automaticamente ao workspaceId', async () => {
  const fx = await fixture();
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), workspaceTenantBinding: null }));
  assert.notEqual(TENANT_ID, WORKSPACE_ID);
});
test('R2D1B 06 — displayName e title não influenciam professionalId/context', async () => {
  const fx = await fixture();
  const runtime = resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), presentationProfile: { displayName: 'Profissional B', professionalTitle: 'Neuropsicopedagoga' } });
  assert.equal(runtime.professionalId, PROFESSIONAL_A);
  assert.equal(runtime.context, 'PSICOLOGIA');
});
test('R2D1B 07 — vínculo ausente falha fechado', async () => {
  const fx = await fixture();
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), contextLink: null }));
});
test('R2D1B 08 — Patient A/Psicologia cria e lê no próprio scope', async () => {
  const fx = await fixture();
  await fx.repoA.patients.upsert(scopeA, patient());
  assert.equal((await fx.repoA.patients.get(scopeA, 'patient-ana'))?.name, 'Ana Sintética');
});
test('R2D1B 09 — Patient não atravessa profissional, contexto ou permissão', async () => {
  const fx = await fixture();
  const pathA = buildPsychologyDocumentPath(scopeA, 'patients', 'patient-ana');
  await assert.rejects(() => fx.clientB.get(pathA), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientNeuro.get(pathA), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientLimited.get(pathA), /Firestore emulator 403/);
  assert.equal((await fx.repoB.patients.list(scopeB)).length, 0);
});
test('R2D1B 10 — escrita com professionalId divergente é negada em repository e Rules', async () => {
  const fx = await fixture();
  await assert.rejects(() => fx.repoA.patients.upsert(scopeA, patient(scopeB, 'patient-foreign')));
  await assert.rejects(() => fx.clientA.upsert(buildPsychologyDocumentPath(scopeA, 'patients', 'patient-foreign'), patient(scopeB, 'patient-foreign')), /Firestore emulator 403/);
});
test('R2D1B 11 — Session administrativa mantém o mesmo escopo e fica separada de registro clínico', async () => {
  const fx = await fixture();
  await fx.repoA.sessions.upsert(scopeA, session());
  assert.equal((await fx.repoA.sessions.get(scopeA, 'session-ana'))?.patientId, 'patient-ana');
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'sessions', 'session-ana')), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientAdmin.get(buildPsychologyDocumentPath(scopeA, 'sessionRecords', 'record-ana')), /Firestore emulator 403/);
});
test('R2D1B 12 — SessionRecord permite clínico e bloqueia administrativo', async () => {
  const fx = await fixture();
  await fx.repoClinical.sessionRecords.upsert(scopeA, clinicalRecord());
  assert.equal((await fx.repoClinical.sessionRecords.get(scopeA, 'record-ana'))?.content, 'REGISTRO_CLINICO_SINTETICO');
  await assert.rejects(() => fx.clientAdmin.get(buildPsychologyDocumentPath(scopeA, 'sessionRecords', 'record-ana')), /Firestore emulator 403/);
});
test('R2D1B 13 — Financeiro autoriza admin com finance e nega clínico sem finance', async () => {
  const fx = await fixture();
  await fx.repoAdmin.financial.upsertCharge(scopeA, charge());
  await fx.repoAdmin.financial.createPayment(scopeA, payment());
  await fx.repoAdmin.financial.upsertExpense(scopeA, expense());
  assert.equal((await fx.repoAdmin.financial.listCharges(scopeA)).length, 1);
  await assert.rejects(() => fx.repoClinical.financial.listCharges(scopeA), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'charges', 'charge-ana')), /Firestore emulator 403/);
});
test('R2D1B 14 — administrador financeiro não recebe SessionRecord automaticamente', async () => {
  const fx = await fixture();
  await assert.rejects(() => fx.repoAdmin.sessionRecords.get(scopeA, 'record-ana'), /Firestore emulator 403/);
});
test('R2D1B 15 — documento administrativo permite e documento clínico exige permissão clínica', async () => {
  const fx = await fixture();
  await fx.repoAdmin.documents.upsert(scopeA, documentRecord(scopeA, 'ADMINISTRATIVE'));
  assert.equal((await fx.repoAdmin.documents.get(scopeA, 'document-ana'))?.classification, 'ADMINISTRATIVE');
  await assert.rejects(() => fx.repoAdmin.documents.upsert(scopeA, documentRecord(scopeA, 'CLINICAL', 'document-clinical-denied')), /Firestore emulator 403/);
  await fx.repoClinical.documents.upsert(scopeA, documentRecord(scopeA, 'CLINICAL', 'document-clinical'));
  await assert.rejects(() => fx.repoAdmin.documents.get(scopeA, 'document-clinical'), /Firestore emulator 403/);
});
test('R2D1B 16 — classification não escala privilégio e attachment não armazena binário', async () => {
  const fx = await fixture();
  await assert.rejects(() => fx.repoClinical.documents.update(scopeA, 'document-clinical', { classification: 'ADMINISTRATIVE' }), /Firestore emulator 403/);
  await assert.rejects(() => fx.repoClinical.attachments.upsert(scopeA, { ...attachment(scopeA, 'CLINICAL', 'attachment-binary'), dataUrl: 'data:application/octet-stream;base64,synthetic' } as never), /binário/);
});
test('R2D1B 17 — agenda pessoal é isolada e não vira Session', async () => {
  const fx = await fixture();
  await fx.repoA.personalAppointments.upsert(scopeA, personal());
  assert.equal(await fx.repoA.sessions.get(scopeA, 'personal-ana'), null);
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'personalAppointments', 'personal-ana')), /Firestore emulator 403/);
});
test('R2D1B 18 — services, locations e packages permanecem isolados', async () => {
  const fx = await fixture();
  await fx.repoAdmin.services.upsert(scopeA, service());
  await fx.repoAdmin.locations.upsert(scopeA, location());
  await fx.repoAdmin.packages.upsert(scopeA, packageRecord());
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'services', 'service-ana')), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'locations', 'location-ana')), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'packages', 'package-ana')), /Firestore emulator 403/);
  await fx.repoAdmin.locations.update(scopeA, 'location-ana', { displayName: 'Local renomeado' });
  assert.equal((await fx.repoAdmin.locations.get(scopeA, 'location-ana'))?.id, 'location-ana');
});
test('R2D1B 19 — Settings/Profile edita apresentação sem mudar identidade técnica', async () => {
  const fx = await fixture();
  const record = { ...base(scopeA, 'settings'), id: 'settings' as const, settings: { professionalProfile: { displayName: 'Leila Chaves Teste', professionalTitle: 'Psicóloga', professionalRegistration: '', clinicDisplayName: '', name: 'Leila Chaves Teste', specialty: 'Psicóloga', crp: '', email: '', phone: '' } } } as never;
  await fx.repoAdmin.settings.upsert(scopeA, record);
  const saved = await fx.repoAdmin.settings.get(scopeA, 'settings');
  assert.equal(saved?.professionalId, PROFESSIONAL_A);
  assert.equal(saved?.workspaceId, WORKSPACE_ID);
  assert.equal(saved?.context, 'PSICOLOGIA');
  assert.equal(saved?.settings.professionalProfile.displayName, 'Leila Chaves Teste');
  await assert.rejects(() => fx.clientB.get(buildPsychologyDocumentPath(scopeA, 'settings', 'settings')), /Firestore emulator 403/);
});
test('R2D1B 20 — A/Psicologia não acessa caminho de Neuro, outro workspace ou Professional B', async () => {
  const fx = await fixture();
  await assert.rejects(() => fx.clientA.get('workspaces/' + WORKSPACE_ID + '/professionals/' + PROFESSIONAL_A + '/contexts/NEUROPSICOPEDAGOGIA/patients/patient-ana'), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientA.get('workspaces/workspace-synthetic-2/professionals/' + PROFESSIONAL_A + '/contexts/PSICOLOGIA/patients/patient-ana'), /Firestore emulator 403/);
  await assert.rejects(() => fx.clientA.get(buildPsychologyDocumentPath(scopeB, 'patients', 'patient-ana')), /Firestore emulator 403/);
});
test('R2D1B 21 — migration dry-run valida destino emulado e mantém zero escrita', async () => {
  const fx = await fixture();
  const plan = buildPsychologyMigrationPlan({ schemaVersion: 2, patients: [patient()], sessions: [] }, scopeA);
  const before = await fx.repoA.patients.list(scopeA);
  const simulation = await simulatePsychologyMigrationToEmulator(plan, { backend: 'emulator', scope: scopeA, client: fx.clientA });
  const after = await fx.repoA.patients.list(scopeA);
  assert.equal(simulation.destination.backend, 'emulator');
  assert.equal(simulation.destination.existingPatientCount, before.length);
  assert.equal(simulation.writesPerformed, false);
  assert.equal(simulation.plannedWrites, 1);
  assert.equal(after.length, before.length);
  assert.equal(plan.requiresBackup, true);
});
test('R2D1B 22 — Auth/professional/context usam IDs opacos e não apresentação', async () => {
  const fx = await fixture();
  const runtime = resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), presentationProfile: { displayName: 'Profissional B', professionalTitle: 'Psicólogo B' } });
  assert.equal(runtime.authUid, fx.authA.uid);
  assert.equal(runtime.professionalId, PROFESSIONAL_A);
  assert.equal(runtime.context, 'PSICOLOGIA');
  assert.notEqual(runtime.professionalId, 'Profissional B');
});

test('R2D1B 23 — reports.view lê agregados administrativos, mas não SessionRecord clínico', async () => {
  const fx = await fixture();
  assert.equal((await fx.repoAdmin.patients.get(scopeA, 'patient-ana'))?.id, 'patient-ana');
  await assert.rejects(() => fx.repoAdmin.sessionRecords.get(scopeA, 'record-ana'), /Firestore emulator 403/);
});

test('R2D1B 24 — attachment clínico exige camada clínica e continua metadata-only', async () => {
  const fx = await fixture();
  await fx.repoClinical.attachments.upsert(scopeA, attachment(scopeA, 'CLINICAL', 'attachment-clinical'));
  assert.equal((await fx.repoClinical.attachments.get(scopeA, 'attachment-clinical'))?.classification, 'CLINICAL');
  await assert.rejects(() => fx.repoAdmin.attachments.get(scopeA, 'attachment-clinical'), /Firestore emulator 403/);
});

test('R2D1B 25 — workspace/tenant incompatíveis falham sem igualdade implícita', async () => {
  const fx = await fixture();
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), tenantId: 'tenant-different' }));
  assert.throws(() => resolvePsychologyRuntimeScope({ ...runtimeInput(fx.authA, PROFESSIONAL_A, ['patients.list']), workspaceTenantBinding: { workspaceId: 'workspace-different', tenantId: TENANT_ID } }));
});
