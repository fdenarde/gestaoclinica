import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createEmptyGooglePhotosAlbumCard } from '../shared/googlePhotosAlbums.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { location: { hostname: 'localhost' }, sessionStorage: storage, localStorage: storage,
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, confirm: () => false };
globalThis.document = { getElementById: () => null };
let fixture; const calls = [];
mock.module('../src/components/Common/PatientPhoto.tsx', { exports: { default: () => null } });
mock.module('../src/components/Common/Modal.tsx', { exports: { default: ({ isOpen, title, children }) => isOpen
  ? React.createElement('section', { role: 'dialog', 'aria-label': title }, children) : null } });
mock.module('../src/components/Common/Toast.tsx', { exports: { showToast() {} } });
mock.module('../src/lib/googlePhotosAlbumsApi.ts', { exports: {
  listGooglePhotosAlbumPatientOptions: async () => [fixture.patient],
  listGooglePhotosAlbumSessionOptions: async () => fixture.sessions,
  listGooglePhotosAlbums: async () => { if (fixture.failRead) throw Error('offline'); return fixture.response; },
  prepareGooglePhotosAlbumReopen: async input => { calls.push(['prepare', structuredClone(input)]); return { reopenToken: 'offline-intent', existing: null }; },
  createGooglePhotosAlbum: async input => {
    calls.push(['create', structuredClone(input)]);
    const album = { ...createEmptyGooglePhotosAlbumCard(input), ...input,
      url: 'https://photos.google.com/lr/album/offline-ui', providerAlbumId: 'offline-album' };
    return { ...fixture.response, albums: [album], createdAlbum: { id: 'offline-album', productUrl: album.url,
      title: input.title, idempotent: false, recreationAvailable: false, recreated: false } };
  },
  saveGooglePhotosAlbumPackage: async () => assert.fail('save não esperado'),
} });
mock.module('../src/lib/activityRecordsApi.ts', { exports: {
  getActivityRecordErrorMessage: error => error.message,
  getProfessionalActivityGallery: async () => ({ monitoringStart: '2025-01-01', items: [{ sessions: fixture.sessions.map(session => ({
    ...session, mediaCount: 0, state: fixture.justification ? 'excused' : 'absence', justification: fixture.justification || null,
  })) }] }),
  removeActivitySessionNoMediaJustification: async () => assert.fail('motivo não pode mudar'),
  saveActivitySessionNoMediaJustification: async () => assert.fail('motivo não pode mudar'),
} });
const { default: Gallery } = await import('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join(' ').replace(/\s+/g, ' ').trim();
const button = (view, label) => view.root.findAllByType('button').find(node => text(node) === label);
function setup({ status = 'Falta', album = false, failRead = false, justification = null } = {}) {
  calls.length = 0;
  const patient = { id: 'patient-fixture', name: 'Atendido fictício', status: 'Ativo', packageTolerances: [] };
  const session = { id: 'session-fixture', patientId: patient.id, date: '2026-01-03', time: '10:00', status,
    consumesPackage: true, packageConsumptionDecisionRecorded: true, type: 'Sessão simples (50 min)' };
  const card = { ...createEmptyGooglePhotosAlbumCard({ patientId: patient.id, packageNumber: 1, activityDate: session.date,
    sessionTime: session.time, sessionIds: [session.id], title: 'Atividade de Intervenção' }), url: 'https://photos.google.com/lr/album/existing' };
  fixture = { patient, sessions: [session], failRead, justification,
    response: { albums: album ? [card] : [], ownerUserId: 'owner-fixture', packageKey: 'patient-fixture__package_1', packageNumber: 1,
      permissions: { canView: true, canCreate: true, canEdit: true, canHide: true, canReactivate: true, canRemove: true }, scope: 'manage' } };
}
async function mount() {
  let view;
  await act(async () => { view = create(React.createElement(Gallery, { patients: [fixture.patient], sessions: fixture.sessions,
    payments: [], currentUserName: 'Equipe fictícia', initialPatientId: fixture.patient.id,
    onUpdate: async () => assert.fail('sessão não pode ser atualizada') })); });
  await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  return view;
}
test('ausência abre confirmação com data/horário; cancelar não chama criação nem preparação', async () => {
  setup(); const view = await mount(); assert.ok(button(view, 'Reabrir álbum'));
  const before = structuredClone(fixture.sessions);
  await act(async () => button(view, 'Reabrir álbum').props.onClick());
  const dialog = view.root.findByProps({ role: 'dialog' });
  assert.equal(dialog.props['aria-label'], 'Reabrir criação do álbum?');
  assert.match(text(dialog), /03\/01\/2026/); assert.match(text(dialog), /10:00/);
  assert.match(text(dialog), /O status da sessão e o motivo atual não serão alterados/);
  await act(async () => button(view, 'Cancelar').props.onClick());
  assert.equal(view.root.findAllByProps({ role: 'dialog' }).length, 0); assert.deepEqual(calls, []);
  assert.deepEqual(fixture.sessions, before); await act(async () => view.unmount());
});
test('confirmar chama preparação e o mesmo createGooglePhotosAlbum com sessão/paciente/data intactos', async () => {
  setup(); const before = structuredClone(fixture.sessions); const view = await mount();
  await act(async () => button(view, 'Reabrir álbum').props.onClick());
  await act(async () => button(view, 'Abrir criação do álbum').props.onClick());
  assert.deepEqual(calls.map(call => call[0]), ['prepare', 'create']);
  const payload = calls[1][1]; assert.equal(payload.creationIntent, 'explicit-session-reopen');
  assert.equal(payload.reopenToken, 'offline-intent'); assert.equal(payload.patientId, fixture.patient.id);
  assert.equal(payload.activityDate, fixture.sessions[0].date); assert.deepEqual(payload.sessionIds, ['session-fixture']);
  assert.deepEqual(fixture.sessions, before); assert.equal(button(view, 'Reabrir álbum'), undefined);
  assert.ok(view.root.findAllByType('a').some(node => text(node).startsWith('Abrir álbum')));
  await act(async () => view.unmount());
});
for (const [label, options] of [['álbum de ausência existente', { album: true }], ['álbum normal existente', { status: 'Realizada', album: true }],
  ['contexto normal', { status: 'Realizada' }], ['leitura incompleta', { failRead: true }]]) {
  test(`${label}: nova exceção não aparece`, async () => { setup(options); const view = await mount();
    assert.equal(button(view, 'Reabrir álbum'), undefined); assert.deepEqual(calls, []);
    if (options.album) assert.ok(view.root.findAllByType('a').some(node => text(node).startsWith('Abrir álbum')));
    await act(async () => view.unmount());
  });
}
test('justificativa ativa mostra exceção e preserva regra comum oculta', async () => {
  setup({ status: 'Realizada', justification: { active: true, reason: 'other', note: 'Motivo fictício' } });
  const view = await mount(); assert.ok(button(view, 'Reabrir álbum'));
  assert.ok(view.root.findAllByType('button').filter(node => text(node) === 'Criar álbum no Google Fotos').every(node => node.props.disabled));
  await act(async () => view.unmount());
});
