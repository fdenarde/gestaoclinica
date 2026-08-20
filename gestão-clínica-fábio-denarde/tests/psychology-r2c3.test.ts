import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  upsertPsychologyPatient,
  upsertPsychologySession,
  updatePsychologySessionStatus,
  type PsychologyStore,
} from '../src/features/psychology-pilot/psychologyDomain';
import {
  createPsychologyChargeInLedger,
  createPsychologyExpenseInLedger,
  createPsychologyPaymentInLedger,
  createPsychologyPeriod,
  reversePsychologyPayment,
} from '../src/features/psychology-pilot/psychologyFinancialLedger';
import {
  getPsychologyAgendaReport,
  getPsychologyFinanceReport,
  getPsychologyPatientsReport,
  getPsychologySessionsReport,
  type PsychologyReportFilter,
} from '../src/features/psychology-pilot/psychologyReports';
import {
  buildPsychologyReportCsv,
  buildPsychologyReportPdf,
  psychologyReportFileName,
} from '../src/features/psychology-pilot/psychologyReportExports';

const scope = createPsychologyScope('r2c3-professional');
const period = createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31');
const baseFilter: PsychologyReportFilter = { period, sessionStatus: 'all', modality: 'all', patientStatus: 'all' };

function fixture(): PsychologyStore {
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, { name: 'Alice Sintética', birthDate: '1990-01-01', phone: '111', email: 'alice@example.test', preferredModality: 'online', administrativeNote: 'NOTA_CLINICA_NAO_EXPORTAR', active: true }, 'patient-alice', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologyPatient(store, { name: 'Bruna Inativa', birthDate: '1991-01-01', phone: '222', email: '', preferredModality: 'presencial', administrativeNote: 'NOTA_CLINICA_2', active: false }, 'patient-bruna', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologyPatient(store, { name: 'Érica Sintética', birthDate: '1992-01-01', phone: '333', email: '', preferredModality: 'presencial', administrativeNote: 'NOTA_CLINICA_3', active: true }, 'patient-erica', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-alice', date: '2026-08-01', time: '09:00', durationMinutes: 50, modality: 'online', serviceId: store.services[0].id, administrativeNote: 'SEGREDO_CLINICO' }, 'session-realizada', '2026-08-01T08:00:00.000Z');
  store = updatePsychologySessionStatus(store, 'session-realizada', 'realizada', '2026-08-01T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-erica', date: '2026-08-02', time: '10:00', durationMinutes: 50, modality: 'presencial', locationId: store.locations[0].id, locationType: store.locations[0].type, serviceId: store.services[0].id, administrativeNote: 'SEGREDO_CLINICO' }, 'session-falta', '2026-08-02T08:00:00.000Z');
  store = updatePsychologySessionStatus(store, 'session-falta', 'falta', '2026-08-02T10:00:00.000Z');
  store = upsertPsychologySession(store, { patientId: 'patient-alice', date: '2026-08-03', time: '11:00', durationMinutes: 50, modality: 'presencial', locationId: store.locations[0].id, locationType: store.locations[0].type, serviceId: store.services[0].id, administrativeNote: 'SEGREDO_CLINICO' }, 'session-cancelada', '2026-08-03T08:00:00.000Z');
  store = updatePsychologySessionStatus(store, 'session-cancelada', 'cancelada', '2026-08-03T10:00:00.000Z');
  return upsertPsychologySession(store, { patientId: 'patient-alice', date: '2026-08-20', time: '14:00', durationMinutes: 50, modality: 'online', serviceId: store.services[0].id, administrativeNote: 'SEGREDO_CLINICO' }, 'session-futura', '2026-08-04T08:00:00.000Z');
}

function financialFixture(): PsychologyStore {
  let store = fixture();
  const charge = createPsychologyChargeInLedger(store, { patientId: 'patient-alice', sessionId: 'session-realizada', description: 'Sessão administrativa sintética', amount: 200, dueDate: '2026-08-10' }, '2026-08-01T12:00:00.000Z');
  store = charge.store;
  const payment = createPsychologyPaymentInLedger(store, { patientId: 'patient-alice', chargeId: store.charges[0].id, amount: 100, date: '2026-08-12', method: 'PIX' }, '2026-08-12T12:00:00.000Z');
  store = payment.store;
  const expense = createPsychologyExpenseInLedger(store, { description: 'Despesa administrativa sintética', amount: 50, date: '2026-08-13', category: 'Aluguel', status: 'REALIZED' }, '2026-08-13T12:00:00.000Z');
  return expense.store;
}

test('R2C3 01 — total de sessões respeita o período e o escopo', () => {
  const report = getPsychologySessionsReport(fixture(), baseFilter);
  assert.equal(report.total, 4);
  assert.equal(report.realized, 1);
  assert.equal(report.scheduled, 1);
  assert.equal(report.absences, 1);
  assert.equal(report.cancelled, 1);
});

test('R2C3 02 — comparecimento usa realizadas sobre realizadas mais faltas', () => assert.equal(getPsychologySessionsReport(fixture(), baseFilter).attendanceRate, 50));
test('R2C3 03 — cancelada fica fora do denominador', () => assert.equal(getPsychologySessionsReport(fixture(), baseFilter).attendanceRate, 50));
test('R2C3 04 — futura/agendada fica fora do denominador', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, sessionStatus: 'agendada' }).attendanceRate, null));
test('R2C3 05 — denominador zero retorna ausência de percentual', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, sessionStatus: 'cancelada' }).attendanceRate, null));
test('R2C3 06 — filtro por paciente funciona', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, patientId: 'patient-erica' }).total, 1));
test('R2C3 07 — filtro por status funciona', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, sessionStatus: 'realizada' }).total, 1));
test('R2C3 08 — filtro por modalidade funciona', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, modality: 'online' }).total, 2));
test('R2C3 09 — filtro por local usa locationId', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, locationId: fixture().locations[0].id }).total, 2));
test('R2C3 10 — filtro por serviço funciona', () => assert.equal(getPsychologySessionsReport(fixture(), { ...baseFilter, serviceId: fixture().services[0].id }).total, 4));
test('R2C3 11 — conteúdo clínico não entra nas linhas', () => assert.equal(JSON.stringify(getPsychologySessionsReport(fixture(), baseFilter)).includes('SEGREDO_CLINICO'), false));

test('R2C3 12 — financeiro consome os indicadores do ledger R2C2', () => {
  const report = getPsychologyFinanceReport(financialFixture(), baseFilter);
  assert.equal(report.overview.received, 100);
  assert.equal(report.overview.receivable, 100);
  assert.equal(report.overview.overdue, 100);
  assert.equal(report.overview.expenses, 50);
  assert.equal(report.overview.balance, 50);
});

test('R2C3 13 — pagamento estornado não entra por método nem recebido', () => {
  const store = financialFixture();
  const reversed = reversePsychologyPayment(store, store.payments[0].id, 'Validação sintética');
  const report = getPsychologyFinanceReport(reversed.store, baseFilter);
  assert.equal(report.overview.received, 0);
  assert.equal(report.receivedByMethod.find(item => item.method === 'PIX')?.amount, 0);
});

test('R2C3 14 — filtro financeiro por paciente isola o ledger', () => assert.equal(getPsychologyFinanceReport(financialFixture(), { ...baseFilter, patientId: 'patient-erica' }).overview.received, 0));
test('R2C3 15 — filtro financeiro por período usa data de pagamento e despesa', () => assert.equal(getPsychologyFinanceReport(financialFixture(), { ...baseFilter, period: createPsychologyPeriod('custom', undefined, '2026-07-01', '2026-07-31') }).overview.received, 0));

test('R2C3 16 — agenda soma sessões não canceladas e realizadas separadamente', () => {
  const report = getPsychologyAgendaReport(fixture(), baseFilter);
  assert.equal(report.scheduledSessions, 3);
  assert.equal(report.scheduledMinutes, 150);
  assert.equal(report.realizedMinutes, 50);
});

test('R2C3 17 — agenda distribui por dia, modalidade e local', () => {
  const report = getPsychologyAgendaReport(fixture(), baseFilter);
  assert.ok(report.byDay.length >= 2);
  assert.ok(report.byModality.some(item => item.label === 'Online'));
  assert.ok(report.byModality.some(item => item.label === 'Presencial'));
  assert.ok(report.byLocation.some(item => item.label === 'Shopping Moxuara'));
});

test('R2C3 18 — ocupação usa disponibilidade configurada', () => {
  const report = getPsychologyAgendaReport(fixture(), baseFilter);
  assert.equal(report.availabilityConfigured, true);
  assert.ok(report.availableMinutes && report.availableMinutes > 0);
  assert.ok(report.occupancyRate && report.occupancyRate > 0);
});

test('R2C3 19 — ocupação não inventa base quando agenda está sem horários', () => {
  const store = fixture();
  const report = getPsychologyAgendaReport({ ...store, settings: { ...store.settings, agenda: { ...store.settings.agenda, weeklyAvailability: store.settings.agenda.weeklyAvailability.map(day => ({ ...day, enabled: false, periods: [] })) } } }, baseFilter);
  assert.equal(report.availableMinutes, null);
  assert.equal(report.occupancyRate, null);
});

test('R2C3 20 — compromisso pessoal e mentoria não viram sessão clínica', () => {
  const store = fixture();
  const withPersonal = { ...store, personalCommitments: [{ id: 'personal-1', professionalId: scope.professionalId, context: scope.context, date: '2026-08-10', time: '13:00', durationMinutes: 120, type: 'Mentoria' as const, title: 'Mentoria administrativa', recurrence: 'Não repetir' as const, alarmEnabled: false, isDone: false, createdAt: '', updatedAt: '' }] };
  assert.equal(getPsychologyAgendaReport(withPersonal, baseFilter).scheduledSessions, 3);
});

test('R2C3 21 — pacientes contam ativos, inativos, próxima sessão e pacote', () => {
  const store = { ...fixture(), sessionPackages: [{ id: 'package-1', patientId: 'patient-alice', professionalId: scope.professionalId, context: scope.context, name: 'Pacote sintético', totalSessions: 4, usedSessions: 1, startDate: '2026-08-01', active: true, createdAt: '', updatedAt: '' }] };
  const report = getPsychologyPatientsReport(store, baseFilter, '2026-08-14');
  assert.equal(report.active, 2);
  assert.equal(report.inactive, 1);
  assert.equal(report.withNext, 1);
  assert.equal(report.withoutNext, 2);
  assert.equal(report.withPackage, 1);
  assert.equal(report.rows.find(row => row.patient.id === 'patient-alice')?.lastSessionDate, '2026-08-01');
  assert.equal(report.rows.find(row => row.patient.id === 'patient-alice')?.nextSession?.date, '2026-08-20');
});

test('R2C3 22 — pacientes ordenam A–Z com acentos', () => {
  const rows = getPsychologyPatientsReport(fixture(), baseFilter, '2026-08-14').rows;
  assert.deepEqual(rows.map(row => row.patient.name), ['Alice Sintética', 'Bruna Inativa', 'Érica Sintética']);
});

test('R2C3 23 — filtro de pacientes ativos e sem pacote funciona', () => {
  const store = { ...fixture(), sessionPackages: [{ id: 'package-1', patientId: 'patient-alice', professionalId: scope.professionalId, context: scope.context, name: 'Pacote sintético', totalSessions: 4, usedSessions: 1, startDate: '2026-08-01', active: true, createdAt: '', updatedAt: '' }] };
  assert.equal(getPsychologyPatientsReport(store, { ...baseFilter, patientStatus: 'active' }, '2026-08-14').rows.length, 2);
  assert.equal(getPsychologyPatientsReport(store, { ...baseFilter, patientStatus: 'without-package' }, '2026-08-14').rows.length, 2);
});

test('R2C3 24 — profissional ou contexto externo não entra antes da agregação', () => {
  const store = fixture();
  const foreignPatient = { ...store.patients[0], id: 'foreign', professionalId: 'other-professional' };
  const foreignSession = { ...store.sessions[0], id: 'foreign-session', patientId: 'foreign', professionalId: 'other-professional' };
  const foreignContextPatient = { ...store.patients[0], id: 'foreign-context', context: 'NEURO' } as never;
  const foreignContextSession = { ...store.sessions[0], id: 'foreign-context-session', patientId: 'foreign-context', context: 'NEURO' } as never;
  const report = getPsychologySessionsReport({ ...store, patients: [...store.patients, foreignPatient, foreignContextPatient], sessions: [...store.sessions, foreignSession, foreignContextSession] }, baseFilter);
  assert.equal(report.total, 4);
});

function exportPayload(kind: 'sessions' | 'finance' | 'agenda' | 'patients', store: PsychologyStore, report: ReturnType<typeof getPsychologySessionsReport> | ReturnType<typeof getPsychologyFinanceReport> | ReturnType<typeof getPsychologyAgendaReport> | ReturnType<typeof getPsychologyPatientsReport>, financeView: 'summary' | 'charges' | 'payments' | 'expenses' = 'summary') {
  return { kind, report, store, financeView, meta: { professionalName: 'Psicologia Sintética', specialty: 'Psicologia', professionalId: scope.professionalId, crp: 'CRP-SINTETICO', clinicName: 'Gestão Clínica', periodLabel: '01/08/2026 a 31/08/2026', periodEndDate: '2026-08-31', filtersLabel: 'Status: Realizada', generatedAt: '14/08/2026 10:00' } } as never;
}

test('R2C3 25 — CSV de atendimentos tem cabeçalho administrativo e não tem clínica', () => {
  const csv = buildPsychologyReportCsv(exportPayload('sessions', fixture(), getPsychologySessionsReport(fixture(), { ...baseFilter, sessionStatus: 'realizada' })));
  assert.match(csv, /Data;Horário;Paciente/);
  assert.equal(csv.includes('SEGREDO_CLINICO'), false);
});

test('R2C3 26 — CSV financeiro reflete visão e moeda BRL', () => {
  const store = financialFixture();
  const csv = buildPsychologyReportCsv(exportPayload('finance', store, getPsychologyFinanceReport(store, baseFilter), 'charges'));
  assert.match(csv, /Paciente;Descrição;Valor/);
  assert.match(csv, /R\$[\u00a0 ]200,00/);
});

test('R2C3 27 — CSV de agenda e pacientes são gerados', () => {
  const store = fixture();
  const agendaCsv = buildPsychologyReportCsv(exportPayload('agenda', store, getPsychologyAgendaReport(store, baseFilter)));
  const patientsCsv = buildPsychologyReportCsv(exportPayload('patients', store, getPsychologyPatientsReport(store, baseFilter, '2026-08-14')));
  assert.match(agendaCsv, /Dimensão;Item;Sessões/);
  assert.match(patientsCsv, /Paciente;Telefone;E-mail/);
});

test('R2C3 28 — PDF dos quatro relatórios abre e tem nome seguro', () => {
  const store = financialFixture();
  const payloads = [
    exportPayload('sessions', store, getPsychologySessionsReport(store, baseFilter)),
    exportPayload('finance', store, getPsychologyFinanceReport(store, baseFilter), 'charges'),
    exportPayload('agenda', store, getPsychologyAgendaReport(store, baseFilter)),
    exportPayload('patients', store, getPsychologyPatientsReport(store, baseFilter, '2026-08-14')),
  ];
  payloads.forEach(payload => {
    const bytes = buildPsychologyReportPdf(payload).output('arraybuffer');
    assert.ok(bytes.byteLength > 1000);
    assert.equal(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 4)), '%PDF');
  });
  assert.equal(psychologyReportFileName('sessions', '2026-08-31', 'pdf'), 'RELATORIO-PSICOLOGIA-ATENDIMENTOS-E-STATUS-2026-08.pdf');
});

test('R2C3 29 — exportações administrativas não carregam registros clínicos', () => {
  const store = fixture();
  const report = getPsychologyPatientsReport(store, baseFilter, '2026-08-14');
  const csv = buildPsychologyReportCsv(exportPayload('patients', store, report));
  assert.equal(csv.includes('NOTA_CLINICA'), false);
  assert.equal(csv.includes('SEGREDO_CLINICO'), false);
});
