import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pilot = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const chart = await readFile(new URL('../src/features/psychology-pilot/PsychologyPatientChart.tsx', import.meta.url), 'utf8');
const publicBooking = await readFile(new URL('../src/features/psychology-online-booking/PublicBookingPage.tsx', import.meta.url), 'utf8');
const management = await readFile(new URL('../src/features/psychology-online-booking/AppointmentManagementPage.tsx', import.meta.url), 'utf8');
const entrypoint = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('R2B13-S não deixa módulos locais ou incompletos visíveis na Psicologia normal', () => {
  assert.match(pilot, /\['personal', 'Agenda Pessoal', Menu\]/);
  assert.match(pilot, /\['settings', 'Ajustes', Pencil\]/);
  for (const pattern of [
    /\['finance', 'Financeiro'/,
    /\['reports', 'Relatórios'/,
    /PublicBookingSettingsPanel/,
    /PsychologyMessagingCenter/,
    /PsychologyImportExport store=\{store\}/,
    /data-testid="psychology-settings-panel-online"/,
    /data-testid="psychology-package-settings"/,
  ]) assert.doesNotMatch(pilot.slice(pilot.indexOf('function PsychologySettingsView')), pattern);
});

test('R2B13-S ficha normal fica limitada ao Resumo e Sessões sem ações clínicas/financeiras sintéticas', () => {
  assert.match(chart, /type ChartTab = 'summary' \| 'sessions';/);
  const visibleStart = chart.indexOf('return <div className="fixed inset-0 z-[220]');
  const visibleChart = chart.slice(visibleStart, chart.indexOf('</main>', visibleStart));
  for (const pattern of [/tab === 'records'/, /tab === 'finance'/, /tab === 'packages'/, /tab === 'documents'/, /onRecord=/, /Adicionar cobrança sintética/, /Documento administrativo sintético/]) {
    assert.doesNotMatch(visibleChart, pattern);
  }
});

test('R2B13-S preserva apenas o fluxo público atual de agendamento online', () => {
  assert.match(entrypoint, /const publicBookingMatch = \/\^\\\/agendar\\\//);
  assert.match(publicBooking, /repository\.createBooking\(request\)/);
  assert.match(publicBooking, /data-testid="public-booking-success"/);
  assert.match(management, /runAction\('confirm'\)/);
  assert.match(management, /runAction\('cancel'\)/);
  assert.match(management, /Solicitar reagendamento/);
});
