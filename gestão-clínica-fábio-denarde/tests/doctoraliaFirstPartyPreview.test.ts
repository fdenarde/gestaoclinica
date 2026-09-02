import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  classifyDoctoraliaPreview,
  classifyDoctoraliaService,
  normalizeDoctoraliaPatientName,
  parseDoctoraliaPreviewInput,
  type DoctoraliaPreviewEvent,
  type DoctoraliaReadOnlySnapshot,
} from '../src/features/psychology-import-export/doctoraliaFirstPartyPreview';

const patient = (id: string, name: string, externalId?: string) => ({
  id,
  name,
  active: true,
  externalReferences: externalId ? [{ source: 'DOCTORALIA', externalId }] : undefined,
});

const event = (overrides: Partial<DoctoraliaPreviewEvent> = {}): DoctoraliaPreviewEvent => ({
  id: 'fixture-event',
  date: '2026-09-02',
  startTime: '15:30',
  endTime: '16:20',
  patientName: 'Paciente Fictício Exato',
  serviceName: 'Consulta psicológica do adolescente',
  ...overrides,
});

const snapshot = (overrides: Partial<DoctoraliaReadOnlySnapshot> = {}): DoctoraliaReadOnlySnapshot => ({
  patients: [patient('p-1', 'Paciente Fictício Exato')],
  sessions: [],
  ...overrides,
});

test('matches exact patient by Doctoralia external reference before name', () => {
  const result = classifyDoctoraliaPreview([event({ patientName: 'Nome divergente', externalPatientReference: 'doc-42' })], snapshot({ patients: [patient('p-42', 'Outro Nome', 'doc-42')] }));
  assert.equal(result.rows[0].patientMatch, 'MATCH_EXACT');
  assert.equal(result.rows[0].matchedPatientId, 'p-42');
});

test('matches normalized name across accents, case and spaces', () => {
  const result = classifyDoctoraliaPreview([event({ patientName: '  PACIENTE   FICTÍCIO  EXATO ' })], snapshot());
  assert.equal(result.rows[0].patientMatch, 'MATCH_EXACT');
  assert.equal(normalizeDoctoraliaPatientName('Nome\u200B com  acento'), 'nome com acento');
});

test('removes an email appended to a Doctoralia title before comparing the patient', () => {
  const result = classifyDoctoraliaPreview([event({ patientName: 'Paciente Fictício Exato <fixture@example.test>' })], snapshot());
  assert.equal(result.rows[0].patientMatch, 'MATCH_EXACT');
});

test('returns not found without creating a patient', () => {
  const patients = [patient('p-1', 'Paciente Fictício Exato')];
  const result = classifyDoctoraliaPreview([event({ patientName: 'Pessoa Nova Fictícia' })], { patients, sessions: [] });
  assert.equal(result.rows[0].patientMatch, 'PATIENT_NOT_FOUND');
  assert.equal(result.rows[0].finalState, 'PATIENT_NOT_FOUND');
  assert.equal(patients.length, 1);
});

test('returns probable review for a unique close administrative name', () => {
  const result = classifyDoctoraliaPreview([event({ patientName: 'Paciente Fictício' })], snapshot({ patients: [patient('p-1', 'Paciente Fictício Exato')] }));
  assert.equal(result.rows[0].patientMatch, 'MATCH_PROBABLE_REVIEW');
  assert.equal(result.rows[0].finalState, 'PATIENT_REVIEW');
});

test('returns conflict when normalized identity is not unique', () => {
  const result = classifyDoctoraliaPreview([event()], snapshot({ patients: [patient('p-1', event().patientName), patient('p-2', event().patientName)] }));
  assert.equal(result.rows[0].patientMatch, 'CONFLICT');
  assert.equal(result.rows[0].finalState, 'PATIENT_REVIEW');
});

test('detects an equivalent existing session and remains idempotent', () => {
  const source = snapshot({ sessions: [{ id: 's-1', patientId: 'p-1', date: '2026-09-02', time: '15:30', durationMinutes: 50, status: 'agendada' }] });
  const first = classifyDoctoraliaPreview([event()], source);
  const second = classifyDoctoraliaPreview([event()], source);
  assert.equal(first.rows[0].sessionState, 'ALREADY_EXISTS');
  assert.equal(first.rows[0].finalState, 'ALREADY_EXISTS');
  assert.deepEqual(first, second);
});

test('detects a temporal conflict with a loaded session', () => {
  const result = classifyDoctoraliaPreview([event()], snapshot({ sessions: [{ id: 's-conflict', patientId: 'other', date: '2026-09-02', time: '16:00', durationMinutes: 40, status: 'agendada' }] }));
  assert.equal(result.rows[0].sessionState, 'SCHEDULE_CONFLICT');
  assert.equal(result.rows[0].finalState, 'SCHEDULE_CONFLICT');
});

test('does not treat a cancelled loaded session as a temporal conflict', () => {
  const result = classifyDoctoraliaPreview([event()], snapshot({ sessions: [{ id: 's-cancelled', patientId: 'other', date: '2026-09-02', time: '16:00', durationMinutes: 40, status: 'cancelada' }] }));
  assert.equal(result.rows[0].sessionState, 'NOT_FOUND');
});

test('maps the two adolescent labels to the canonical service', () => {
  assert.deepEqual(classifyDoctoraliaService('Consulta psicológica do adolescente'), { state: 'SERVICE_MATCHED', serviceId: 'psychotherapy-adolescent' });
  assert.deepEqual(classifyDoctoraliaService('Psicoterapia adolescente'), { state: 'SERVICE_MATCHED', serviceId: 'psychotherapy-adolescent' });
});

test('maps the explicit eneagram label to the canonical service', () => {
  assert.deepEqual(classifyDoctoraliaService('Teste de eneagrama presencial - tgp'), { state: 'SERVICE_MATCHED', serviceId: 'eneagram-test' });
});

test('keeps Acompanhamento terapêutico for service review', () => {
  const result = classifyDoctoraliaPreview([event({ serviceName: 'Acompanhamento terapêutico (at)' })], snapshot());
  assert.equal(result.rows[0].serviceState, 'SERVICE_REVIEW');
  assert.equal(result.rows[0].finalState, 'SERVICE_REVIEW');
});

test('confirms only explicit presence and reviews absent modality', () => {
  const confirmed = classifyDoctoraliaPreview([event({ modality: 'PRESENCIAL' })], snapshot());
  const review = classifyDoctoraliaPreview([event()], snapshot());
  assert.equal(confirmed.rows[0].modalityState, 'MODALITY_CONFIRMED');
  assert.equal(review.rows[0].modalityState, 'MODALITY_REVIEW');
});

test('opens the ready gate only when patient, session, service and modality are resolved', () => {
  const ready = classifyDoctoraliaPreview([event({ modality: 'PRESENCIAL' })], snapshot());
  const blockedByModality = classifyDoctoraliaPreview([event()], snapshot());
  const blockedByService = classifyDoctoraliaPreview([event({ modality: 'PRESENCIAL', serviceName: 'Acompanhamento terapêutico (at)' })], snapshot());
  assert.equal(ready.rows[0].finalState, 'READY_TO_IMPORT');
  assert.equal(ready.importableRows.length, 1);
  assert.equal(blockedByModality.importableRows.length, 0);
  assert.equal(blockedByService.importableRows.length, 0);
});

test('cancelled event is excluded from the importable set', () => {
  const result = classifyDoctoraliaPreview([event({ modality: 'PRESENCIAL', cancelled: true })], snapshot());
  assert.equal(result.rows[0].finalState, 'CANCELLED_DO_NOT_IMPORT');
  assert.equal(result.importableRows.length, 0);
});

test('parses the transient pipe-delimited input without persistent storage', () => {
  const parsed = parseDoctoraliaPreviewInput('2026-09-02|15:30-16:20|Paciente Fictício Exato|Consulta psicológica do adolescente|PRESENCIAL');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.events[0].modality, 'PRESENCIAL');
});

test('preview source is pure and has no network, storage, or mutating transport capability', () => {
  const source = readFileSync(new URL('../src/features/psychology-import-export/doctoraliaFirstPartyPreview.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch|localStorage|sessionStorage|indexedDB|onSnapshot/iu);
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b/iu);
  assert.doesNotMatch(source, /\b(?:document|attachment|clinical)\b/iu);
});
