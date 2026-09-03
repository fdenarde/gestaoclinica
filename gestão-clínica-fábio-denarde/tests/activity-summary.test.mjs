import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccumulatedActivitySummary,
  getAccumulatedActivitySummaryLimitSessionId,
  isAccumulatedActivitySummarySourceComplete,
} from '../shared/activitySummary.js';
import fs from 'node:fs';

const patientA = 'patient-a';

function session(id, patientId, position, date, time = '08:00', extra = {}) {
  return {
    id,
    patientId,
    date,
    time,
    status: 'Realizada',
    logicalSessionPosition: position,
    activitySessionNumber: position,
    ...extra,
  };
}

function linkedAlbum(id, patientId, sessionIds, url, packageNumber = 0) {
  return {
    id,
    patientId,
    sessionIds,
    url,
    status: 'active',
    packageNumber,
  };
}

function album(id, patientId, sessionId, url, packageNumber = 0) {
  return linkedAlbum(id, patientId, [sessionId], url, packageNumber);
}

test('copia sessões elegíveis em ordem decrescente até a sessão selecionada', () => {
  const sessions = [
    session('a1', patientA, 1, '2026-06-17'),
    session('a2', patientA, 2, '2026-08-12'),
    session('a3', patientA, 3, '2026-08-26'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [
      album('album-1', patientA, 'a1', 'https://photos.app.goo.gl/one'),
      album('album-2', patientA, 'a2', 'https://photos.app.goo.gl/two'),
      album('album-3', patientA, 'a3', 'https://photos.app.goo.gl/three'),
    ],
    throughSessionId: 'a3',
  });

  assert.match(summary, /^\*Registro das atividades - Paciente A\*/);
  assert.deepEqual([...summary.matchAll(/\*Sessão (\d+)\*/g)].map(match => Number(match[1])), [3, 2, 1]);
  assert.match(summary, /26\/08\/2026 às 08:00/);
  assert.match(summary, /https:\/\/photos\.app\.goo\.gl\/three/);
  assert.match(summary, /\*Sessão 3\*/);
});

test('omite links vazios ou inválidos e respeita o limite do pacote atual', () => {
  const sessions = [
    session('a1', patientA, 1, '2026-01-01'),
    session('a2', patientA, 2, '2026-01-08'),
    session('a3', patientA, 3, '2026-01-15'),
    session('a9', patientA, 9, '2026-03-15'),
    session('a10', patientA, 10, '2026-03-22'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [
      album('empty', patientA, 'a2', '   '),
      album('invalid', patientA, 'a3', 'http://photos.app.goo.gl/invalid'),
      album('one', patientA, 'a1', 'https://photos.app.goo.gl/one'),
      album('nine', patientA, 'a9', 'https://photos.app.goo.gl/nine'),
      album('ten', patientA, 'a10', 'https://photos.app.goo.gl/ten'),
    ],
    throughSessionId: 'a10',
  });

  assert.deepEqual([...summary.matchAll(/\*Sessão (\d+)\*/g)].map(match => Number(match[1])), [10, 9, 1]);
  assert.doesNotMatch(summary, /Sessão 2|Sessão 3|invalid/);
  assert.match(summary, /\*Sessão 10\*[\s\S]*\*Sessão 9\*[\s\S]*\*Sessão 1\*/);

  const limited = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [album('ten', patientA, 'a10', 'https://photos.app.goo.gl/ten'), album('one', patientA, 'a1', 'https://photos.app.goo.gl/one')],
    throughSessionId: 'a9',
  });
  assert.deepEqual([...limited.matchAll(/\*Sessão (\d+)\*/g)].map(match => Number(match[1])), [1]);
});

test('isola paciente pelo identificador interno e resolve limite de sessão dupla pela posição real', () => {
  const sessions = [
    session('a1', patientA, 1, '2026-01-01'),
    session('a2', patientA, 2, '2026-01-08'),
    session('b1', 'patient-b', 1, '2026-01-02'),
  ];
  const doubleCard = { patientId: patientA, sessionIds: ['a1', 'a2'], id: 'double' };
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [
      { ...doubleCard, url: 'https://photos.app.goo.gl/shared', status: 'active' },
      album('other-patient', 'patient-b', 'b1', 'https://photos.app.goo.gl/other'),
    ],
    throughSessionId: getAccumulatedActivitySummaryLimitSessionId({ card: doubleCard, sessions }),
  });

  assert.match(summary, /\*Sessões 2 e 1\*/);
  assert.doesNotMatch(summary, /other-patient|patient-b/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/shared/g) || []).length, 1);
});

test('cada card agrupado vira um bloco e compacta horários da mesma data', () => {
  const sessions = [
    session('a7', patientA, 7, '2026-08-28', '15:00'),
    session('a8', patientA, 8, '2026-08-28', '14:00'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [linkedAlbum('group-8-7', patientA, ['a8', 'a7'], 'https://photos.app.goo.gl/grouped', 4)],
    packageNumber: 4,
    throughSessionId: 'a8',
  });

  assert.match(summary, /\*Sessões 8 e 7\*/);
  assert.match(summary, /28\/08\/2026 às 14:00 e 15:00/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/grouped/g) || []).length, 1);
});

test('três sessões vinculadas permanecem em um único bloco', () => {
  const sessions = [
    session('a4', patientA, 4, '2026-08-21', '16:00'),
    session('a5', patientA, 5, '2026-08-21', '14:00'),
    session('a6', patientA, 6, '2026-08-21', '15:00'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [linkedAlbum('group-6-5-4', patientA, ['a6', 'a5', 'a4'], 'https://photos.app.goo.gl/triple', 4)],
    packageNumber: 4,
    throughSessionId: 'a6',
  });

  assert.match(summary, /\*Sessões 6, 5 e 4\*/);
  assert.match(summary, /21\/08\/2026 às 14:00, 15:00 e 16:00/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/triple/g) || []).length, 1);
});

test('sessões vinculadas em datas diferentes recebem linhas temporais inequívocas', () => {
  const sessions = [
    session('a7', patientA, 7, '2026-08-21', '14:00'),
    session('a8', patientA, 8, '2026-08-28', '15:00'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [linkedAlbum('group-dates', patientA, ['a8', 'a7'], 'https://photos.app.goo.gl/dates', 4)],
    packageNumber: 4,
    throughSessionId: 'a8',
  });

  assert.match(summary, /\*Sessões 8 e 7\*\nSessão 8 — 28\/08\/2026 às 15:00\nSessão 7 — 21\/08\/2026 às 14:00/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/dates/g) || []).length, 1);
});

test('cards diferentes com a mesma URL não são agrupados por URL', () => {
  const sessions = [
    session('a7', patientA, 7, '2026-08-21'),
    session('a8', patientA, 8, '2026-08-28'),
  ];
  const url = 'https://photos.app.goo.gl/same-url';
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [album('card-8', patientA, 'a8', url, 4), album('card-7', patientA, 'a7', url, 4)],
    packageNumber: 4,
    throughSessionId: 'a8',
  });

  assert.match(summary, /\*Sessão 8\*/);
  assert.match(summary, /\*Sessão 7\*/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/same-url/g) || []).length, 2);
});

test('pacote diferente não entra no resumo mesmo quando aponta para sessão conhecida', () => {
  const sessions = [
    session('a7', patientA, 7, '2026-08-21'),
    session('a8', patientA, 8, '2026-08-28'),
  ];
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [
      album('current-8', patientA, 'a8', 'https://photos.app.goo.gl/current-8', 4),
      album('current-7', patientA, 'a7', 'https://photos.app.goo.gl/current-7', 4),
      album('previous-package', patientA, 'a7', 'https://photos.app.goo.gl/previous', 3),
    ],
    packageNumber: 4,
    throughSessionId: 'a8',
  });

  assert.doesNotMatch(summary, /previous/);
  assert.equal((summary.match(/https:\/\/photos\.app\.goo\.gl\/current-/g) || []).length, 2);
});

test('cards em memória completam o intervalo 7→1 sem nenhuma busca adicional', () => {
  const sessions = Array.from({ length: 7 }, (_, index) => session(
    `a${index + 1}`,
    patientA,
    index + 1,
    ['2026-08-27', '2026-08-20', '2026-08-13', '2026-08-06', '2026-07-30', '2026-07-23', '2026-07-16'][index],
  ));
  const albums = sessions.map(item => album(
    `album-${item.id}`,
    patientA,
    item.id,
    `https://photos.app.goo.gl/${item.id}`,
  ));

  assert.equal(isAccumulatedActivitySummarySourceComplete({
    patientId: patientA,
    sessions,
    albums,
    throughSessionId: 'a7',
  }), true);
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums,
    throughSessionId: 'a7',
  });
  assert.deepEqual([...summary.matchAll(/\*Sessão (\d+)\*/g)].map(match => Number(match[1])), [7, 6, 5, 4, 3, 2, 1]);
});

test('o resumo usa somente as sessões e cards do pacote atual', () => {
  const sessions = [
    ...Array.from({ length: 7 }, (_, index) => session(
      `current-${index + 1}`,
      patientA,
      index + 1,
      ['2026-08-27', '2026-08-20', '2026-08-13', '2026-08-06', '2026-07-30', '2026-07-23', '2026-07-16'][index],
    )),
  ];
  const albums = sessions.map(item => album(`album-${item.id}`, patientA, item.id, `https://photos.app.goo.gl/${item.id}`));
  const previousPackageAlbums = [album('previous-package', patientA, 'previous-session', 'https://photos.app.goo.gl/previous')];

  assert.equal(isAccumulatedActivitySummarySourceComplete({
    patientId: patientA,
    sessions,
    albums: [...albums, ...previousPackageAlbums],
    throughSessionId: 'current-7',
  }), true);
  const summary = buildAccumulatedActivitySummary({
    patientId: patientA,
    patientName: 'Paciente A',
    sessions,
    albums: [...albums, ...previousPackageAlbums],
    throughSessionId: 'current-7',
  });
  assert.deepEqual([...summary.matchAll(/\*Sessão (\d+)\*/g)].map(match => Number(match[1])), [7, 6, 5, 4, 3, 2, 1]);
  assert.doesNotMatch(summary, /previous/);
});

test('fonte incompleta não permite produzir resumo parcial', () => {
  const sessions = [
    session('a1', patientA, 1, '2026-01-01'),
    session('a2', patientA, 2, '2026-01-08'),
    session('a3', patientA, 3, '2026-01-15'),
  ];
  const albums = [album('album-3', patientA, 'a3', 'https://photos.app.goo.gl/three')];

  assert.equal(isAccumulatedActivitySummarySourceComplete({
    patientId: patientA,
    sessions,
    albums,
    throughSessionId: 'a3',
  }), false);
  const copied = isAccumulatedActivitySummarySourceComplete({
    patientId: patientA,
    sessions,
    albums,
    throughSessionId: 'a3',
  })
    ? buildAccumulatedActivitySummary({
      patientId: patientA,
      patientName: 'Paciente A',
      sessions,
      albums,
      throughSessionId: 'a3',
    })
    : '';
  assert.equal(copied, '');
});

test('fonte completa considera ausência de link como card carregado e apenas o clipboard é assíncrono', async () => {
  const sessions = [
    session('a1', patientA, 1, '2026-01-01'),
    session('a2', patientA, 2, '2026-01-08'),
  ];
  const albums = [album('empty', patientA, 'a1', ''), album('valid', patientA, 'a2', 'https://photos.app.goo.gl/two')];
  let loading = true;
  let copied = '';
  try {
    assert.equal(isAccumulatedActivitySummarySourceComplete({
      patientId: patientA,
      sessions,
      albums,
      throughSessionId: 'a2',
    }), true);
    const text = buildAccumulatedActivitySummary({
      patientId: patientA,
      patientName: 'Paciente A',
      sessions,
      albums,
      throughSessionId: 'a2',
    });
    await Promise.resolve().then(() => { copied = text; });
  } finally {
    loading = false;
  }

  assert.match(copied, /\*Sessão 2\*/);
  assert.doesNotMatch(copied, /\*Sessão 1\*/);
  assert.equal(loading, false);
});

test('handler usa somente allCards/packageSessions e não contém caminho de rede', () => {
  const source = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const copyAccumulatedSummary');
  const end = source.indexOf('const selectPatient', start);
  const copyFlow = source.slice(start, end);

  assert.match(copyFlow, /isAccumulatedActivitySummarySourceComplete/);
  assert.match(copyFlow, /albums: allCards/);
  assert.match(copyFlow, /sessions: packageSessions/);
  assert.match(copyFlow, /await copyTextToClipboard\(summary\)/);
  assert.match(copyFlow, /finally\s*\{/);
  assert.match(copyFlow, /copyingSummaryCardIdRef/);
  assert.doesNotMatch(copyFlow, /fetch|listGooglePhotosAlbums|getProfessionalActivityGallery|getCardSessionActivityStatus|Promise\.all|Promise\.allSettled|withTimeout|ACTIVITY_SUMMARY_COPY_TIMEOUT_MS/);
  assert.doesNotMatch(copyFlow, /summaryAlbumsByPackageRef|ensureActivitySummaryPackages/);
});

test('galeria apresenta agrupamento sem redundância e preserva status, histórico e chips', () => {
  const source = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');

  assert.match(source, /formatLinkedSessionSubtitle\(card, packageSessions\)/);
  assert.match(source, /formatLinkedSessionDescriptor\(card, sessionId, packageSessions/);
  assert.match(source, /getAlbumDisplayTitle\(card\)/);
  assert.doesNotMatch(source, /Sessão dupla • 2 sessões vinculadas/);
  assert.match(source, /Histórico efetivo de sessões/);
  assert.match(source, /Com link/);
  assert.match(source, /cardStatusLabel\(card\)/);
  assert.match(source, /Visível ao responsável/);
  assert.doesNotMatch(source, /Todos os cards disponíveis deste pacote já possuem link/);
});
