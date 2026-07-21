import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCurrentPackageSessionSummaries,
  buildCurrentPackageSessionSummary,
  formatCurrentPackageSessionSummaries,
  formatCurrentPackageSessionSummary,
} from '../shared/sessionPackageSummary.js';

test('Sessões Restantes usa o mesmo ciclo atual de 10 sessões para Relatórios e Monitoramento', () => {
  const patient = {
    id: 'p1',
    name: 'Alicia Exemplo',
    guardianName: 'Responsável Exemplo',
    status: 'Ativo',
    startDate: '2026-01-01',
  };
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    id: `s${index + 1}`,
    patientId: 'p1',
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    time: '10:00',
    status: index === 13 ? 'Reposição' : 'Realizada',
  }));

  const summary = buildCurrentPackageSessionSummary(patient, sessions, 10);

  assert.equal(summary.totalRealized, 18);
  assert.equal(summary.count, 8);
  assert.equal(summary.remaining, 2);
  assert.equal(summary.sessions[0].id, 's11');
  assert.equal(summary.sessions.at(-1).id, 's18');
});

test('lista considera apenas atendentes ativos e preserva filtro de visibilidade', () => {
  const patients = [
    { id: 'visible', name: 'Alicia', status: 'Ativo' },
    { id: 'hidden', name: 'Jacinto Melaço (Teste)', status: 'Ativo' },
    { id: 'closed', name: 'Encerrado', status: 'Concluído' },
  ];

  const summaries = buildCurrentPackageSessionSummaries(patients, [], {
    onlyActive: true,
    includePatient: patient => patient.id !== 'hidden',
  });

  assert.deepEqual(summaries.map(item => item.patient.id), ['visible']);
});

test('texto individual e texto geral ficam legíveis para a área de transferência', () => {
  const summary = buildCurrentPackageSessionSummary({
    id: 'p1',
    name: 'Alicia',
    guardianName: 'Responsável',
    status: 'Ativo',
  }, [
    { id: 's1', patientId: 'p1', date: '2026-06-01', time: '10:00', status: 'Realizada' },
    { id: 's2', patientId: 'p1', date: '2026-06-08', time: '10:00', status: 'Reposição' },
  ], 10);

  const individual = formatCurrentPackageSessionSummary(summary, {
    includeReportHeader: true,
    reportDate: '21/06/2026',
  });
  const all = formatCurrentPackageSessionSummaries([summary], {
    reportDate: '21/06/2026',
  });

  assert.match(individual, /Atendente: Alicia/);
  assert.match(individual, /Sessões contabilizadas \(2\/10\)/);
  assert.match(individual, /08\/06 - reposição/);
  assert.match(individual, /Restantes: 8 sessões/);
  assert.match(all, /Relatório de Sessões — 21\/06\/2026/);
});

test('Dashboard do Monitoramento contém card, cópia geral e cópia individual', () => {
  const source = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /Sessões Restantes \(Pacote atual\)/);
  assert.match(source, /copyAllPackageSummaries/);
  assert.match(source, /Copiar todos/);
  assert.match(source, /formatCurrentPackageSessionSummary/);
  assert.match(source, /aria-label=\{`Copiar resumo de sessões de \$\{patientName\}`\}/);
  assert.match(source, /max-h-\[420px\]/);
});

test('Relatórios e Monitoramento importam a mesma regra compartilhada', () => {
  const reports = fs.readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8');
  const monitoring = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
  assert.match(reports, /shared\/sessionPackageSummary\.js/);
  assert.match(monitoring, /shared\/sessionPackageSummary\.js/);
});
