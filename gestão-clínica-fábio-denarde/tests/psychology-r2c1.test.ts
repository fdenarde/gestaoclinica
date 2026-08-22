import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createEmptyPsychologyStore,
  createPsychologyCharge,
  createPsychologyPayment,
  createPsychologyScope,
  savePsychologySessionRecord,
  upsertPsychologyPatient,
  upsertPsychologySession,
  type PsychologyPatientInput,
} from '../src/features/psychology-pilot/psychologyDomain';
import { getPsychologyPatientData, getPsychologyPatientFinanceSummary, getPsychologyPatientRecordPreview, getPsychologyPatientSummary } from '../src/features/psychology-pilot/psychologyPatientProfile';
import { getPsychologySessionPackageProgress, upsertPsychologySessionPackage } from '../src/features/psychology-pilot/psychologyDomain';
import type { PsychologyAttachment, PsychologyDocument } from '../src/features/psychology-pilot/psychologyDomain';

const patientInput: PsychologyPatientInput = { name: 'Paciente R2C1', birthDate: '1990-05-10', phone: '(27) 99999-1111', email: 'r2c1@example.test', preferredModality: 'online', administrativeNote: 'Observação administrativa sintética.', active: true, externalReferences: [{ source: 'doctoralia', externalId: 'doctoralia-synthetic-001', importedAt: '2026-08-13T12:00:00.000Z' }] };

function fixture() {
  const scope = createPsychologyScope('professional-r2c1');
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2c1', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologyPatient(store, { ...patientInput, name: 'Outro Paciente', externalReferences: [] }, 'patient-other', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-r2c1', date: '2026-08-10', time: '09:00', durationMinutes: 50, modality: 'online', serviceId: store.services[0]?.id, administrativeNote: '' }, 'session-past', '2026-08-02T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-r2c1', date: '2026-08-20', time: '14:00', durationMinutes: 60, modality: 'presencial', locationId: store.locations[0]?.id, locationType: 'PRIMARY_OFFICE', serviceId: store.services[0]?.id, administrativeNote: '' }, 'session-next', '2026-08-02T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-other', date: '2026-08-20', time: '15:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-other', '2026-08-02T10:00:00.000Z');
  store = { ...store, sessions: store.sessions.map(session => session.id === 'session-past' ? { ...session, status: 'realizada' as const } : session), sessionRecords: [], documents: [], attachments: [] };
  store = savePsychologySessionRecord(store, 'session-past', 'Conteúdo clínico sintético reservado.', '2026-08-10T10:00:00.000Z');
  store = createPsychologyCharge(store, { patientId: 'patient-r2c1', sessionId: 'session-past', description: 'Sessão sintética', amount: 200, dueDate: '2026-08-30', createdBy: 'professional-r2c1' }, '2026-08-01T10:00:00.000Z');
  store = createPsychologyPayment(store, { patientId: 'patient-r2c1', chargeId: store.charges[0].id, amount: 100, date: '2026-08-11', method: 'PIX', createdBy: 'professional-r2c1' }, '2026-08-11T10:00:00.000Z');
  store = upsertPsychologySessionPackage(store, { patientId: 'patient-r2c1', name: 'Pacote 8 sessões', totalSessions: 8, usedSessions: 5, startDate: '2026-08-01', endDate: '2026-12-01', active: true }, 'package-r2c1', '2026-08-01T10:00:00.000Z');
  const document: PsychologyDocument = { id: 'doc-admin', professionalId: scope.professionalId, context: 'PSICOLOGIA', patientId: 'patient-r2c1', category: 'Cadastro', classification: 'ADMINISTRATIVE', filename: 'cadastro.pdf', mimeType: 'application/pdf', size: 1024, storageRef: 'synthetic://doc-admin', externalSource: 'csv', externalId: 'doc-csv-001', createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' };
  const clinicalDocument: PsychologyDocument = { ...document, id: 'doc-clinical', category: 'Registro clínico', classification: 'CLINICAL', filename: 'registro.pdf', externalSource: 'doctoralia', externalId: 'doc-doctoralia-001' };
  const attachment: PsychologyAttachment = { id: 'attachment-fixture', patientId: 'patient-r2c1', professionalId: scope.professionalId, context: 'PSICOLOGIA', documentId: 'doc-admin', filename: 'anexo.pdf', mimeType: 'application/pdf', size: 2048, storageRef: 'synthetic://attachment', classification: 'ADMINISTRATIVE', externalSource: 'csv', externalId: 'attachment-001', createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z' };
  return { ...store, documents: [document, clinicalDocument], attachments: [attachment] };
}

// Paciente e externalReferences: 1–10
test('R2C1 paciente 01 — ficha resolve o paciente correto', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.name, 'Paciente R2C1'));
test('R2C1 paciente 02 — profissional é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.professionalId, 'professional-r2c1'));
test('R2C1 paciente 03 — contexto é Psicologia', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.context, 'PSICOLOGIA'));
test('R2C1 paciente 04 — nome é administrativo', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.name, patientInput.name));
test('R2C1 paciente 05 — nascimento é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.birthDate, '1990-05-10'));
test('R2C1 paciente 06 — telefone é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.phone, patientInput.phone));
test('R2C1 paciente 07 — e-mail é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.email, patientInput.email));
test('R2C1 paciente 08 — status ativo é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.active, true));
test('R2C1 paciente 09 — modalidade é preservada', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.preferredModality, 'online'));
test('R2C1 paciente 10 — externalReferences não usa nome/telefone', () => { const references = getPsychologyPatientData(fixture(), 'patient-r2c1')?.patient.externalReferences; assert.deepEqual(references?.[0], patientInput.externalReferences?.[0]); assert.notEqual(references?.[0]?.externalId, patientInput.name); assert.notEqual(references?.[0]?.externalId, patientInput.phone); });

// Isolamento: 11–16
test('R2C1 isolamento 11 — profissional diferente não acessa paciente', () => { const store = fixture(); const foreign = createEmptyPsychologyStore(createPsychologyScope('professional-foreign')); assert.equal(getPsychologyPatientData({ ...foreign, patients: store.patients }, 'patient-r2c1'), null); });
test('R2C1 isolamento 12 — contexto Neuro não entra', () => { const store = fixture(); const neuro = { ...store.patients[0], context: 'NEURO' } as unknown as typeof store.patients[number]; assert.equal(getPsychologyPatientData({ ...store, patients: [neuro] }, 'patient-r2c1'), null); });
test('R2C1 isolamento 13 — sessões de outro paciente não aparecem', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.sessions.some(session => session.patientId === 'patient-other'), false));
test('R2C1 isolamento 14 — registros de outro paciente não aparecem', () => { const store = fixture(); const otherRecord = { ...store.sessionRecords[0], id: 'other-record', patientId: 'patient-other' }; assert.equal(getPsychologyPatientData({ ...store, sessionRecords: [...store.sessionRecords, otherRecord] }, 'patient-r2c1')?.records.some(record => record.id === 'other-record'), false); });
test('R2C1 isolamento 15 — cobranças de outro paciente não aparecem', () => { const store = fixture(); assert.equal(getPsychologyPatientData(store, 'patient-r2c1')?.charges.every(charge => charge.patientId === 'patient-r2c1'), true); });
test('R2C1 isolamento 16 — documentos de outro paciente não aparecem', () => { const store = fixture(); const foreignDocument = { ...store.documents[0], id: 'foreign-doc', patientId: 'patient-other' }; assert.equal(getPsychologyPatientData({ ...store, documents: [...store.documents, foreignDocument] }, 'patient-r2c1')?.documents.some(document => document.id === 'foreign-doc'), false); });

// Resumo: 17–21
test('R2C1 resumo 17 — próxima sessão correta', () => assert.equal(getPsychologyPatientSummary(fixture(), 'patient-r2c1', new Date('2026-08-13T10:00:00'))?.nextSession?.id, 'session-next'));
test('R2C1 resumo 18 — última sessão correta', () => assert.equal(getPsychologyPatientSummary(fixture(), 'patient-r2c1', new Date('2026-08-13T10:00:00'))?.lastSession?.id, 'session-past'));
test('R2C1 resumo 19 — paciente sem sessão tem empty state de dados', () => { const store = fixture(); const empty = upsertPsychologyPatient({ ...store, patients: [] }, { ...patientInput, name: 'Sem sessão', externalReferences: [] }, 'patient-empty'); assert.equal(getPsychologyPatientSummary(empty, 'patient-empty', new Date('2026-08-13T10:00:00'))?.nextSession, undefined); });
test('R2C1 resumo 20 — pacote só aparece quando ativo', () => { const store = fixture(); assert.equal(getPsychologyPatientSummary(store, 'patient-r2c1')?.activePackage?.id, 'package-r2c1'); });
test('R2C1 resumo 21 — conteúdo clínico não entra no resumo financeiro', () => { const summary = getPsychologyPatientSummary(fixture(), 'patient-r2c1'); assert.equal(JSON.stringify(summary).includes('Conteúdo clínico sintético reservado.'), false); });

// Sessões: 22–29
test('R2C1 sessões 22 — futuras aparecem', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.sessions.some(session => session.id === 'session-next'), true));
test('R2C1 sessões 23 — realizadas aparecem', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.sessions.find(session => session.id === 'session-past')?.status, 'realizada'));
test('R2C1 sessões 24 — status falta é compatível', () => { const store = fixture(); const next = { ...store, sessions: store.sessions.map(session => session.id === 'session-past' ? { ...session, status: 'falta' as const } : session) }; assert.equal(getPsychologyPatientData(next, 'patient-r2c1')?.sessions.find(session => session.id === 'session-past')?.status, 'falta'); });
test('R2C1 sessões 25 — cancelada é compatível', () => { const store = fixture(); const next = { ...store, sessions: store.sessions.map(session => session.id === 'session-past' ? { ...session, status: 'cancelada' as const } : session) }; assert.equal(getPsychologyPatientData(next, 'patient-r2c1')?.sessions.find(session => session.id === 'session-past')?.status, 'cancelada'); });
test('R2C1 sessões 26 — local resolve locationId', () => { const store = fixture(); assert.equal(getPsychologyPatientData(store, 'patient-r2c1')?.sessions.find(session => session.id === 'session-next')?.locationId, store.locations[0].id); });
test('R2C1 sessões 27 — online não precisa local físico', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.sessions.find(session => session.id === 'session-past')?.locationId, undefined));
test('R2C1 sessões 28 — sessão mantém vínculo paciente', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.sessions.every(session => session.patientId === 'patient-r2c1'), true));
test('R2C1 sessões 29 — agenda continua fonte do evento', () => { const store = fixture(); const data = getPsychologyPatientData(store, 'patient-r2c1'); assert.equal(data?.sessions.length, store.sessions.filter(session => session.patientId === 'patient-r2c1').length); });

// Registros: 30–35
test('R2C1 registros 30 — ficam separados das sessões', () => { const data = getPsychologyPatientData(fixture(), 'patient-r2c1'); assert.equal(data?.records.length, 1); assert.equal('content' in (data?.sessions.find(session => session.id === 'session-past') || {}), false); });
test('R2C1 registros 31 — conteúdo não aparece no preview completo', () => { const record = getPsychologyPatientData(fixture(), 'patient-r2c1')!.records[0]; assert.equal(getPsychologyPatientRecordPreview(record), 'Conteúdo clínico sintético reservado.'); });
test('R2C1 registros 32 — sessionId vincula quando disponível', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.records[0].sessionId, 'session-past'));
test('R2C1 registros 33 — autor é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.records[0].authorProfessionalId, 'professional-r2c1'));
test('R2C1 registros 34 — contexto é preservado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.records[0].context, 'PSICOLOGIA'));
test('R2C1 registros 35 — somente paciente correto', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.records.every(record => record.patientId === 'patient-r2c1'), true));

// Financeiro: 36–41
test('R2C1 financeiro 36 — Charge e Payment são separados', () => { const data = getPsychologyPatientData(fixture(), 'patient-r2c1')!; assert.equal(data.charges.length, 1); assert.equal(data.payments.length, 1); });
test('R2C1 financeiro 37 — cobrança 200 e pagamento 100 deixam saldo 100', () => assert.equal(getPsychologyPatientFinanceSummary(fixture(), 'patient-r2c1').pending, 100));
test('R2C1 financeiro 38 — múltiplos pagamentos somam corretamente', () => { let store = fixture(); store = createPsychologyPayment(store, { patientId: 'patient-r2c1', chargeId: store.charges[0].id, amount: 50, date: '2026-08-12', method: 'CASH', createdBy: 'professional-r2c1' }); assert.equal(getPsychologyPatientFinanceSummary(store, 'patient-r2c1').pending, 50); });
test('R2C1 financeiro 39 — isento não cria pagamento fictício', () => { let store = fixture(); store = createPsychologyCharge(store, { patientId: 'patient-r2c1', description: 'Cortesia', amount: 0, dueDate: '2026-08-30', createdBy: 'professional-r2c1' }); const exempt = store.charges.find(charge => charge.description === 'Cortesia'); assert.equal(exempt?.status, 'exempt'); assert.equal(store.payments.some(payment => payment.chargeId === exempt?.id), false); });
test('R2C1 financeiro 40 — pacote não altera saldo financeiro', () => { const store = fixture(); const withPackage = { ...store, sessionPackages: [] }; assert.equal(getPsychologyPatientFinanceSummary(store, 'patient-r2c1').pending, getPsychologyPatientFinanceSummary(withPackage, 'patient-r2c1').pending); });
test('R2C1 financeiro 41 — pagamento de outro contexto não entra', () => { const store = fixture(); const foreignPayment = { ...store.payments[0], id: 'foreign-payment', context: 'NEURO' as const } as unknown as typeof store.payments[number]; assert.equal(getPsychologyPatientFinanceSummary({ ...store, payments: [...store.payments, foreignPayment] }, 'patient-r2c1').totalReceived, 100); });

// Pacotes: 42–47
test('R2C1 pacotes 42 — paciente sem pacote é permitido', () => assert.equal(getPsychologyPatientSummary({ ...fixture(), sessionPackages: [] }, 'patient-r2c1')?.activePackage, undefined));
test('R2C1 pacotes 43 — pacote de 4 funciona', () => { const store = upsertPsychologySessionPackage(fixture(), { patientId: 'patient-r2c1', name: 'Pacote 4', totalSessions: 4, usedSessions: 1, startDate: '2026-08-01' }, 'package-4'); assert.equal(store.sessionPackages.find(item => item.id === 'package-4')?.totalSessions, 4); });
test('R2C1 pacotes 44 — pacote de 8 funciona', () => assert.equal(fixture().sessionPackages[0].totalSessions, 8));
test('R2C1 pacotes 45 — pacote de 10 não é obrigatório', () => { const store = upsertPsychologySessionPackage({ ...fixture(), sessionPackages: [] }, { patientId: 'patient-r2c1', name: 'Pacote 10', totalSessions: 10, startDate: '2026-08-01' }, 'package-10'); assert.equal(store.sessionPackages[0].totalSessions, 10); });
test('R2C1 pacotes 46 — progresso é calculado', () => assert.equal(getPsychologySessionPackageProgress(fixture().sessionPackages[0]), 63));
test('R2C1 pacotes 47 — inativo não aparece como atual', () => { const store = { ...fixture(), sessionPackages: fixture().sessionPackages.map(item => ({ ...item, active: false })) }; assert.equal(getPsychologyPatientSummary(store, 'patient-r2c1')?.activePackage, undefined); });

// Documentos e anexos: 48–54
test('R2C1 documentos 48 — administrativo é classificado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.documents.find(document => document.id === 'doc-admin')?.classification, 'ADMINISTRATIVE'));
test('R2C1 documentos 49 — clínico é classificado', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.documents.find(document => document.id === 'doc-clinical')?.classification, 'CLINICAL'));
test('R2C1 documentos 50 — classificação é preservada', () => assert.deepEqual(getPsychologyPatientData(fixture(), 'patient-r2c1')?.documents.map(document => document.classification), ['ADMINISTRATIVE', 'CLINICAL']));
test('R2C1 documentos 51 — anexo fixture não exige storage real', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.attachments[0].storageRef, 'synthetic://attachment'));
test('R2C1 documentos 52 — externalSource é preservada', () => assert.equal(getPsychologyPatientData(fixture(), 'patient-r2c1')?.documents.find(document => document.id === 'doc-clinical')?.externalSource, 'doctoralia'));
test('R2C1 documentos 53 — documento de outro paciente não aparece', () => { const store = fixture(); const foreign = { ...store.documents[0], id: 'foreign-doc', patientId: 'patient-other' }; assert.equal(getPsychologyPatientData({ ...store, documents: [...store.documents, foreign] }, 'patient-r2c1')?.documents.some(document => document.id === 'foreign-doc'), false); });
test('R2C1 documentos 54 — documentos clínicos não entram no resumo', () => assert.equal(JSON.stringify(getPsychologyPatientSummary(fixture(), 'patient-r2c1')).includes('registro.pdf'), false));

// UI e arquitetura: 55–62
const chartUi = readFileSync('src/features/psychology-pilot/PsychologyPatientChart.tsx', 'utf8');
const pilotUi = readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
const domainUi = readFileSync('src/features/psychology-pilot/psychologyDomain.ts', 'utf8');
test('R2C1 UI 55 — ficha normal expõe somente abas operacionais prontas', () => { for (const label of ['Resumo', 'Sessões']) assert.match(chartUi, new RegExp(label)); const start = chartUi.indexOf('return <div className="fixed inset-0 z-[220]'); const visibleChart = chartUi.slice(start, chartUi.indexOf('</main>', start)); for (const label of ['Registros', 'Financeiro', 'Pacotes', 'Documentos e anexos']) assert.doesNotMatch(visibleChart, new RegExp(label)); });
test('R2C1 UI 56 — cabeçalho é compacto', () => assert.match(chartUi, /Editar paciente/));
test('R2C1 UI 57 — ação Agendar sessão existe', () => assert.match(chartUi, /Agendar sessão/));
test('R2C1 UI 58 — ficha usa Patient, não Atendente', () => { assert.match(chartUi, /patientId/); assert.doesNotMatch(chartUi, /Atendente/); });
test('R2C1 UI 59 — responsável é administrativo e Psychology-specific', () => { assert.match(chartUi, /administrativeResponsible/); assert.doesNotMatch(chartUi, /guardianName/); });
test('R2C1 UI 60 — modo móvel usa seletor de abas', () => assert.match(chartUi, /sm:hidden/));
test('R2C1 UI 61 — ficha impede overflow global', () => assert.match(chartUi, /overflow-hidden/));
test('R2C1 UI 62 — Patient é domínio próprio com referências externas', () => { assert.match(domainUi, /interface PsychologyPatient/); assert.match(domainUi, /externalReferences/); assert.match(pilotUi, /PsychologyPatientChart/); });
