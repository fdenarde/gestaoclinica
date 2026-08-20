import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyPsychologyStore,
  createPsychologyCharge,
  createPsychologyPayment,
  createPsychologyScope,
  renamePsychologyLocation,
  restorePsychologyDefaultColors,
  setPsychologyCategoryColor,
  upsertPsychologyPatient,
  upsertPsychologySession,
  type PsychologyPatientInput,
} from '../src/features/psychology-pilot/psychologyDomain.ts';
import {
  PSYCHOLOGY_COLOR_DEFAULTS,
  PSYCHOLOGY_LOCATION_IDS,
  agendaCategoryForSession,
  normalizePsychologySettings,
} from '../src/features/psychology-pilot/psychologyR2a.ts';

const patientInput: PsychologyPatientInput = {
  name: 'Paciente Sintético R2A1',
  birthDate: '1990-01-01',
  phone: '(27) 99999-0000',
  email: '',
  preferredModality: 'online',
  administrativeNote: '',
  active: true,
};

test('R2A1 mantém categorias novas e não cria Reunião', () => {
  const scope = createPsychologyScope('professional-r2a1');
  const store = createEmptyPsychologyStore(scope);
  assert.deepEqual(store.settings.locations.map(location => location.type), ['PRIMARY_OFFICE', 'EXTERNAL_OFFICE']);
  assert.deepEqual(store.settings.colors, PSYCHOLOGY_COLOR_DEFAULTS);
  assert.equal(store.settings.locations.find(location => location.id === PSYCHOLOGY_LOCATION_IDS.primary)?.displayName, 'Shopping Moxuara');
  assert.equal(agendaCategoryForSession({ modality: 'online' }), 'ONLINE');
  assert.equal(agendaCategoryForSession({ modality: 'presencial' }), 'PRESENTIAL_PRIMARY');
  assert.equal(agendaCategoryForSession({ modality: 'presencial', locationType: 'EXTERNAL_OFFICE' }), 'EXTERNAL_OFFICE');
});

test('nomes de locais são editáveis sem alterar a categoria interna', () => {
  const scope = createPsychologyScope('professional-r2a1');
  const store = createEmptyPsychologyStore(scope);
  const renamed = renamePsychologyLocation(store, 'PRIMARY_OFFICE', 'Clínica Central');
  const location = renamed.locations.find(item => item.id === PSYCHOLOGY_LOCATION_IDS.primary);
  assert.equal(location?.displayName, 'Clínica Central');
  assert.equal(location?.type, 'PRIMARY_OFFICE');
  assert.equal(renamed.settings.locations.find(item => item.id === PSYCHOLOGY_LOCATION_IDS.primary)?.displayName, 'Clínica Central');
});

test('cores personalizadas têm fallback seguro e restauram os cinco defaults', () => {
  const scope = createPsychologyScope('professional-r2a1');
  const store = createEmptyPsychologyStore(scope);
  const custom = setPsychologyCategoryColor(store, 'ONLINE', '#123456');
  assert.equal(custom.settings.colors.ONLINE, '#123456');
  const invalid = setPsychologyCategoryColor(custom, 'ONLINE', 'not-a-color');
  assert.equal(invalid.settings.colors.ONLINE, PSYCHOLOGY_COLOR_DEFAULTS.ONLINE);
  const restored = restorePsychologyDefaultColors(custom);
  assert.deepEqual(restored.settings.colors, PSYCHOLOGY_COLOR_DEFAULTS);
});

test('settings de outro profissional não entram silenciosamente no escopo atual', () => {
  const current = createPsychologyScope('professional-current');
  const foreign = createPsychologyScope('professional-foreign');
  const foreignSettings = createEmptyPsychologyStore(foreign).settings;
  const normalized = normalizePsychologySettings(foreignSettings, current);
  assert.equal(normalized.scope.professionalId, 'professional-current');
  assert.equal(normalized.locations[0].displayName, 'Shopping Moxuara');
});

test('Charge e Payment são contratos separados e escopados', () => {
  const scope = createPsychologyScope('professional-r2a1');
  let store = createEmptyPsychologyStore(scope);
  store = upsertPsychologyPatient(store, patientInput, 'patient-r2a1');
  store = upsertPsychologySession(store, { patientId: 'patient-r2a1', date: '2026-08-13', time: '09:00', durationMinutes: 50, modality: 'online', administrativeNote: '' }, 'session-r2a1');
  store = createPsychologyCharge(store, { patientId: 'patient-r2a1', sessionId: 'session-r2a1', description: 'Sessão sintética', amount: 150, dueDate: '2026-08-13', createdBy: 'teste' });
  assert.equal(store.charges.length, 1);
  assert.equal(store.charges[0].status, 'pending');
  store = createPsychologyPayment(store, { chargeId: store.charges[0].id, patientId: 'patient-r2a1', sessionId: 'session-r2a1', amount: 75, date: '2026-08-13', method: 'PIX', createdBy: 'teste' });
  assert.equal(store.payments.length, 1);
  assert.equal(store.payments[0].chargeId, store.charges[0].id);
  assert.equal(store.payments[0].context, 'PSICOLOGIA');
});

test('registro clínico permanece separado do agregado administrativo', () => {
  const scope = createPsychologyScope('professional-r2a1');
  const store = createEmptyPsychologyStore(scope);
  assert.ok(!('sessionRecords' in store.patients));
  assert.ok('sessionRecords' in store);
});
