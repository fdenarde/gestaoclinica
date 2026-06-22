import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildMonitoringPatientSummary,
  buildMonitoringSessionDataset,
  calculateMonitoringProgress,
  filterMonitoringPatients,
  filterMonitoringSummaries,
  getMonitoringUpcomingSessionGroups,
  getSaoPauloWeekRange,
  groupMonitoringSessionsByDate,
  isDateWithinMonitoringWeek,
  isMonitoringGalleryPatientVisible,
  isMonitoringPatientVisible,
} from '../shared/monitoringPanel.js';

test('Andamento do acompanhamento usa sessões realizadas dividido por sessões previstas', () => {
  assert.deepEqual(calculateMonitoringProgress({ realizedSessions: 4, plannedSessions: 10 }), {
    realizedSessions: 4,
    plannedSessions: 10,
    percentage: 40,
    label: '40%',
  });
});

test('Andamento do acompanhamento trata pacote ausente e divisão por zero', () => {
  assert.deepEqual(calculateMonitoringProgress({ realizedSessions: 4, plannedSessions: 0 }), {
    realizedSessions: 4,
    plannedSessions: 0,
    percentage: null,
    label: 'Pacote não definido',
  });
});

test('resumo do atendente não interpreta percentual como evolução clínica', () => {
  const summary = buildMonitoringPatientSummary(
    { id: 'p1', name: 'Atendente Teste', status: 'Ativo' },
    [
      { id: 's1', patientId: 'p1', date: '2026-06-01', time: '10:00', status: 'Realizada' },
      { id: 's2', patientId: 'p1', date: '2026-06-08', time: '10:00', status: 'Reposição' },
      { id: 's3', patientId: 'p1', date: '2026-06-22', time: '10:00', status: 'Agendada' },
    ],
    2,
    10,
  );
  assert.equal(summary.progressLabel, '20%');
  assert.equal(summary.currentPackageRealized, 2);
  assert.equal(summary.sessionsRealized, 2);
  assert.equal(summary.activityCount, 2);
  assert.equal(summary.nextSession.id, 's3');
});

test('filtros do Dashboard respeitam nome, situação, ativos/encerrados e faixa de andamento', () => {
  const summaries = [
    { patient: { id: 'p1', name: 'Ana Clara', status: 'Ativo' }, status: 'Ativo', progressPercentage: 30 },
    { patient: { id: 'p2', name: 'Bruno Lima', status: 'Concluído' }, status: 'Concluído', progressPercentage: 90 },
  ];
  assert.deepEqual(filterMonitoringSummaries(summaries, { name: 'ana', activeState: 'active' }).map(item => item.patient.id), ['p1']);
  assert.deepEqual(filterMonitoringSummaries(summaries, { activeState: 'closed' }).map(item => item.patient.id), ['p2']);
  assert.deepEqual(filterMonitoringSummaries(summaries, { minProgress: 80 }).map(item => item.patient.id), ['p2']);
  assert.deepEqual(filterMonitoringSummaries(summaries, { maxProgress: 50 }).map(item => item.patient.id), ['p1']);
});


test('filtros vazios não transformam andamento máximo em zero', () => {
  const summaries = [
    { patient: { id: 'p1', name: 'Ana', status: 'Ativo' }, status: 'Ativo', progressPercentage: 30 },
    { patient: { id: 'p2', name: 'Bruno', status: 'Ativo' }, status: 'Ativo', progressPercentage: 90 },
  ];
  assert.deepEqual(filterMonitoringSummaries(summaries, {
    activeState: 'all',
    minProgress: null,
    maxProgress: null,
  }).map(item => item.patient.id), ['p1', 'p2']);
});

test('próximas sessões separam hoje e a próxima data futura', () => {
  const result = getMonitoringUpcomingSessionGroups([
    { id: 's1', patientId: 'p1', date: '2026-06-21', time: '08:00', status: 'Agendada' },
    { id: 's2', patientId: 'p2', date: '2026-06-22', time: '09:00', status: 'Agendada' },
    { id: 's3', patientId: 'p3', date: '2026-06-22', time: '10:00', status: 'Agendada' },
    { id: 's4', patientId: 'p4', date: '2026-06-23', time: '11:00', status: 'Cancelada' },
  ], new Date('2026-06-21T12:00:00-03:00'));
  assert.equal(result.today, '2026-06-21');
  assert.deepEqual(result.todaySessions.map(item => item.id), ['s1']);
  assert.equal(result.nextDate, '2026-06-22');
  assert.deepEqual(result.nextSessions.map(item => item.id), ['s2', 's3']);
});

test('Agenda semanal agrupa somente horários preenchidos por data', () => {
  const groups = groupMonitoringSessionsByDate([
    { id: 's2', date: '2026-06-22', time: '10:00' },
    { id: 's1', date: '2026-06-22', time: '08:00' },
    { id: 's3', date: '', time: '09:00' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, '2026-06-22');
  assert.deepEqual(groups[0].sessions.map(item => item.id), ['s1', 's2']);
});

test('Jacinto Melaço (Teste) fica oculto de todas as áreas do Monitoramento', () => {
  assert.equal(isMonitoringGalleryPatientVisible({ name: 'Jacinto Melaço (Teste)' }), false);
  assert.equal(isMonitoringPatientVisible({ name: 'Jacinto Melaço (Teste)' }), false);
  assert.equal(isMonitoringGalleryPatientVisible({ name: 'Jacinto Melaço' }), true);
  assert.equal(isMonitoringGalleryPatientVisible({ name: 'Nicolas' }), true);
  assert.deepEqual(filterMonitoringPatients([
    { id: 'flag-hidden', name: 'Atendente Oculto', monitoringVisible: false },
    { id: 'visible', name: 'Nicolas' },
  ]).map(patient => patient.id), ['visible']);
});

test('Agenda do Monitoramento calcula a semana 21/06 a 27/06 a partir dos horários fixos reais', () => {
  const weekRange = { start: '2026-06-21', end: '2026-06-27' };
  const basePatient = {
    status: 'Ativo',
    startDate: '2026-01-01',
    whatsapp: '27999990000',
  };
  const patients = [
    { ...basePatient, id: 'alicia', name: 'Alicia', fixedDay: 'terça', fixedTime: '16:00' },
    { ...basePatient, id: 'emanuelly', name: 'Emanuelly', fixedDay: 'quarta', fixedTime: '08:00' },
    { ...basePatient, id: 'nicolas', name: 'Nicolas', fixedDay: 'quarta', fixedTime: '09:00' },
    { ...basePatient, id: 'eliza', name: 'Eliza', fixedDay: 'quinta', fixedTime: '10:00' },
    { ...basePatient, id: 'isabelly', name: 'Isabelly', fixedDay: 'quinta', fixedTime: '13:00' },
    { ...basePatient, id: 'wesley', name: 'Wesley', fixedDay: 'quinta', fixedTime: '14:00' },
    { ...basePatient, id: 'celso', name: 'Celso', fixedDay: 'sexta', fixedTime: '14:00', doubleSession: true },
    { ...basePatient, id: 'luiza', name: 'Luiza', fixedDay: 'sábado', fixedTime: '08:00' },
    { ...basePatient, id: 'jacinto', name: 'Jacinto Melaço (Teste)', fixedDay: 'sábado', fixedTime: '14:00' },
    { ...basePatient, id: 'outro-profissional', name: 'Outro Profissional', fixedDay: 'quarta', fixedTime: '11:00' },
  ];

  const dataset = buildMonitoringSessionDataset({
    patients,
    sessions: [
      {
        id: 'manual-outro-profissional',
        patientId: 'outro-profissional',
        patientName: 'Outro Profissional',
        date: '2026-06-24',
        time: '11:00',
        status: 'Agendada',
        professionalName: 'Profissional Externo',
      },
    ],
    weekRange,
    now: new Date('2026-06-21T12:00:00-03:00'),
  });

  const byPatient = new Map(dataset.weekSessions.map(session => [session.patientId, session]));
  assert.equal(byPatient.get('alicia')?.date, '2026-06-23');
  assert.equal(byPatient.get('alicia')?.time, '16:00');
  assert.equal(byPatient.get('emanuelly')?.date, '2026-06-24');
  assert.equal(byPatient.get('nicolas')?.date, '2026-06-24');
  assert.equal(byPatient.get('eliza')?.date, '2026-06-25');
  assert.equal(byPatient.get('isabelly')?.date, '2026-06-25');
  assert.equal(byPatient.get('wesley')?.date, '2026-06-25');
  assert.deepEqual(
    dataset.weekSessions.filter(session => session.patientId === 'celso').map(session => `${session.date} ${session.time}`),
    ['2026-06-26 14:00', '2026-06-26 15:00'],
  );
  assert.equal(byPatient.get('luiza')?.date, '2026-06-27');
  assert.equal(byPatient.get('luiza')?.time, '08:00');
  assert.equal(dataset.weekSessions.some(session => session.patientId === 'jacinto'), false);
  assert.equal(byPatient.get('outro-profissional')?.professionalName, 'Profissional Externo');
});

test('Agenda do Monitoramento é limitada à semana atual por intervalo de datas', () => {
  const range = getSaoPauloWeekRange(new Date('2026-06-21T15:00:00-03:00'));
  assert.equal(range.start, '2026-06-21');
  assert.equal(range.end, '2026-06-27');
  assert.equal(isDateWithinMonitoringWeek('2026-06-22', range), true);
  assert.equal(isDateWithinMonitoringWeek('2026-06-28', range), false);

  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  assert.match(accessSource, /buildMonitoringSessionDataset/);
  assert.match(accessSource, /sessionsRef\.limit\(2000\)\.get\(\)/);
  assert.doesNotMatch(accessSource, /weekSessionsSnapshot/);
  assert.doesNotMatch(accessSource, /where\('date', '>=', weekRange\.start\)/);
});

test('Galeria de Monitoramento reutiliza o escopo portal do responsável', () => {
  const componentSource = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
  const sharedSource = fs.readFileSync(new URL('../shared/googlePhotosAlbums.js', import.meta.url), 'utf8');
  assert.match(componentSource, /ResponsibleGooglePhotosGallery/);
  assert.match(componentSource, /isMonitoringPatientVisible/);
  assert.match(componentSource, /PatientPhoto/);
  assert.match(componentSource, /expandable/);
  assert.match(sharedSource, /effectiveRole === 'responsible' \|\| effectiveRole === 'admin' \|\| effectiveRole === 'monitoring'/);
});

test('interface revisada mostra logo, usuário, progresso, próximas sessões e Agenda apenas semanal', () => {
  const componentSource = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
  assert.match(componentSource, /BrandLogo/);
  assert.match(componentSource, /variant="sidebar"/);
  assert.match(componentSource, /bg-clinic-header/);
  assert.match(componentSource, /border-white\/15/);
  assert.match(componentSource, /name=\{data\?\.settings\.name\}/);
  assert.match(componentSource, /Usuário do Monitoramento/);
  assert.match(componentSource, /Progresso dos Atendentes/);
  assert.match(componentSource, /Próximas Sessões — Hoje/);
  assert.match(componentSource, /Agenda Semanal/);
  assert.match(componentSource, /Somente horários preenchidos/);
  assert.doesNotMatch(componentSource, /type AgendaMode|agendaMode|Mensal|Lista cronológica/);
  assert.match(componentSource, /Galeria externa de atividades/);
  assert.match(componentSource, /Selecione o atendente/);

  const gallerySource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  assert.match(gallerySource, /bg-status-green-text/);
});
