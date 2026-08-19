import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const agendaSource = fs.readFileSync(new URL('../src/components/Agenda.tsx', import.meta.url), 'utf8');
const dashboardSource = fs.readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
const monitoringSource = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
const typesSource = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');

test('razões expandidas preservam códigos legados e não criam migração', () => {
  const expectedCodes = [
    'notice_in_advance',
    'late_notice',
    'same_day_cancellation',
    'no_show_without_notice',
    'health_issue',
    'family_emergency',
    'transportation_issue',
    'school_commitment',
    'professional_commitment',
    'travel',
    'schedule_conflict',
    'online_technical_issue',
    'professional_absence',
    'clinic_cancellation',
    'prior_agreement',
    'exceptionally_justified',
    'reason_not_informed',
    'other',
  ];
  for (const code of expectedCodes) {
    assert.match(typesSource, new RegExp(`'${code}'`));
    assert.match(agendaSource, new RegExp(`code: '${code}'`));
  }
  assert.match(agendaSource, /reasonOption\?\.requiresObservation !== false/);
  assert.doesNotMatch(agendaSource, /migrat|onSnapshot\s*\(/i);
});

test('AUD-001 diferencia consumo verdadeiro, falso e legado na Agenda', () => {
  assert.match(agendaSource, /session\.consumesPackage === true/);
  assert.match(agendaSource, /Sessão não consumida do pacote/);
  assert.match(agendaSource, /Falta sem decisão de pacote/);
  assert.match(agendaSource, /getSessionPresentationStatus\(session\)/);
});

test('AUD-002 e AUD-003 usam consumo canônico e status de apresentação nos painéis', () => {
  assert.match(dashboardSource, /sessionConsumesPackage/);
  assert.match(dashboardSource, /SessionStatus\.LATE_CANCELLATION_NO_REPLACEMENT/);
  assert.match(dashboardSource, /getSessionPresentationStatus\(session\)/);
  assert.match(monitoringSource, /getSessionPresentationStatus as getCanonicalSessionPresentationStatus/);
  assert.match(monitoringSource, /getMonitoringSessionPresentationStatus\(session\)/);
  assert.doesNotMatch(monitoringSource, />\{session\.status\}</);
  assert.doesNotMatch(monitoringSource, /\{session\.status \|\| 'Agendada'\}/);
});
