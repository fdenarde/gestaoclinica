import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGooglePhotosAlbumReopen, createGooglePhotosAlbumForPackage, saveGooglePhotosAlbumPackage } from '../api/_lib/googlePhotosAlbumsRepository.js';
import { canReopenSessionAlbum, EXPLICIT_ALBUM_REOPEN } from '../shared/googlePhotosAlbumReopen.js';
import { buildGooglePhotosAlbumGroupKey, GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION } from '../shared/googlePhotosAlbums.js';
import { isActivityMediaSelectableSession } from '../shared/activityMediaPackages.js';

// Infrastructure only is replaced. Both preparation and creation run the real repository.
class FakeDb {
  store = new Map(); writes = []; lock = Promise.resolve();
  doc(path) {
    const db = this;
    return { path, id: path.split('/').at(-1),
      async get() { const value = db.store.get(path); return { id: this.id, exists: value !== undefined, data: () => value }; },
      async set(value, options) { db.write(path, value, options); },
    };
  }
  write(path, value, options) { this.store.set(path, options?.merge ? { ...this.store.get(path), ...value } : value); this.writes.push(path); }
  collection(path) {
    const db = this; let condition; let cap = Infinity;
    const query = { doc: id => db.doc(`${path}/${id}`), where(field, op, value) { assert.equal(op, '=='); condition = [field, value]; return query; },
      limit(value) { cap = value; return query; }, async get() {
        const entries = [...db.store].filter(([key, value]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')
          && (!condition || value[condition[0]] === condition[1])).slice(0, cap);
        return { docs: await Promise.all(entries.map(([key]) => db.doc(key).get())) };
      } };
    return query;
  }
  async runTransaction(action) {
    const previous = this.lock; let release; this.lock = new Promise(resolve => { release = resolve; }); await previous;
    const writes = [];
    try { const result = await action({ get: ref => ref.get(), set: (ref, value, options) => writes.push([ref.path, value, options]) });
      writes.forEach(args => this.write(...args)); return result;
    } finally { release(); }
  }
}
const context = { ownerUserId: 'owner-fixture', userId: 'actor-fixture', actorName: 'Equipe fictícia', role: 'admin', activeContext: 'internal' };
const root = `users/${context.ownerUserId}`;
const absence = { id: 'session-a', patientId: 'patient-a', date: '2026-01-03', time: '10:00', status: 'Falta',
  consumesPackage: true, packageConsumptionDecisionRecorded: true, noReplacementReasonCode: 'other', noReplacementReasonText: 'Motivo fictício', noReplacementObservation: 'Preservar' };
function setup(session = absence) {
  const db = new FakeDb();
  db.store.set(`${root}/patients/patient-a`, { name: 'Atendido fictício' });
  db.store.set(`${root}/sessions/${session.id}`, { ...session });
  const input = { patientId: 'patient-a', packageNumber: 1, sessionIds: [session.id], activityDate: session.date,
    sessionGroupKey: buildGooglePhotosAlbumGroupKey({ patientId: 'patient-a', activityDate: session.date, sessionIds: [session.id] }),
    title: 'Álbum da sessão', category: 'Atividade de Intervenção', observation: '', publishedAt: session.date };
  let providerCalls = 0;
  const options = { db, createAlbum: async ({ title }) => { providerCalls++; return { id: 'album-fixture', productUrl: 'https://photos.google.com/lr/album/offline-fixture', title }; } };
  return { db, input, options, calls: () => providerCalls };
}
const invalid = error => error.statusCode === 409 && error.code === 'google-photos-albums/invalid-session-binding';
async function authorized(f) {
  const input = { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN };
  const result = await prepareGooglePhotosAlbumReopen(context, input, { db: f.db });
  return { ...input, reopenToken: result.reopenToken };
}

test('elegibilidade comum de ausência e criação sem intent continuam bloqueadas (409)', async () => {
  const f = setup(); assert.equal(isActivityMediaSelectableSession(absence), false);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, f.input, f.options), invalid);
  assert.equal(f.calls(), 0); assert.equal(f.db.writes.length, 0);
});
test('intent declarativo sem autorização emitida pelo servidor não basta', async () => {
  const f = setup(); await assert.rejects(createGooglePhotosAlbumForPackage(context, { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN }, f.options), invalid);
  assert.equal(f.calls(), 0);
});
test('exceção autorizada cria pelo repositório real e mantém sessão, motivo, ausência, data e paciente', async () => {
  const f = setup(); const before = structuredClone(f.db.store.get(`${root}/sessions/session-a`));
  const result = await createGooglePhotosAlbumForPackage(context, await authorized(f), f.options);
  assert.equal(f.calls(), 1); assert.equal(result.albums[0].patientId, f.input.patientId);
  assert.deepEqual(result.albums[0].sessionIds, f.input.sessionIds); assert.equal(result.albums[0].activityDate, f.input.activityDate);
  assert.deepEqual(f.db.store.get(`${root}/sessions/session-a`), before);
  assert.ok(f.db.writes.every(path => !/\/(sessions|patients|payments|activityUploadStatus)\//.test(path)));
  assert.equal([...f.db.store.keys()].filter(path => path.startsWith(root + '/sessions/')).length, 1);
});
for (const [label, patch] of [
  ['sessão inexistente', { sessionIds: ['missing'] }], ['ID adulterado', { sessionIds: ['session-a/other'] }],
  ['data divergente', { activityDate: '2026-01-04' }], ['grupo adulterado', { sessionGroupKey: 'forged' }],
  ['pacote divergente', { packageNumber: 2 }], ['IDs repetidos', { sessionIds: ['session-a', 'session-a'] }],
]) test(`${label} falha fechado na preparação`, async () => {
  const f = setup(); await assert.rejects(prepareGooglePhotosAlbumReopen(context, { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN, ...patch }, { db: f.db }), invalid);
  assert.equal(f.calls(), 0); assert.equal(f.db.writes.length, 0);
});
test('sessão de outro paciente não pode ser usada', async () => {
  const f = setup({ ...absence, patientId: 'other-patient' });
  await assert.rejects(prepareGooglePhotosAlbumReopen(context, { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN }, { db: f.db }), invalid);
});
test('identidade documental conflitante falha fechado', async () => {
  const f = setup(); f.db.store.set(`${root}/sessions/session-a`, { ...absence, id: 'forged' });
  await assert.rejects(prepareGooglePhotosAlbumReopen(context, { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN, sessionIds: ['forged'] }, { db: f.db }), invalid);
});
test('token forjado é rejeitado', async () => {
  const f = setup(); const input = await authorized(f);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, { ...input, reopenToken: 'f'.repeat(64) }, f.options), invalid);
  assert.equal(f.calls(), 0);
});
test('token não funciona para outro usuário', async () => {
  const f = setup(); const input = await authorized(f);
  await assert.rejects(createGooglePhotosAlbumForPackage({ ...context, userId: 'other-actor' }, input, f.options), invalid);
});
test('token não funciona para outra sessão', async () => {
  const f = setup(); const input = await authorized(f); f.db.store.set(`${root}/sessions/session-b`, { ...absence, id: 'session-b', time: '11:00' });
  await assert.rejects(createGooglePhotosAlbumForPackage(context, { ...input, sessionIds: ['session-b'],
    sessionGroupKey: buildGooglePhotosAlbumGroupKey({ patientId: input.patientId, activityDate: input.activityDate, sessionIds: ['session-b'] }) }, f.options), invalid);
});
test('token expirado falha fechado', async () => {
  const f = setup(); const input = await authorized(f); for (const [path, value] of f.db.store) if (value.reopenIntent) f.db.store.set(path, { ...value, reopenIntent: { ...value.reopenIntent, expiresAt: 0 } });
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, f.options), invalid);
});
for (const [label, mutate] of [
  ['sessão removida', f => f.db.store.delete(`${root}/sessions/session-a`)],
  ['sessão alterada', f => f.db.store.set(`${root}/sessions/session-a`, { ...absence, noReplacementObservation: 'Outro motivo' })],
]) test(`${label} após emissão invalida autorização`, async () => {
  const f = setup(); const input = await authorized(f); mutate(f);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, f.options), invalid); assert.equal(f.calls(), 0);
});
test('álbum existente retorna vínculo canônico, sem segunda criação', async () => {
  const f = setup(); const input = await authorized(f);
  await createGooglePhotosAlbumForPackage(context, input, f.options);
  const result = await createGooglePhotosAlbumForPackage(context, input, f.options);
  const prepared = await prepareGooglePhotosAlbumReopen(context, { ...f.input, creationIntent: EXPLICIT_ALBUM_REOPEN }, { db: f.db });
  assert.equal(result.createdAlbum.idempotent, true); assert.equal(prepared.reopenToken, null);
  assert.equal(prepared.existing.createdAlbum.productUrl, result.createdAlbum.productUrl); assert.equal(f.calls(), 1);
});
test('concorrência no mesmo vínculo reserva somente uma criação', async () => {
  const f = setup(); const input = await authorized(f); let release; const pending = new Promise(resolve => { release = resolve; });
  const opts = { ...f.options, createAlbum: async args => { await pending; return f.options.createAlbum(args); } };
  const first = createGooglePhotosAlbumForPackage(context, input, opts);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, opts), error => error.statusCode === 409);
  release(); await first; assert.equal(f.calls(), 1);
});
test('token consumido não recria álbum mesmo após remover card', async () => {
  const f = setup(); const input = await authorized(f); await createGooglePhotosAlbumForPackage(context, input, f.options);
  const ref = `${root}/${GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION}/patient-a__package_1`;
  f.db.store.set(ref, { ...f.db.store.get(ref), cards: {} });
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, f.options), invalid); assert.equal(f.calls(), 1);
});
test('fluxo comum de sessão elegível continua criando sem intent', async () => {
  const f = setup({ ...absence, status: 'Realizada', noReplacementReasonCode: '', noReplacementReasonText: '', noReplacementObservation: '' });
  assert.equal((await createGooglePhotosAlbumForPackage(context, f.input, f.options)).createdAlbum.idempotent, false);
  assert.equal(f.calls(), 1);
});
test('justificativa sem mídia é validada na fonte backend e não alterada', async () => {
  const f = setup({ ...absence, status: 'Realizada', noReplacementReasonCode: '', noReplacementReasonText: '', noReplacementObservation: '' });
  const status = { patientId: 'patient-a', justification: { active: true, reason: 'other', note: 'Preservar' }, hasMedia: false };
  f.db.store.set(`${root}/activityUploadStatus/session-a`, status);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, f.input, f.options), invalid);
  await createGooglePhotosAlbumForPackage(context, await authorized(f), f.options);
  assert.deepEqual(f.db.store.get(`${root}/activityUploadStatus/session-a`), status);
});
test('ausência não contabilizada permite só álbum, sem avançar pacote ou numeração', async () => {
  const original = { ...absence, consumesPackage: false };
  const f = setup(original); await createGooglePhotosAlbumForPackage(context, await authorized(f), f.options);
  assert.deepEqual(f.db.store.get(`${root}/sessions/session-a`), original);
  assert.equal(isActivityMediaSelectableSession(original), false);
});
test('sessões com identidade de ocorrência ambígua são rejeitadas', async () => {
  const f = setup(); f.db.store.set(`${root}/sessions/duplicate`, { ...absence, id: 'duplicate' });
  await assert.rejects(authorized(f), invalid);
});
test('álbum legado da data sem sessão canônica impede nova criação', async () => {
  const f = setup(); f.db.store.set(`${root}/${GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION}/patient-a__package_1`, {
    cards: { legacy: { activityDate: absence.date, sessionIds: [], url: 'https://photos.google.com/lr/album/legacy' } },
  });
  await assert.rejects(authorized(f), invalid); assert.equal(f.calls(), 0);
});
test('remoção durante resposta do provider impede persistir vínculo e bloqueia nova tentativa', async () => {
  const f = setup(); const input = await authorized(f);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, { ...f.options, createAlbum: async args => {
    const result = await f.options.createAlbum(args); f.db.store.delete(`${root}/sessions/session-a`); return result;
  } }), error => error.code === 'google-photos-albums/persistence-unknown' && error.statusCode === 503);
  assert.equal(f.calls(), 1);
  assert.equal(f.db.store.has(`${root}/${GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION}/patient-a__package_1`), false);
  await assert.rejects(createGooglePhotosAlbumForPackage(context, input, f.options), invalid); assert.equal(f.calls(), 1);
});
test('sessão normal sem justificativa não aceita exceção', async () => {
  const f = setup({ ...absence, status: 'Realizada', noReplacementReasonCode: '', noReplacementReasonText: '', noReplacementObservation: '' });
  await assert.rejects(authorized(f), invalid);
});
test('UI: botão apenas em ausência/justificativa canônica carregada, sem álbum e com permissão', () => {
  const f = setup(); const opts = { card: { ...f.input, url: '', status: 'active' }, sessions: [absence], ready: true, canCreate: true };
  assert.equal(canReopenSessionAlbum(opts), true);
  for (const patch of [{ ready: false }, { canCreate: false }, { sessions: [] },
    { albums: [{ ...f.input, url: 'invalid-link' }] }, { card: { ...opts.card, url: 'https://photos.app.goo.gl/offline' } },
    { card: { ...opts.card, sessionIds: ['forged'] } }]) assert.equal(canReopenSessionAlbum({ ...opts, ...patch }), false);
  const normal = { ...absence, status: 'Realizada', noReplacementReasonCode: '', noReplacementReasonText: '', noReplacementObservation: '' };
  assert.equal(canReopenSessionAlbum({ ...opts, sessions: [normal] }), false);
  assert.equal(canReopenSessionAlbum({ ...opts, sessions: [normal], hasNoMediaJustification: true }), true);
});
test('estado ambíguo de vínculo backend falha fechado', async () => {
  const f = setup(); f.db.store.set(`${root}/${GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION}/patient-a__package_1`, { cards: { invalid: { sessionIds: ['session-a'], url: 'invalid' } } });
  await assert.rejects(authorized(f), invalid); assert.equal(f.calls(), 0);
});
test('edição de card excepcional já criado preserva somente seu vínculo autorizado', async () => {
  const f = setup(); const created = await createGooglePhotosAlbumForPackage(context, await authorized(f), f.options);
  const card = { ...created.albums[0], title: 'Título ajustado' };
  const saved = await saveGooglePhotosAlbumPackage(context, { patientId: 'patient-a', packageNumber: 1, cards: [card] }, { db: f.db });
  assert.equal(saved.albums[0].title, 'Título ajustado');
  assert.equal(saved.albums[0].albumBindingIntent, EXPLICIT_ALBUM_REOPEN);
  await assert.rejects(saveGooglePhotosAlbumPackage(context, { patientId: 'patient-a', packageNumber: 1,
    cards: [{ ...card, url: 'https://photos.google.com/lr/album/other' }] }, { db: f.db }), invalid);
  assert.deepEqual(f.db.store.get(`${root}/sessions/session-a`), absence);
});
test('savePackage comum não consegue forjar novo vínculo de ausência', async () => {
  const f = setup(); await assert.rejects(saveGooglePhotosAlbumPackage(context, { patientId: 'patient-a', packageNumber: 1,
    cards: [{ ...f.input, url: 'https://photos.google.com/lr/album/forged', albumBindingIntent: EXPLICIT_ALBUM_REOPEN }] }, { db: f.db }), invalid);
  assert.equal(f.db.writes.length, 0);
});
