import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { auth } from '../src/firebase.ts';
import { listActivityMediaPresence } from '../src/lib/activityRecordsApi.ts';
import { selectActivityCandidateSessions } from '../src/lib/activityRefreshPlan.ts';
import { loadUnregisteredActivities } from '../src/lib/unregisteredActivities.ts';
import {
  ACTIVITY_REGISTRATION_STATE,
  buildUnregisteredActivityGroups,
  classifyActivityRegistration,
} from '../shared/unregisteredActivities.js';

const NOW = new Date('2026-09-20T12:00:00-03:00');

function fixtureState(suffix = 'base', sessionChanges = {}) {
  const patientId = `fixture-patient-${suffix}`;
  const sessionId = `fixture-session-${suffix}`;
  return {
    patients: [{ id: patientId, name: 'Paciente fictício', status: 'Ativo', packageTolerances: [] }],
    sessions: [{
      id: sessionId,
      patientId,
      date: '2026-09-10',
      time: '10:00',
      type: 'Sessão simples (50 min)',
      status: 'Realizada',
      packageNumber: 1,
      ...sessionChanges,
    }],
    payments: [],
    settings: { activityMediaMonitoringStart: '2026-09-01' },
  };
}

function groupFixture(overrides = {}) {
  const state = fixtureState('group');
  return {
    patients: state.patients,
    sessions: state.sessions,
    payments: [],
    activityRecords: [],
    activityUploadStatus: [],
    googlePhotosAlbums: [],
    monitoringStart: '2026-09-01',
    now: NOW,
    mediaReadComplete: true,
    isAlbumReadComplete: () => true,
    ...overrides,
  };
}

async function withFixtureAuthAndFetch(fetchFixture, action) {
  await auth.authStateReady?.();
  const previousFetch = globalThis.fetch;
  const previousUser = Object.getOwnPropertyDescriptor(auth, 'currentUser');
  Object.defineProperty(auth, 'currentUser', {
    configurable: true,
    value: { uid: 'fixture-admin', getIdToken: async () => 'fixture-token' },
  });
  globalThis.fetch = fetchFixture;
  try {
    return await action();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUser) Object.defineProperty(auth, 'currentUser', previousUser);
    else delete auth.currentUser;
  }
}

function readResponseFor(state, { media = false, justification = false, incomplete = false } = {}) {
  const session = state.sessions[0];
  const statusRecord = media || justification ? [{
    sessionId: session.id,
    patientId: session.patientId,
    hasMedia: media,
    mediaCount: media ? 1 : 0,
    justification: justification ? { active: true, reason: 'other', note: 'Justificativa fictícia.' } : null,
  }] : [];
  return incomplete
    ? { sessionIds: [], documentsRead: 1 }
    : { sessionIds: media ? [session.id] : [], statusRecords: statusRecord, documentsRead: 1 };
}

function mockReadFetch(state, { presence, albums, albumError = false, presenceError = false } = {}) {
  return async (url, init) => {
    if (String(url).startsWith('/api/activity-records')) {
      assert.equal(init.method, 'POST');
      assert.equal(JSON.parse(String(init.body)).action, 'listActivityMediaPresence');
      if (presenceError) return new Response(JSON.stringify({ error: { code: 'fixture/read-error' } }), { status: 500 });
      return new Response(JSON.stringify(presence || readResponseFor(state)), { status: 200 });
    }
    assert.match(String(url), /^\/api\/google-photos-albums\?/u);
    assert.equal(init.method, 'GET');
    if (albumError) return new Response(JSON.stringify({ error: { code: 'fixture/album-error' } }), { status: 500 });
    return new Response(JSON.stringify({
      albums: albums || [],
      packageNumber: 1,
      scope: 'manage',
    }), { status: 200 });
  };
}

test('somente a falta confirmada de atividade aparece como pendência', () => {
  assert.equal(classifyActivityRegistration({ mediaReadComplete: true, albumReadComplete: true }), ACTIVITY_REGISTRATION_STATE.CONFIRMED_UNREGISTERED);
  assert.equal(buildUnregisteredActivityGroups(groupFixture()).length, 1);
  assert.equal(buildUnregisteredActivityGroups(groupFixture({
    activityRecords: [{ id: 'fixture-record', patientId: 'fixture-patient-group', sessionId: 'fixture-session-group', status: 'active' }],
  })).length, 0);
});

test('mídia presente, link válido e justificativa ativa são registros confirmados', () => {
  assert.equal(classifyActivityRegistration({ hasActivityRecord: true }), ACTIVITY_REGISTRATION_STATE.CONFIRMED_REGISTERED);
  assert.equal(classifyActivityRegistration({ hasGooglePhotosLink: true }), ACTIVITY_REGISTRATION_STATE.CONFIRMED_REGISTERED);
  assert.equal(classifyActivityRegistration({ hasActiveJustification: true }), ACTIVITY_REGISTRATION_STATE.CONFIRMED_REGISTERED);
  assert.equal(buildUnregisteredActivityGroups(groupFixture({
    googlePhotosAlbums: [{ patientId: 'fixture-patient-group', packageNumber: 1, sessionIds: ['fixture-session-group'], status: 'active', url: 'https://photos.google.com/share/fixture' }],
  })).length, 0);
  assert.equal(buildUnregisteredActivityGroups(groupFixture({
    activityUploadStatus: [{ patientId: 'fixture-patient-group', sessionId: 'fixture-session-group', justification: { active: true, reason: 'other' } }],
  })).length, 0);
});

test('loading, timeout, erro e fonte não consultada ficam UNKNOWN', () => {
  for (const source of ['loading', 'timeout', 'error', 'unloaded']) {
    assert.equal(classifyActivityRegistration({ mediaReadComplete: false, albumReadComplete: true }), ACTIVITY_REGISTRATION_STATE.UNKNOWN, source);
    assert.equal(buildUnregisteredActivityGroups(groupFixture({ mediaReadComplete: false })).length, 0, source);
  }
  assert.equal(buildUnregisteredActivityGroups(groupFixture({ isAlbumReadComplete: () => false })).length, 0);
  assert.equal(buildUnregisteredActivityGroups(groupFixture({ mediaReadComplete: false, isAlbumReadComplete: () => false })).length, 0);
});

test('ausência canônica com status Realizada não entra no selector nem na pendência', () => {
  const state = fixtureState('absence', { noReplacementReasonCode: 'other', noReplacementObservation: 'Observação fictícia.' });
  assert.equal(selectActivityCandidateSessions(state).length, 0);
  assert.equal(buildUnregisteredActivityGroups(groupFixture({ patients: state.patients, sessions: state.sessions })).length, 0);
});

test('realizada sem mídia com justificativa explícita continua fora da pendência', () => {
  const status = { patientId: 'fixture-patient-group', sessionId: 'fixture-session-group', hasMedia: false, mediaCount: 0, justification: { active: true, reason: 'other', note: 'Fictício.' } };
  assert.equal(buildUnregisteredActivityGroups(groupFixture({ activityUploadStatus: [status] })).length, 0);
});

test('loader confirma pendência apenas após respostas completas', async () => {
  const state = fixtureState('complete');
  await withFixtureAuthAndFetch(mockReadFetch(state), async () => {
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 1);
    assert.equal(result.warning, '');
  });
});

test('presença de mídia confirmada no POST remove a pendência', async () => {
  const state = fixtureState('media-present');
  await withFixtureAuthAndFetch(mockReadFetch(state, { presence: readResponseFor(state, { media: true }) }), async () => {
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 0);
    assert.equal(result.warning, '');
  });
});

test('falha de álbum não vira lista vazia confirmada', async () => {
  const state = fixtureState('album-error');
  await withFixtureAuthAndFetch(mockReadFetch(state, { albumError: true }), async () => {
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 0);
    assert.match(result.warning, /Não foi possível confirmar/u);
  });
});

test('timeout do álbum não é interpretado como sem mídia', async () => {
  const state = fixtureState('album-timeout');
  await withFixtureAuthAndFetch(async (url, init) => {
    if (String(url).startsWith('/api/google-photos-albums')) {
      throw Object.assign(new Error('timeout fictício'), { code: 'google-photos-albums/timeout' });
    }
    return mockReadFetch(state)(url, init);
  }, async () => {
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 0);
    assert.match(result.warning, /Não foi possível confirmar/u);
  });
});

test('resposta incompleta do álbum permanece desconhecida', async () => {
  const state = fixtureState('album-incomplete');
  await withFixtureAuthAndFetch(mockReadFetch(state, { albums: [] }), async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('/api/google-photos-albums')) return new Response(JSON.stringify({ packageNumber: 1, scope: 'manage' }), { status: 200 });
      return previousFetch(url, init);
    };
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 0);
    assert.match(result.warning, /Não foi possível confirmar/u);
  });
});

test('falha em um pacote não esconde pendência confirmada em outro', async () => {
  const first = fixtureState('complete-scope');
  const second = fixtureState('unknown-scope');
  const state = { ...first, patients: [...first.patients, ...second.patients], sessions: [...first.sessions, ...second.sessions] };
  await withFixtureAuthAndFetch(async (url, init) => {
    if (String(url).startsWith('/api/activity-records')) {
      return new Response(JSON.stringify({ sessionIds: [], statusRecords: [], documentsRead: 2 }), { status: 200 });
    }
    const patientId = new URL(String(url), 'http://localhost').searchParams.get('patientId');
    if (patientId === second.patients[0].id) return new Response(JSON.stringify({ error: { code: 'fixture/album-error' } }), { status: 500 });
    assert.equal(init.method, 'GET');
    return new Response(JSON.stringify({ albums: [], packageNumber: 1, scope: 'manage' }), { status: 200 });
  }, async () => {
    const result = await loadUnregisteredActivities(state, { force: true, now: NOW });
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].patientId, first.patients[0].id);
    assert.match(result.warning, /Não foi possível confirmar/u);
  });
});

test('erro de presença não produz pendência e resposta incompleta é recusada', async () => {
  const state = fixtureState('presence-error');
  await withFixtureAuthAndFetch(mockReadFetch(state, { presenceError: true }), async () => {
    await assert.rejects(loadUnregisteredActivities(state, { force: true, now: NOW }));
  });
  const incompleteState = fixtureState('incomplete');
  await withFixtureAuthAndFetch(mockReadFetch(incompleteState, { presence: readResponseFor(incompleteState, { incomplete: true }) }), async () => {
    await assert.rejects(loadUnregisteredActivities(incompleteState, { force: true, now: NOW }), error => error.code === 'activity-records/incomplete-presence');
  });
});

test('timeout de presença interrompe a classificação', async t => {
  const state = fixtureState('timeout');
  let signal;
  await withFixtureAuthAndFetch(async (url, init) => {
    if (String(url).startsWith('/api/google-photos-albums')) return mockReadFetch(state)(url, init);
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture aborted'), { name: 'AbortError' })));
    });
  }, async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const request = loadUnregisteredActivities(state, { force: true, now: NOW });
      for (let index = 0; index < 30 && !signal; index += 1) await Promise.resolve();
      assert.ok(signal);
      t.mock.timers.tick(20_000);
      await assert.rejects(request, error => error.code === 'activity-records/read-timeout');
      assert.equal(signal.aborted, true);
    } finally {
      t.mock.timers.reset();
    }
  });
});

test('Dashboard e notificações não exibem resultados anteriores durante loading/erro', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(app, /setUnregisteredActivitiesLoading\(true\);\s*setUnregisteredActivities\(\[\]\);/u);
  assert.match(app, /catch \{\s*setUnregisteredActivities\(\[\]\);/u);
  assert.match(app, /unregisteredActivitiesSignature === activityRefreshSignature\s*\? unregisteredActivities\s*:\s*\[\]/u);
  assert.match(app, /const activityAttentionCount = visibleUnregisteredActivities\.length/u);
  assert.match(app, /unregisteredActivities=\{visibleUnregisteredActivities\}/u);
  assert.match(dashboard, /!unregisteredActivitiesLoading && unregisteredActivities\.length > 0/u);
});
