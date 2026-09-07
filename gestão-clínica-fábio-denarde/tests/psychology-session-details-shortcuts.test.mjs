import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pilot = await readFile('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
const sessionModal = pilot.slice(pilot.indexOf('function SessionActionsDialog'), pilot.indexOf('function EmptyState'));

test('Detalhes da sessão resolve os três atalhos pelo patientId e preserva os bloqueios existentes', () => {
  for (const label of ['Acesso rápido', 'Ficha do Paciente', 'Prontuário', 'Financeiro']) assert.match(sessionModal, new RegExp(label));
  assert.match(sessionModal, /sm:grid-cols-3/);
  assert.match(sessionModal, /disabled=\{!patient\}/);
  assert.match(sessionModal, /disabled=\{!patient \|\| readOnly\}/);
  assert.match(pilot, /patientMap\.get\(sessionActions\.patientId\)/);
  assert.match(pilot, /setPatientChartInitialTab\('summary'\)/);
  assert.match(pilot, /setPatientChartInitialTab\('finance'\)/);
  assert.match(pilot, /openClinicalRecord\(patient\)/);
  for (const action of ['Editar \/ reagendar', 'Marcar realizada', 'Marcar falta', 'Cancelar sessão', 'Fechar']) assert.match(sessionModal, new RegExp(action));
  assert.doesNotMatch(pilot, /whatsapp-simulation/);
});
