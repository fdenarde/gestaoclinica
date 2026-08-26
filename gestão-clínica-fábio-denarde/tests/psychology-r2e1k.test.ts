import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  savePsychologySessionRecord,
  upsertPsychologyPatient,
  upsertPsychologySession,
  updatePsychologySessionStatus,
  validatePsychologySession,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import { createPsychologyChargeInLedger, createPsychologyPaymentInLedger } from '../src/features/psychology-pilot/psychologyFinancialLedger';
import { deletePsychologyPatientLocally, getPsychologyPatientDeletionAssessment } from '../src/features/psychology-pilot/psychologyPatientDeletion';
import { createMemoryStorage } from '../src/features/psychology-persistence/repositories/local';
import { createLocalPublicBookingRepository } from '../src/features/psychology-online-booking/repository';
import { LOCAL_PSYCHOLOGY_PROFESSIONAL_ID, LOCAL_PSYCHOLOGY_STORAGE_KEY, parsePsychologyStore } from '../src/features/psychology-pilot/psychologyDomain';

const scope = createPsychologyScope('r2e1k-synthetic-professional');
const psychologyPilotSource = readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');

function patientStore(): PsychologyStore {
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, { name: 'Paciente R2E1K Sintético', birthDate: '1990-01-01', phone: '27999990001', email: 'r2e1k@example.test', preferredModality: 'online', administrativeNote: '', active: true }, 'patient-r2e1k', '2026-08-01T10:00:00.000Z');
  return store;
}

function sessionInput(patientId: string, date = '2026-08-19', time = '10:00') {
  return { patientId, date, time, durationMinutes: 50, modality: 'online' as const, administrativeNote: '', bookingOrigin: 'PATIENT_SELF_BOOKING' as const };
}

test('R31 exclusão definitiva remove todos os vínculos, inclusive cobranças e pagamentos', () => {
  let store = patientStore();
  store = upsertPsychologySession(store, sessionInput('patient-r2e1k'), 'session-r2e1k-a', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologySession(store, sessionInput('patient-r2e1k', '2026-08-20', '11:00'), 'session-r2e1k-b', '2026-08-01T10:00:00.000Z');
  store = savePsychologySessionRecord(store, 'session-r2e1k-a', 'Registro clínico sintético protegido.');
  store = {
    ...store,
    documents: [{ id: 'document-r2e1k', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: 'patient-r2e1k', category: 'Documento', classification: 'ADMINISTRATIVE', filename: 'sintetico.pdf', mimeType: 'application/pdf', createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' }],
    attachments: [{ id: 'attachment-r2e1k', patientId: 'patient-r2e1k', professionalId: scope.professionalId, context: 'PSICOLOGIA', sessionRecordId: 'record-r2e1k', filename: 'sintetico.txt', mimeType: 'text/plain', classification: 'CLINICAL', createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' }],
    sessionPackages: [{ id: 'package-r2e1k', patientId: 'patient-r2e1k', professionalId: scope.professionalId, context: 'PSICOLOGIA', name: 'Pacote sintético', totalSessions: 4, usedSessions: 1, startDate: '2026-08-01', active: true, createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' }],
  };
  const pending = createPsychologyChargeInLedger(store, { patientId: 'patient-r2e1k', sessionId: 'session-r2e1k-b', description: 'Cobrança pendente sintética', amount: 80 });
  store = pending.store;
  const paid = createPsychologyChargeInLedger(store, { patientId: 'patient-r2e1k', sessionId: 'session-r2e1k-a', description: 'Cobrança paga sintética', amount: 100 });
  store = paid.store;
  const paidCharge = paid.charge!;
  store = createPsychologyPaymentInLedger(store, { patientId: 'patient-r2e1k', chargeId: paidCharge.id, amount: 100, date: '2026-08-10', method: 'PIX' }).store;

  const assessment = getPsychologyPatientDeletionAssessment(store, 'patient-r2e1k');
  assert.equal(assessment?.canDelete, true);
  assert.deepEqual(assessment?.impact, { sessions: 2, records: 1, charges: 2, payments: 1, expenses: 0, packages: 1, documents: 1, attachments: 1 });
  const result = deletePsychologyPatientLocally(store, 'patient-r2e1k', '2026-08-17T12:00:00.000Z');
  assert.equal(result.removed, true);
  assert.equal(result.store.patients.some(item => item.id === 'patient-r2e1k'), false);
  assert.equal(result.store.sessions.some(item => item.patientId === 'patient-r2e1k'), false);
  assert.equal(result.store.sessionRecords.some(item => item.patientId === 'patient-r2e1k'), false);
  assert.equal(result.store.documents.some(item => item.patientId === 'patient-r2e1k'), false);
  assert.equal(result.store.attachments.some(item => item.patientId === 'patient-r2e1k'), false);
  assert.equal(result.store.sessionPackages.some(item => item.patientId === 'patient-r2e1k'), false);
  assert.equal(result.store.charges.some(item => item.id === pending.charge?.id), false);
  assert.equal(result.store.charges.some(item => item.id === paidCharge.id), false);
  assert.equal(result.store.payments.some(item => item.chargeId === paidCharge.id), false);
});

test('R2E1K exclusão sem financeiro não deixa resíduo e paciente real não depende de fingerprint', () => {
  let store = patientStore();
  store = upsertPsychologyPatient(store, { name: 'Paciente Real Fixture', birthDate: '1988-02-02', phone: '27999990002', email: 'real-fixture@example.test', preferredModality: 'presencial', administrativeNote: '', active: false, externalReferences: [{ source: 'DOCTORALIA', externalId: 'external-r2e1k' }] }, 'patient-real-fixture');
  store = upsertPsychologySession(store, { ...sessionInput('patient-real-fixture'), bookingOrigin: 'PROFESSIONAL' }, 'session-real-fixture');
  assert.equal(getPsychologyPatientDeletionAssessment(store, 'patient-real-fixture')?.canDelete, true);
  const result = deletePsychologyPatientLocally(store, 'patient-real-fixture');
  assert.equal(result.removed, true);
  assert.equal(result.store.patients.length, 1);
  assert.equal(result.store.sessions.some(item => item.id === 'session-real-fixture'), false);
});

test('R2E1K cancelada não ocupa slot, ignora a própria sessão e volta para o mesmo dia/horário', () => {
  let store = patientStore();
  store = upsertPsychologySession(store, sessionInput('patient-r2e1k'), 'session-cancelled-r2e1k', '2026-08-01T10:00:00.000Z');
  store = updatePsychologySessionStatus(store, 'session-cancelled-r2e1k', 'cancelada', '2026-08-02T10:00:00.000Z');
  const sameSlot = sessionInput('patient-r2e1k');
  assert.equal(validatePsychologySession(sameSlot, store, { ignoreSessionId: 'session-cancelled-r2e1k' }), null);
  const reopened = upsertPsychologySession(store, sameSlot, 'session-cancelled-r2e1k', '2026-08-17T12:00:00.000Z');
  const session = reopened.sessions.find(item => item.id === 'session-cancelled-r2e1k')!;
  assert.equal(session.status, 'agendada');
  assert.equal(session.id, 'session-cancelled-r2e1k');
  assert.equal(session.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(session.date, '2026-08-19');
  assert.equal(session.time, '10:00');
});

test('R2E1K outra sessão agendada continua bloqueando o slot da cancelada', () => {
  let store = patientStore();
  store = upsertPsychologySession(store, sessionInput('patient-r2e1k'), 'session-cancelled-r2e1k', '2026-08-01T10:00:00.000Z');
  store = updatePsychologySessionStatus(store, 'session-cancelled-r2e1k', 'cancelada');
  store = upsertPsychologySession(store, { ...sessionInput('patient-r2e1k'), bookingOrigin: 'PROFESSIONAL' }, 'session-other-r2e1k');
  assert.match(validatePsychologySession(sessionInput('patient-r2e1k'), store, { ignoreSessionId: 'session-cancelled-r2e1k' }) || '', /ocupado/);
});

test('R2E1K novo agendamento público grava origem do paciente e cancelamento/reagendamento preserva a origem', async () => {
  const storage = createMemoryStorage();
  const repo = createLocalPublicBookingRepository({ storage, now: () => new Date('2026-08-17T12:00:00.000Z') });
  const created = await repo.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: '2026-08-19', time: '10:00', name: 'Paciente Público R2E1K', dateOfBirth: '1990-01-01', phone: '27999990003', email: 'public-r2e1k@example.test', source: 'google' });
  assert.equal('conflict' in created, false);
  if ('conflict' in created) return;
  const firstStore = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  const createdSession = firstStore.sessions.find(item => item.id === created.appointment.sessionId)!;
  assert.equal(created.appointment.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(createdSession.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(created.appointment.source, 'google');
  const cancelled = await repo.cancelByManagementToken(created.managementToken);
  assert.equal(cancelled.ok, true);
  const cancelledStore = parsePsychologyStore(storage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  const cancelledSession = cancelledStore.sessions.find(item => item.id === created.appointment.sessionId)!;
  assert.equal(cancelledSession.status, 'cancelada');
  const rescheduledStore = upsertPsychologySession(cancelledStore, { ...sessionInput(cancelledSession.patientId, '2026-08-19', '10:00'), bookingOrigin: undefined }, cancelledSession.id, '2026-08-17T12:00:00.000Z');
  const rescheduled = rescheduledStore.sessions.find(item => item.id === cancelledSession.id)!;
  assert.equal(rescheduled.status, 'agendada');
  assert.equal(rescheduled.bookingOrigin, 'PATIENT_SELF_BOOKING');
  assert.equal(rescheduled.id, cancelledSession.id);
});

test('R2E1K interface confirma exclusão explícita e tipo de atendimento no reagendamento', () => {
  assert.match(psychologyPilotSource, /title="Excluir definitivamente\?"/);
  assert.match(psychologyPilotSource, /Esta ação é irreversível e excluirá definitivamente o paciente/);
  assert.match(psychologyPilotSource, /Field label="Tipo de atendimento"/);
  assert.doesNotMatch(psychologyPilotSource, /A exclusão definitiva é permitida somente para um fingerprint/);
  assert.doesNotMatch(psychologyPilotSource, /Excluir paciente de teste\?/);
});
