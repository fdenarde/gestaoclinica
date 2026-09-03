import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildActivityGalleryMediaPresentation } from '../shared/activityGalleryPresentation.js';

const entry = (sessionId, sessionNumber, date, time, state = 'overdue', justificationReason = '') => ({
  sessionId,
  sessionNumber,
  date,
  time,
  state,
  justificationReason,
});

test('card de uma sessão mantém apresentação singular', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s8', 8, '2026-08-28', '15:00'),
  ]);

  assert.equal(presentation.hasMultipleSessions, false);
  assert.equal(presentation.sessionLabel, 'Sessão 8');
  assert.equal(presentation.canCompactSchedule, false);
  assert.equal(presentation.canShareStatus, false);
});

test('duas sessões no mesmo dia e estado compactam data, estado e horários', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s8', 8, '2026-08-28', '15:00'),
    entry('s7', 7, '2026-08-28', '14:00'),
  ]);

  assert.equal(presentation.sessionLabel, 'Sessões 8 e 7');
  assert.equal(presentation.sameDate, true);
  assert.equal(presentation.sameState, true);
  assert.equal(presentation.commonDate, '2026-08-28');
  assert.equal(presentation.chronologicalTimes, '14:00 e 15:00');
  assert.equal(presentation.canCompactSchedule, true);
  assert.deepEqual(presentation.entries.map(item => item.sessionNumber), [8, 7]);
});

test('estados diferentes permanecem individuais mesmo no mesmo dia', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s8', 8, '2026-08-28', '15:00', 'sent'),
    entry('s7', 7, '2026-08-28', '14:00', 'overdue'),
  ]);

  assert.equal(presentation.sameDate, true);
  assert.equal(presentation.sameState, false);
  assert.equal(presentation.canShareStatus, false);
  assert.equal(presentation.canCompactSchedule, false);
});

test('datas diferentes mantêm data e horário de cada sessão, compartilhando apenas estado igual', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s8', 8, '2026-08-28', '15:00'),
    entry('s7', 7, '2026-08-21', '14:00'),
  ]);

  assert.equal(presentation.sameDate, false);
  assert.equal(presentation.sameState, true);
  assert.equal(presentation.canShareStatus, true);
  assert.equal(presentation.canCompactSchedule, false);
  assert.deepEqual(presentation.entries.map(item => `${item.sessionNumber}:${item.date} ${item.time}`), [
    '8:2026-08-28 15:00',
    '7:2026-08-21 14:00',
  ]);
});

test('três sessões vinculadas são agrupadas sem limitar a exatamente duas', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s6', 6, '2026-08-28', '16:00'),
    entry('s5', 5, '2026-08-28', '15:00'),
    entry('s4', 4, '2026-08-28', '14:00'),
  ]);

  assert.equal(presentation.sessionLabel, 'Sessões 6, 5 e 4');
  assert.equal(presentation.chronologicalTimes, '14:00, 15:00 e 16:00');
  assert.equal(presentation.canCompactSchedule, true);
});

test('razões diferentes não são compactadas como se fossem o mesmo estado visual', () => {
  const presentation = buildActivityGalleryMediaPresentation([
    entry('s8', 8, '2026-08-28', '15:00', 'excused', 'technical_issue'),
    entry('s7', 7, '2026-08-28', '14:00', 'excused', 'other'),
  ]);

  assert.equal(presentation.sameState, false);
  assert.equal(presentation.canCompactSchedule, false);
});

test('o agrupamento visual é limitado aos sessionIds do card e preserva ações por sessionId', () => {
  const source = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const mediaStart = source.indexOf('{card.sessionIds.length > 0');
  const mediaEnd = source.indexOf('{editing &&', mediaStart);
  const mediaBlock = source.slice(mediaStart, mediaEnd);

  assert.match(source, /const mediaEntries = card\.sessionIds\.map/);
  assert.match(mediaBlock, /Registro de mídia das sessões/);
  assert.match(mediaBlock, /Registro de mídia da sessão/);
  assert.match(source, /openNoMediaEditor\(card, entry\.sessionId\)/);
  assert.match(source, /formatActivityMediaActionLabel/);
  assert.match(source, /\$\{sessionLabel\} · Registrar sem mídia/);
  assert.doesNotMatch(mediaBlock, /Registrar ambas/);
  assert.doesNotMatch(mediaBlock, /saveGooglePhotosAlbumPackage|createAlbumForCard|updateCard\(/);
});
