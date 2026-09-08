import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const messagingSource = fs.readFileSync(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
const onlineBookingSource = fs.readFileSync(new URL('../src/features/psychology-online-booking/PublicBookingSettingsPanel.tsx', import.meta.url), 'utf8');
const reportsSource = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyReportsView.tsx', import.meta.url), 'utf8');

test('R2F3-C1 mantém navegação de Ajustes proporcional por breakpoint', () => {
  assert.match(source, /max-w-\[96rem\]/);
  assert.match(source, /overflow-x-auto[\s\S]*data-testid="psychology-settings-tabs"/);
  assert.match(source, /flex min-w-max gap-1\.5 sm:grid sm:min-w-0 sm:grid-cols-3/);
  assert.match(source, /min-h-\[4\.5rem\] min-w-\[10rem\]/);
  assert.match(source, /sm:min-h-\[5rem\] sm:min-w-0/);
  assert.match(source, /text-xs font-black leading-tight sm:text-sm/);
  assert.match(source, /text-\[11px\] font-semibold leading-snug sm:text-xs/);
  assert.match(source, /border-violet-400 bg-violet-50 text-violet-900 ring-2 ring-violet-100/);
  assert.match(source, /border-slate-200 bg-white text-slate-600 hover:border-violet-200/);
});

test('R2F3-C1 harmoniza headers e conteúdo interno das abas de Ajustes', () => {
  assert.match(source, /flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:p-5/);
  assert.match(source, /text-xl font-black tracking-tight text-slate-950/);
  assert.match(source, /activeTab === 'profile' && <div className="w-full space-y-4"/);
  assert.match(source, /SettingsSummaryCard/);
  assert.match(source, /function AgendaView\(/);
  assert.doesNotMatch(source, /data-testid="psychology-settings-panel-online"/);
  assert.doesNotMatch(source, /data-testid="psychology-settings-panel-messages"/);
});

test('R2F3-C1 usa o eixo amplo de Relatórios em Mensagens e Agendamento Online', () => {
  assert.match(messagingSource, /return <div className="w-full space-y-4"/);
  assert.match(messagingSource, /grid w-full gap-2 sm:mt-0 sm:flex sm:w-auto/);
  assert.match(messagingSource, /grid w-full grid-cols-3 gap-1 rounded-2xl/);
  assert.doesNotMatch(messagingSource, /mx-auto w-full max-w-(?:4xl|5xl|6xl)/);
  assert.match(messagingSource, /border-violet-400 bg-violet-50 text-violet-900/);
  assert.match(onlineBookingSource, /flex flex-col justify-between gap-3 sm:flex-row sm:items-start/);
  assert.match(onlineBookingSource, /text-xl font-black tracking-tight text-slate-950/);
});

test('R2F3-C1 preserva Relatórios como referência sem alterá-lo', () => {
  assert.match(reportsSource, /data-testid="psychology-reports"/);
  assert.match(reportsSource, /rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm/);
  assert.match(reportsSource, /text-xl font-black text-slate-950/);
});
