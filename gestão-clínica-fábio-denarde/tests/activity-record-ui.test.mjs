import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_ACTIVITY_RECORD_CATEGORY,
  INTERVENTION_ACTIVITY_RECORD_CATEGORY,
  LEGACY_ACTIVITY_RECORD_CATEGORY,
  activityRecordCategoryMatches,
  buildActivitySessionGroups,
  countUniqueConfirmedActivityMedia,
  findConfirmedActivityMediaDuplicate,
  formatActivitySessionGroupLabel,
  getActivityRecordCategoryLabel,
  toggleActivitySessionSelection,
} from '../shared/activityRecordUi.js';
import { getCurrentActivityMediaSessions } from '../shared/activityMediaPackages.js';

function session(id, date, time, status = 'Realizada', activitySessionNumber = 1) {
  return {
    id,
    patientId: 'patient-1',
    date,
    time,
    status,
    type: 'FIXO',
    packageNumber: activitySessionNumber,
    activitySessionNumber,
  };
}

function record(id, overrides = {}) {
  return {
    id,
    status: 'active',
    uploadStatus: 'active',
    sessionId: 'session-1',
    sessionIds: ['session-1'],
    sessionDate: '2026-06-12',
    sessionTime: '14:00',
    driveFileId: `drive-${id}`,
    uploadAttemptId: `attempt-${id}`,
    sha256: `hash-${id}`,
    fileSize: 100,
    ...overrides,
  };
}

test('categoria padrão passa a ser Atividade Neuropsicopedagógica', () => {
  assert.equal(DEFAULT_ACTIVITY_RECORD_CATEGORY, 'Atividade Neuropsicopedagógica');
});

test('nova categoria Atividade de Intervenção fica disponível', () => {
  assert.equal(INTERVENTION_ACTIVITY_RECORD_CATEGORY, 'Atividade de Intervenção');
});

test('categoria histórica é exibida com o novo nome sem migração', () => {
  assert.equal(LEGACY_ACTIVITY_RECORD_CATEGORY, 'Atividade pedagógica');
  assert.equal(getActivityRecordCategoryLabel(LEGACY_ACTIVITY_RECORD_CATEGORY), DEFAULT_ACTIVITY_RECORD_CATEGORY);
});

test('filtro trata categoria antiga e nova como equivalentes', () => {
  assert.equal(activityRecordCategoryMatches(LEGACY_ACTIVITY_RECORD_CATEGORY, DEFAULT_ACTIVITY_RECORD_CATEGORY), true);
  assert.equal(activityRecordCategoryMatches('Memória', DEFAULT_ACTIVITY_RECORD_CATEGORY), false);
});

test('uma sessão isolada continua gerando uma opção própria', () => {
  const groups = buildActivitySessionGroups([session('s1', '2026-06-12', '14:00', 'Realizada', 7)], []);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sessionIds, ['s1']);
  assert.match(formatActivitySessionGroupLabel(groups[0]), /12\/06\/2026 às 14:00/);
  assert.match(formatActivitySessionGroupLabel(groups[0]), /Sessão 7 do pacote atual/);
});

test('duas sessões da mesma data aparecem em um único grupo', () => {
  const groups = buildActivitySessionGroups([
    session('s2', '2026-06-12', '15:00', 'Realizada', 8),
    session('s1', '2026-06-12', '14:00', 'Realizada', 7),
  ], []);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sessionIds, ['s1', 's2']);
  assert.match(formatActivitySessionGroupLabel(groups[0]), /2 sessões realizadas/);
  assert.match(formatActivitySessionGroupLabel(groups[0]), /14:00 e 15:00/);
  assert.match(formatActivitySessionGroupLabel(groups[0]), /Sessões 7 e 8/);
});

test('sessões de datas diferentes permanecem separadas e ordenadas da mais recente', () => {
  const groups = buildActivitySessionGroups([
    session('s1', '2026-06-03', '14:00'),
    session('s2', '2026-06-12', '14:00'),
  ], []);
  assert.deepEqual(groups.map(group => group.date), ['2026-06-12', '2026-06-03']);
});

test('sessões canceladas, com falta e futuras não entram no conjunto disponível para mídia', () => {
  const now = new Date('2026-06-12T14:30:00-03:00');
  const available = getCurrentActivityMediaSessions([
    session('ok', '2026-06-12', '14:00', 'Realizada', 1),
    session('cancelled', '2026-06-12', '15:00', 'Cancelada', 2),
    session('absence', '2026-06-12', '16:00', 'Falta', 3),
    session('future', '2026-06-13', '14:00', 'Agendada', 4),
  ], { patientId: 'patient-1', now });
  assert.deepEqual(available.map(item => item.id), ['ok']);
});

test('seleção automática preserva todos os IDs do grupo', () => {
  const ids = ['s1', 's2'];
  const result = toggleActivitySessionSelection(ids, ids, 's2', true);
  assert.deepEqual(result, { sessionIds: ['s1', 's2'], blocked: false });
});

test('usuário pode desmarcar uma sessão realizada do grupo', () => {
  const result = toggleActivitySessionSelection(['s1', 's2'], ['s1', 's2'], 's2', false);
  assert.deepEqual(result, { sessionIds: ['s1'], blocked: false });
});

test('última sessão vinculada não pode ser desmarcada', () => {
  const result = toggleActivitySessionSelection(['s1', 's2'], ['s1'], 's1', false);
  assert.deepEqual(result, { sessionIds: ['s1'], blocked: true });
});

test('mesmo arquivo físico vinculado a duas sessões é contado uma única vez', () => {
  const records = [
    record('a', { driveFileId: 'same-drive', sessionId: 's1', sessionIds: ['s1', 's2'] }),
    record('b', { driveFileId: 'same-drive', sessionId: 's2', sessionIds: ['s1', 's2'] }),
  ];
  assert.equal(countUniqueConfirmedActivityMedia(records), 1);
});

test('registros não confirmados não entram na contagem', () => {
  const records = [
    record('active'),
    record('uploading', { status: 'uploading', uploadStatus: 'uploading' }),
    record('deleted', { status: 'delete_failed', uploadStatus: 'active' }),
  ];
  assert.equal(countUniqueConfirmedActivityMedia(records), 1);
});

test('data sem mídia mostra Sem mídias', () => {
  const [group] = buildActivitySessionGroups([session('s1', '2026-06-12', '14:00')], []);
  assert.match(formatActivitySessionGroupLabel(group), /Sem mídias/);
});

test('data com mídias mostra quantidade única confirmada', () => {
  const records = [
    record('a', { driveFileId: 'one' }),
    record('b', { driveFileId: 'two' }),
    record('c', { driveFileId: 'two' }),
  ];
  const [group] = buildActivitySessionGroups([session('s1', '2026-06-12', '14:00')], records);
  assert.equal(group.mediaCount, 2);
  assert.match(formatActivitySessionGroupLabel(group), /2 mídias já enviadas/);
});

test('ausência de conjunto completo de registros não exibe falso Sem mídias', () => {
  const [group] = buildActivitySessionGroups([session('s1', '2026-06-12', '14:00')]);
  assert.equal(group.mediaCount, null);
  assert.doesNotMatch(formatActivitySessionGroupLabel(group), /Sem mídias|já enviada/);
});

test('duplicidade na mesma data é identificada localmente', () => {
  const duplicate = findConfirmedActivityMediaDuplicate([
    record('a', { sha256: 'same', sessionId: 's1', sessionIds: ['s1', 's2'] }),
  ], { sha256: 'same', date: '2026-06-12', sessionIds: ['s2'] });
  assert.equal(duplicate?.scope, 'same-date');
});

test('duplicidade da data atual tem prioridade sobre outra data com o mesmo hash', () => {
  const duplicate = findConfirmedActivityMediaDuplicate([
    record('old', { sha256: 'same', sessionDate: '2026-06-03', sessionId: 'old', sessionIds: ['old'] }),
    record('current', { sha256: 'same', sessionDate: '2026-06-12', sessionId: 's1', sessionIds: ['s1'] }),
  ], { sha256: 'same', date: '2026-06-12', sessionIds: ['s1'] });
  assert.equal(duplicate?.scope, 'same-date');
  assert.equal(duplicate?.record.id, 'current');
});

test('duplicidade local reconhece hashes originais ou preparados', () => {
  const duplicate = findConfirmedActivityMediaDuplicate([
    record('prepared', { sha256: '', preparedContentHash: 'prepared-hash' }),
  ], { sha256: 'prepared-hash', date: '2026-06-12', sessionIds: ['session-1'] });
  assert.equal(duplicate?.scope, 'same-date');
});

test('duplicidade em outra data permanece distinguível', () => {
  const duplicate = findConfirmedActivityMediaDuplicate([
    record('a', { sha256: 'same', sessionDate: '2026-06-03', sessionId: 'old', sessionIds: ['old'] }),
  ], { sha256: 'same', date: '2026-06-12', sessionIds: ['s1'] });
  assert.equal(duplicate?.scope, 'other-date');
});

test('modal mantém metadados editáveis na preparação e bloqueia apenas no envio final', () => {
  const source = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /const uploadLocked = stage === 'uploading' \|\| stage === 'finalizing'/);
  assert.match(source, /disabled=\{uploadLocked\}/);
  assert.doesNotMatch(source, /metadataLocked/);
  assert.match(source, /liveFormContextRef\.current/);
  assert.match(source, /As mídias preparadas foram mantidas na remessa/);
});

test('Portal do Responsável omite número da sessão nos cards de mídia e mantém data', () => {
  const source = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<p>Sessão \{record\.sessionNumber/);
  assert.doesNotMatch(source, /selectedMedia\.sessionNumber/);
  assert.match(source, /formatDate\(record\.sessionDate, false\).*record\.sessionTime/s);
  assert.match(source, /Profissional:/);
});

test('implementação não adiciona acesso Firestore ao modal nem ao helper local', () => {
  const modal = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const helper = fs.readFileSync(new URL('../shared/activityRecordUi.js', import.meta.url), 'utf8');
  const forbidden = /\b(onSnapshot|getDocs|getDoc|collection|query|where|addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/;
  assert.doesNotMatch(modal, forbidden);
  assert.doesNotMatch(helper, forbidden);
});
