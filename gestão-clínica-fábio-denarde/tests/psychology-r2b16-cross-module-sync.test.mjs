import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const domain = await import('../src/features/psychology-pilot/psychologyDomain.ts');
const patientList = await import('../src/features/psychology-pilot/psychologyPatientList.ts');
const patientProfile = await import('../src/features/psychology-pilot/psychologyPatientProfile.ts');
const patientDeletion = await import('../src/features/psychology-pilot/psychologyPatientDeletion.ts');
const psychologyR2a = await import('../src/features/psychology-pilot/psychologyR2a.ts');

const {
  createEmptyPsychologyStore,
  createPsychologyScope,
  createPsychologyLocation,
  getPsychologyDayItems,
  getPsychologyPersonalOccurrences,
  normalizePsychologyStore,
  parsePsychologyStore,
  serializePsychologyStore,
  setPsychologyLocationActive,
  updatePsychologyLocation,
  updatePsychologySessionStatus,
  updatePsychologySettings,
  upsertPsychologyPatient,
  upsertPsychologyPersonalCommitment,
  upsertPsychologySession,
} = domain;
const { getPsychologyPatientListViewModels } = patientList;
const { getPsychologyPatientData, getPsychologyPatientSummary } = patientProfile;
const { deletePsychologyPatientLocally } = patientDeletion;
const { locationForSession } = psychologyR2a;

const PILOT_SOURCE = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const FIXED_NOW = '2026-08-24T12:00:00.000Z';
const DATE_A = '2026-08-24';
const DATE_B = '2026-08-27';

function makeMachine() {
  const scope = createPsychologyScope('r2b16-synthetic-professional');
  let store = createEmptyPsychologyStore(scope);
  let persisted = serializePsychologyStore(store);
  return {
    get scope() { return scope; },
    get store() { return store; },
    transition(next) {
      store = next;
      persisted = serializePsychologyStore(store);
      return store;
    },
    reload() {
      store = parsePsychologyStore(persisted, scope);
      return store;
    },
  };
}

function patientInput(name = 'Paciente R2B16', active = true) {
  return {
    name,
    dateOfBirth: '1990-05-10',
    phone: '27999999999',
    email: 'r2b16-patient@example.invalid',
    preferredModality: 'presencial',
    administrativeNote: 'Estado sintético R2B16',
    active,
  };
}

function addPatient(machine, id = 'patient-r2b16-01', name = 'Paciente R2B16', active = true) {
  return machine.transition(upsertPsychologyPatient(machine.store, patientInput(name, active), id, FIXED_NOW));
}

function sessionInput(machine, patientId, overrides = {}) {
  const service = machine.store.services.find(item => item.active) || machine.store.services[0];
  const location = machine.store.locations.find(item => item.active) || machine.store.locations[0];
  return {
    patientId,
    date: DATE_A,
    time: '09:00',
    durationMinutes: service?.defaultDurationMinutes || 50,
    modality: 'presencial',
    serviceId: service?.id,
    locationId: location?.id,
    locationType: location?.type,
    administrativeNote: 'Sessão sintética R2B16',
    ...overrides,
  };
}

function addSession(machine, id, patientId, overrides = {}) {
  return machine.transition(upsertPsychologySession(machine.store, sessionInput(machine, patientId, overrides), id, FIXED_NOW));
}

function assertPatientProjection(store, patientId, expected = {}) {
  const patient = store.patients.find(item => item.id === patientId);
  assert.ok(patient, `patient ${patientId} should exist`);
  const rows = getPsychologyPatientListViewModels(store, [patient], new Date(FIXED_NOW));
  const row = rows.find(item => item.patient.id === patientId);
  const chart = getPsychologyPatientData(store, patientId);
  assert.ok(row && chart, 'list and chart projection must resolve the same patient');
  assert.equal(row.patient.id, chart.patient.id);
  assert.equal(row.patient.name, chart.patient.name);
  assert.equal(row.patient.active, chart.patient.active);
  if (expected.name !== undefined) assert.equal(row.patient.name, expected.name);
  if (expected.active !== undefined) assert.equal(row.patient.active, expected.active);
  return { patient, row, chart };
}

function assertSessionProjection(store, sessionId, expected = {}) {
  const session = store.sessions.find(item => item.id === sessionId);
  assert.ok(session, `session ${sessionId} should exist`);
  const patientData = getPsychologyPatientData(store, session.patientId);
  assert.ok(patientData, 'session patient chart should resolve');
  const chartSession = patientData.sessions.find(item => item.id === sessionId);
  const dayItems = getPsychologyDayItems(store, session.date).filter(item => item.kind === 'session');
  const daySession = dayItems.find(item => item.item.id === sessionId)?.item;
  assert.ok(chartSession && daySession, 'chart, Meu Dia and Agenda projections must resolve the session');
  const agendaSession = store.sessions.find(item => item.id === sessionId);
  for (const projection of [agendaSession, chartSession, daySession]) {
    assert.equal(projection.id, session.id);
    assert.equal(projection.patientId, session.patientId);
    assert.equal(projection.status, session.status);
    assert.equal(projection.modality, session.modality);
    assert.equal(projection.date, session.date);
    assert.equal(projection.time, session.time);
    assert.equal(projection.locationId, session.locationId);
  }
  const summary = getPsychologyPatientSummary(store, session.patientId, new Date(FIXED_NOW));
  if (session.status === 'agendada' && `${session.date}T${session.time}` >= FIXED_NOW.slice(0, 16).replace('T12:00', 'T00:00')) {
    assert.equal(summary?.nextSession?.id, session.id);
  }
  if (expected.status !== undefined) assert.equal(session.status, expected.status);
  if (expected.modality !== undefined) assert.equal(session.modality, expected.modality);
  if (expected.date !== undefined) assert.equal(session.date, expected.date);
  if (expected.time !== undefined) assert.equal(session.time, expected.time);
  return { session, chartSession, daySession, agendaSession, summary };
}

function assertPersonalProjection(store, commitmentId, date, expected = {}) {
  const commitment = store.personalCommitments.find(item => item.id === commitmentId);
  assert.ok(commitment, `personal appointment ${commitmentId} should exist`);
  const agendaPersonal = getPsychologyPersonalOccurrences(store, new Date(`${date}T00:00:00`), new Date(`${date}T23:59:59`))
    .find(item => item.id === commitmentId);
  const dayPersonal = getPsychologyDayItems(store, date).find(item => item.kind === 'personal' && item.item.id === commitmentId)?.item;
  assert.ok(agendaPersonal && dayPersonal, 'Agenda Pessoal, Agenda and Meu Dia must resolve the commitment');
  for (const projection of [commitment, agendaPersonal, dayPersonal]) {
    assert.equal(projection.id, commitment.id);
    assert.equal(projection.time, commitment.time);
    assert.equal(projection.recurrence, commitment.recurrence);
    assert.equal(projection.isDone, commitment.isDone);
  }
  if (expected.time !== undefined) assert.equal(commitment.time, expected.time);
  if (expected.isDone !== undefined) assert.equal(commitment.isDone, expected.isDone);
  if (expected.recurrence !== undefined) assert.equal(commitment.recurrence, expected.recurrence);
  return { commitment, agendaPersonal, dayPersonal };
}

test('R2B16 CENARIO 1 — PATIENT_CROSS_MODULE_STATE', () => {
  const machine = makeMachine();
  addPatient(machine);
  assertPatientProjection(machine.store, 'patient-r2b16-01', { name: 'Paciente R2B16', active: true });
  machine.transition(upsertPsychologyPatient(machine.store, { ...patientInput('Paciente R2B16 Editado'), administrativeNote: 'Atualizado pela ficha' }, 'patient-r2b16-01', FIXED_NOW));
  assertPatientProjection(machine.store, 'patient-r2b16-01', { name: 'Paciente R2B16 Editado', active: true });
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16 Editado', false), 'patient-r2b16-01', FIXED_NOW));
  assertPatientProjection(machine.store, 'patient-r2b16-01', { active: false });
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16 Editado', true), 'patient-r2b16-01', FIXED_NOW));
  machine.reload();
  assertPatientProjection(machine.store, 'patient-r2b16-01', { name: 'Paciente R2B16 Editado', active: true });
});

test('R2B16 CENARIO 2 — SESSION_CREATE_EDIT_CROSS_ENTRY', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'session-r2b16-01', 'patient-r2b16-01', { time: '09:00' });
  assertSessionProjection(machine.store, 'session-r2b16-01', { time: '09:00' });
  addSession(machine, 'session-r2b16-01', 'patient-r2b16-01', { time: '11:30' });
  assertSessionProjection(machine.store, 'session-r2b16-01', { time: '11:30' });
  machine.reload();
  assertSessionProjection(machine.store, 'session-r2b16-01', { time: '11:30' });
});

test('R2B16 CENARIO 3 — SESSION_MODALITY_CROSS_MODULE', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'session-r2b16-02', 'patient-r2b16-01', { modality: 'presencial' });
  const original = machine.store.sessions.find(item => item.id === 'session-r2b16-02');
  assert.ok(original?.locationId);
  addSession(machine, 'session-r2b16-02', 'patient-r2b16-01', { modality: 'online', locationId: original.locationId, locationType: original.locationType });
  const online = machine.store.sessions.find(item => item.id === 'session-r2b16-02');
  assert.equal(online?.modality, 'online');
  assert.equal(online?.locationId, undefined);
  assert.equal(locationForSession(machine.store.settings, online), undefined);
  assert.equal(getPsychologyPatientSummary(machine.store, 'patient-r2b16-01', new Date(FIXED_NOW))?.location, undefined);
  assertSessionProjection(machine.store, 'session-r2b16-02', { modality: 'online' });
  const location = machine.store.locations.find(item => item.active);
  addSession(machine, 'session-r2b16-02', 'patient-r2b16-01', { modality: 'presencial', locationId: location.id, locationType: location.type });
  assert.ok(machine.store.sessions.find(item => item.id === 'session-r2b16-02')?.locationId);
  assertSessionProjection(machine.store, 'session-r2b16-02', { modality: 'presencial' });
});

test('R2B16 CENARIO 4 — SESSION_STATUS_CROSS_MODULE', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'session-r2b16-03', 'patient-r2b16-01');
  machine.transition(updatePsychologySessionStatus(machine.store, 'session-r2b16-03', 'realizada', FIXED_NOW));
  assertSessionProjection(machine.store, 'session-r2b16-03', { status: 'realizada' });
  machine.transition(updatePsychologySessionStatus(machine.store, 'session-r2b16-03', 'cancelada', FIXED_NOW));
  assertSessionProjection(machine.store, 'session-r2b16-03', { status: 'cancelada' });
  machine.reload();
  assertSessionProjection(machine.store, 'session-r2b16-03', { status: 'cancelada' });
});

test('R2B16 CENARIO 5 — NO_STALE_MODAL_ENTITY', () => {
  assert.match(PILOT_SOURCE, /const currentPatientDialog = patientDialog[\s\S]*?store\.patients\.find\(patient => patient\.id === patientDialog\.id\)/);
  assert.match(PILOT_SOURCE, /const currentSessionDialog = sessionDialog[\s\S]*?store\.sessions\.find\(session => session\.id === sessionDialog\.id\)/);
  assert.match(PILOT_SOURCE, /const currentSessionActions = sessionActions[\s\S]*?store\.sessions\.find\(session => session\.id === sessionActions\.id\)/);
  assert.match(PILOT_SOURCE, /const currentRecordDialog = recordDialog[\s\S]*?store\.sessions\.find\(session => session\.id === recordDialog\.id\)/);
});

test('R2B16 CENARIO 6 — FILTERS_AFTER_MUTATION', () => {
  const machine = makeMachine();
  addPatient(machine);
  const active = () => machine.store.patients.filter(item => item.active).map(item => item.id);
  const inactive = () => machine.store.patients.filter(item => !item.active).map(item => item.id);
  assert.deepEqual(active(), ['patient-r2b16-01']);
  assert.deepEqual(inactive(), []);
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16', false), 'patient-r2b16-01', FIXED_NOW));
  assert.deepEqual(active(), []);
  assert.deepEqual(inactive(), ['patient-r2b16-01']);
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16', true), 'patient-r2b16-01', FIXED_NOW));
  assert.deepEqual(active(), ['patient-r2b16-01']);
});

test('R2B16 CENARIO 7 — PERSONAL_APPOINTMENT_CROSS_MODULE', () => {
  const machine = makeMachine();
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, {
    date: DATE_A, time: '15:00', durationMinutes: 30, type: 'Outro', title: 'Compromisso R2B16', note: 'Sintético', recurrence: 'Não repetir', alarmEnabled: false,
  }, 'personal-r2b16-01', FIXED_NOW));
  assertPersonalProjection(machine.store, 'personal-r2b16-01', DATE_A, { time: '15:00', isDone: false });
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, {
    date: DATE_A, time: '16:00', durationMinutes: 30, type: 'Outro', title: 'Compromisso R2B16', note: 'Editado', recurrence: 'Não repetir', alarmEnabled: false,
  }, 'personal-r2b16-01', FIXED_NOW));
  assertPersonalProjection(machine.store, 'personal-r2b16-01', DATE_A, { time: '16:00' });
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, {
    date: DATE_A, time: '16:00', durationMinutes: 30, type: 'Outro', title: 'Compromisso R2B16', note: 'Editado', recurrence: 'Não repetir', alarmEnabled: false, isDone: true,
  }, 'personal-r2b16-01', FIXED_NOW));
  assertPersonalProjection(machine.store, 'personal-r2b16-01', DATE_A, { isDone: true });
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, {
    date: DATE_A, time: '16:00', durationMinutes: 30, type: 'Outro', title: 'Compromisso R2B16', note: 'Editado', recurrence: 'Toda semana', alarmEnabled: false, isDone: false,
  }, 'personal-r2b16-01', FIXED_NOW));
  assertPersonalProjection(machine.store, 'personal-r2b16-01', DATE_A, { recurrence: 'Toda semana', isDone: false });
  machine.transition({ ...machine.store, personalCommitments: machine.store.personalCommitments.filter(item => item.id !== 'personal-r2b16-01') });
  assert.equal(getPsychologyPersonalOccurrences(machine.store, new Date(`${DATE_A}T00:00:00`), new Date(`${DATE_A}T23:59:59`)).length, 0);
  assert.equal(getPsychologyDayItems(machine.store, DATE_A).some(item => item.kind === 'personal'), false);
  machine.reload();
  assert.equal(machine.store.personalCommitments.some(item => item.id === 'personal-r2b16-01'), false);
});

test('R2B16 CENARIO 8 — TEMPORAL_NAVIGATION_STATE', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'session-r2b16-a', 'patient-r2b16-01', { date: DATE_A, time: '09:00' });
  addSession(machine, 'session-r2b16-b', 'patient-r2b16-01', { date: DATE_B, time: '10:00' });
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, { date: DATE_A, time: '14:00', durationMinutes: 30, type: 'Outro', note: 'A', recurrence: 'Não repetir', alarmEnabled: false }, 'personal-a', FIXED_NOW));
  machine.transition(upsertPsychologyPersonalCommitment(machine.store, { date: DATE_B, time: '15:00', durationMinutes: 30, type: 'Outro', note: 'B', recurrence: 'Não repetir', alarmEnabled: false }, 'personal-b', FIXED_NOW));
  const atA = getPsychologyDayItems(machine.store, DATE_A).map(item => item.item.id);
  const atB = getPsychologyDayItems(machine.store, DATE_B).map(item => item.item.id);
  assert.deepEqual(atA.sort(), ['personal-a', 'session-r2b16-a'].sort());
  assert.deepEqual(atB.sort(), ['personal-b', 'session-r2b16-b'].sort());
  assert.equal(atA.includes('session-r2b16-b'), false);
  assert.equal(atB.includes('session-r2b16-a'), false);
});

test('R2B16 CENARIO 9 — ALTERNATE_OPERATION_ORDER', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'sequence-1', 'patient-r2b16-01');
  addSession(machine, 'sequence-1', 'patient-r2b16-01', { time: '10:00' });
  machine.transition(updatePsychologySessionStatus(machine.store, 'sequence-1', 'cancelada', FIXED_NOW));
  assert.equal(machine.store.sessions.find(item => item.id === 'sequence-1')?.status, 'cancelada');
  addSession(machine, 'sequence-2', 'patient-r2b16-01', { time: '11:00' });
  machine.transition(updatePsychologySessionStatus(machine.store, 'sequence-2', 'cancelada', FIXED_NOW));
  addSession(machine, 'sequence-2', 'patient-r2b16-01', { time: '12:00' });
  assert.equal(machine.store.sessions.find(item => item.id === 'sequence-2')?.status, 'agendada');
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16', false), 'patient-r2b16-01', FIXED_NOW));
  machine.transition(upsertPsychologyPatient(machine.store, patientInput('Paciente R2B16', true), 'patient-r2b16-01', FIXED_NOW));
  assertPatientProjection(machine.store, 'patient-r2b16-01', { active: true });
  assertSessionProjection(machine.store, 'sequence-1', { status: 'cancelada', time: '10:00' });
  assertSessionProjection(machine.store, 'sequence-2', { status: 'agendada', time: '12:00' });
});

test('R2B16 CENARIO 10 — FAILURE_RETRY_CROSS_MODULE', async () => {
  const machine = makeMachine();
  addPatient(machine);
  let writes = 0;
  let failNext = true;
  const commit = async next => {
    if (failNext) { failNext = false; throw new Error('synthetic failure'); }
    writes += 1;
    machine.transition(next);
  };
  const next = upsertPsychologySession(machine.store, sessionInput(machine, 'patient-r2b16-01', { time: '13:00' }), 'retry-session', FIXED_NOW);
  await assert.rejects(() => commit(next));
  assert.equal(machine.store.sessions.some(item => item.id === 'retry-session'), false);
  await commit(next);
  assert.equal(writes, 1);
  assertSessionProjection(machine.store, 'retry-session', { time: '13:00' });
});

test('R2B16 CENARIO 11 — OUT_OF_ORDER_RESPONSE_CROSS_MODULE', () => {
  let acceptedVersion = 0;
  let state = { value: 'initial' };
  const accept = (version, next) => {
    if (version <= acceptedVersion) return false;
    acceptedVersion = version;
    state = next;
    return true;
  };
  assert.equal(accept(1, { value: 'old request' }), true);
  assert.equal(accept(2, { value: 'new mutation' }), true);
  assert.equal(accept(1, { value: 'late old response' }), false);
  assert.equal(state.value, 'new mutation');
  assert.match(PILOT_SOURCE, /const requestVersion = \+\+remoteLoadVersion\.current/);
  assert.match(PILOT_SOURCE, /if \(requestVersion !== remoteLoadVersion\.current\) return null/);
  assert.match(PILOT_SOURCE, /const activeMutation = useRef\(false\)/);
});

test('R2B16 CENARIO 12 — ENTRY_POINT_EQUIVALENCE', () => {
  const listMachine = makeMachine();
  const chartMachine = makeMachine();
  addPatient(listMachine, 'same-patient');
  addPatient(chartMachine, 'same-patient');
  addSession(listMachine, 'same-session', 'same-patient', { time: '08:30' });
  addSession(chartMachine, 'same-session', 'same-patient', { time: '08:30' });
  const patientUpdate = { ...patientInput('Paciente equivalente'), administrativeNote: 'Mesmo resultado' };
  listMachine.transition(upsertPsychologyPatient(listMachine.store, patientUpdate, 'same-patient', FIXED_NOW));
  chartMachine.transition(upsertPsychologyPatient(chartMachine.store, patientUpdate, 'same-patient', FIXED_NOW));
  const sessionUpdate = sessionInput(listMachine, 'same-patient', { time: '09:45', modality: 'online', locationId: undefined, locationType: undefined });
  listMachine.transition(upsertPsychologySession(listMachine.store, sessionUpdate, 'same-session', FIXED_NOW));
  chartMachine.transition(upsertPsychologySession(chartMachine.store, sessionUpdate, 'same-session', FIXED_NOW));
  assert.deepEqual(listMachine.store.patients, chartMachine.store.patients);
  assert.deepEqual(listMachine.store.sessions, chartMachine.store.sessions);
});

test('R2B16 INVARIANTS — settings, location, deletion and reload stay canonical', () => {
  const machine = makeMachine();
  addPatient(machine);
  addSession(machine, 'session-invariants', 'patient-r2b16-01');
  const originalLocation = machine.store.locations.find(item => item.active);
  const withSettings = updatePsychologySettings(machine.store, { professionalProfile: { ...machine.store.settings.professionalProfile, displayName: 'Profissional Sintético' } }, FIXED_NOW);
  machine.transition(withSettings);
  assert.equal(machine.store.settings.professionalProfile.displayName, 'Profissional Sintético');
  assert.equal(machine.store.services, machine.store.settings.services);
  assert.equal(machine.store.locations, machine.store.settings.locations);
  const renamed = updatePsychologyLocation(machine.store, originalLocation.id, { displayName: 'Local Sintético Atualizado' }, FIXED_NOW);
  machine.transition(renamed);
  assert.equal(machine.store.settings.locations.find(item => item.id === originalLocation.id)?.displayName, 'Local Sintético Atualizado');
  const disabled = setPsychologyLocationActive(machine.store, originalLocation.id, false, FIXED_NOW);
  machine.transition(disabled);
  assert.equal(machine.store.locations.find(item => item.id === originalLocation.id)?.active, false);
  const deletion = deletePsychologyPatientLocally(machine.store, 'patient-r2b16-01', FIXED_NOW);
  machine.transition(deletion.store);
  assert.equal(machine.store.patients.some(item => item.id === 'patient-r2b16-01'), false);
  assert.equal(machine.store.sessions.some(item => item.patientId === 'patient-r2b16-01'), false);
  assert.equal(getPsychologyPatientData(machine.store, 'patient-r2b16-01'), null);
  machine.reload();
  assert.equal(machine.store.patients.some(item => item.id === 'patient-r2b16-01'), false);
  assert.deepEqual(normalizePsychologyStore(machine.store, machine.scope), machine.store);
});

test('R2B16 STATIC — all cross-module projections depend on canonical store slices', () => {
  assert.match(PILOT_SOURCE, /const patientMap = useMemo\(.*store\.patients/s);
  assert.match(PILOT_SOURCE, /const dayItems = useMemo\(.*store/s);
  assert.match(PILOT_SOURCE, /const agendaPersonalOccurrences = useMemo\(.*store/s);
  assert.match(PILOT_SOURCE, /const visiblePatients = useMemo\(.*store\.patients/s);
  assert.match(PILOT_SOURCE, /const daySessions = useMemo\(.*store\.sessions/s);
  assert.match(PILOT_SOURCE, /const agendaSessions = useMemo\(.*store\.sessions/s);
  assert.match(PILOT_SOURCE, /setLocalStore\(next\)/);
  assert.match(PILOT_SOURCE, /window\.localStorage\.setItem\(.*serialized/s);
});
