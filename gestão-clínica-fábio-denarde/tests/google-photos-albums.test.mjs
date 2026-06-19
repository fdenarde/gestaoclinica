import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION,
  GOOGLE_PHOTOS_PROVIDER,
  buildGooglePhotosAlbumGroupKey,
  buildGooglePhotosAlbumPackageKey,
  buildGooglePhotosVirtualAlbumCards,
  filterGooglePhotosAlbumsForViewer,
  getGooglePhotosAlbumDisplayTitle,
  getGooglePhotosAlbumCapabilities,
  isGooglePhotosAlbumPatientAllowed,
  isValidGooglePhotosAlbumUrl,
  mergeGooglePhotosAlbumCards,
  normalizeGooglePhotosAlbumUrl,
} from '../shared/googlePhotosAlbums.js';
import { buildActivityMediaPackageModel } from '../shared/activityMediaPackages.js';

const validAlbum = {
  id: 'album-1',
  provider: GOOGLE_PHOTOS_PROVIDER,
  packageKey: 'patient-1__package_2',
  packageNumber: 2,
  patientId: 'patient-1',
  activityDate: '2026-06-18',
  sessionIds: ['session-1'],
  sessionGroupKey: 'sessions:patient-1:2026-06-18:session-1',
  status: 'active',
  visibleToGuardian: true,
  url: 'https://photos.app.goo.gl/AbCdEf123456',
};

function makeSession(id, date, status = 'Realizada', extra = {}) {
  return {
    id,
    patientId: 'patient-1',
    date,
    time: extra.time || '10:00',
    type: extra.type || 'Sessão simples (50 min)',
    status,
    packageNumber: extra.packageNumber ?? null,
    isBlocked: false,
    ...extra,
  };
}

test('validação aceita somente HTTPS com hostname oficial exato do Google Fotos', () => {
  assert.equal(isValidGooglePhotosAlbumUrl('https://photos.app.goo.gl/AbCdEf123456'), true);
  assert.equal(isValidGooglePhotosAlbumUrl('https://photos.google.com/share/AF1QipExample'), true);
  assert.equal(normalizeGooglePhotosAlbumUrl(' https://photos.app.goo.gl/AbCdEf123456 '), 'https://photos.app.goo.gl/AbCdEf123456');

  for (const invalid of [
    'http://photos.app.goo.gl/AbCdEf123456',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://photos.google.com/example',
    'file:///tmp/album',
    'https://photos.app.goo.gl.evil.example/album',
    'https://evilphotos.google.com/album',
    'https://photos.google.com.evil.example/album',
    'https://user:password@photos.google.com/share/album',
    'https://photos.google.com:444/share/album',
    'https://drive.google.com/album',
    '<a href="https://photos.google.com/share/album">álbum</a>',
    'https://photos.google.com/',
  ]) {
    assert.equal(isValidGooglePhotosAlbumUrl(invalid), false, invalid);
  }
});

test('perfis recebem somente as capacidades aprovadas', () => {
  const admin = getGooglePhotosAlbumCapabilities({ role: 'admin', scope: 'manage' });
  assert.deepEqual(admin, {
    canView: true,
    canCreate: true,
    canEdit: true,
    canHide: true,
    canReactivate: true,
    canRemove: true,
  });

  const professional = getGooglePhotosAlbumCapabilities({ role: 'professional', scope: 'manage' });
  assert.equal(professional.canView, true);
  assert.equal(professional.canCreate, true);
  assert.equal(professional.canEdit, true);
  assert.equal(professional.canHide, false);
  assert.equal(professional.canRemove, false);

  const responsible = getGooglePhotosAlbumCapabilities({ role: 'responsible', scope: 'portal' });
  assert.equal(responsible.canView, true);
  assert.equal(responsible.canCreate, false);
  assert.equal(responsible.canEdit, false);

  const monitoring = getGooglePhotosAlbumCapabilities({ role: 'professional', activeContext: 'monitoring', scope: 'manage' });
  assert.equal(monitoring.canView, true);
  assert.equal(monitoring.canCreate, false);
  assert.equal(monitoring.canEdit, false);
  assert.equal(monitoring.canRemove, false);
});

test('vínculo do atendente é obrigatório para perfis não administrativos', () => {
  assert.equal(isGooglePhotosAlbumPatientAllowed(null, 'patient-1', 'admin'), true);
  assert.equal(isGooglePhotosAlbumPatientAllowed(['patient-1'], 'patient-1', 'professional'), true);
  assert.equal(isGooglePhotosAlbumPatientAllowed(['patient-2'], 'patient-1', 'professional'), false);
  assert.equal(isGooglePhotosAlbumPatientAllowed(['patient-1'], 'patient-2', 'responsible'), false);
});

test('portal recebe apenas cards ativos, autorizados, do atendente e pacote corretos', () => {
  const result = filterGooglePhotosAlbumsForViewer([
    validAlbum,
    { ...validAlbum, id: 'hidden', status: 'hidden' },
    { ...validAlbum, id: 'private', visibleToGuardian: false },
    { ...validAlbum, id: 'other-patient', patientId: 'patient-2' },
    { ...validAlbum, id: 'other-package', packageNumber: 1, packageKey: 'patient-1__package_1' },
    { ...validAlbum, id: 'removed', status: 'removed' },
    { ...validAlbum, id: 'invalid-url', url: 'https://example.com/album' },
  ], { patientId: 'patient-1', packageNumber: 2, role: 'responsible', scope: 'portal' });

  assert.deepEqual(result.map(album => album.id), ['album-1']);
});

test('link autorizado aparece no Portal e variações não autorizadas continuam ocultas', () => {
  const result = filterGooglePhotosAlbumsForViewer([
    { ...validAlbum, id: 'authorized-isabelly-like' },
    { ...validAlbum, id: 'without-guardian-visibility', visibleToGuardian: false },
    { ...validAlbum, id: 'hidden-card', status: 'hidden' },
    { ...validAlbum, id: 'another-package', packageNumber: 3, packageKey: 'patient-1__package_3' },
    { ...validAlbum, id: 'another-patient', patientId: 'patient-isabelly' },
  ], { patientId: 'patient-1', packageNumber: 2, role: 'responsible', scope: 'portal' });

  assert.deepEqual(result.map(album => album.id), ['authorized-isabelly-like']);
});

test('monitoramento permanece somente leitura e limitado ao período configurado', () => {
  const result = filterGooglePhotosAlbumsForViewer([
    { ...validAlbum, id: 'before', activityDate: '2026-06-01' },
    { ...validAlbum, id: 'inside', activityDate: '2026-06-16' },
    { ...validAlbum, id: 'hidden', activityDate: '2026-06-18', status: 'hidden' },
  ], {
    patientId: 'patient-1',
    packageNumber: 2,
    role: 'monitoring',
    activeContext: 'monitoring',
    scope: 'manage',
    monitoringStartDate: '2026-06-15',
  });
  assert.deepEqual(result.map(album => album.id), ['inside']);
});

test('cards virtuais cobrem a primeira sessão do pacote atual até a sessão atual', () => {
  const packageOne = Array.from({ length: 10 }, (_, index) => makeSession(`p1-${index + 1}`, `2026-06-${String(index + 1).padStart(2, '0')}`));
  const sessions = [
    ...packageOne,
    makeSession('current-1', '2026-06-11', 'Realizada'),
    makeSession('current-2', '2026-06-12', 'Reposição'),
    makeSession('absence-consumed', '2026-06-13', 'Falta', { consumesPackage: true, time: '08:00' }),
    makeSession('cancelled', '2026-06-13', 'Cancelada', { time: '09:00' }),
    makeSession('in-progress', '2026-06-13', 'Agendada', { time: '10:00' }),
    makeSession('future', '2026-06-20', 'Agendada'),
  ];

  const cards = buildGooglePhotosVirtualAlbumCards(sessions, {
    patientId: 'patient-1',
    patientName: 'Paciente Teste',
    packageNumber: 2,
    now: new Date('2026-06-13T13:20:00Z'),
  });

  assert.deepEqual(cards.map(card => card.sessionIds[0]).sort(), ['current-1', 'current-2', 'in-progress']);
  assert.equal(cards.every(card => card.packageNumber === 2), true);
  assert.equal(cards.every(card => card.url === ''), true);
  assert.equal(cards.some(card => card.category === 'Atividade de Intervenção'), true);
});

test('sessões duplas usam IDs reais, agrupam automaticamente pares consecutivos e preservam grupos explícitos', () => {
  const grouped = buildGooglePhotosVirtualAlbumCards([
    makeSession('double-b', '2026-06-18', 'Realizada', { activityGroupKey: 'same-activity', time: '11:00' }),
    makeSession('double-a', '2026-06-18', 'Realizada', { activityGroupKey: 'same-activity', time: '10:00' }),
  ], { patientId: 'patient-1', packageNumber: 1, now: new Date('2026-06-19T12:00:00Z') });
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].sessionGroupKey, 'sessions:patient-1:2026-06-18:double-a,double-b');


  const automatic = buildGooglePhotosVirtualAlbumCards([
    makeSession('double-auto-a', '2026-06-19', 'Realizada', { type: 'Sessão dupla (2 × 50 min)', time: '14:00' }),
    makeSession('double-auto-b', '2026-06-19', 'Realizada', { type: 'Sessão dupla (2 × 50 min)', time: '15:00' }),
  ], { patientId: 'patient-1', packageNumber: 1, now: new Date('2026-06-19T20:00:00Z') });
  assert.equal(automatic.length, 1);
  assert.deepEqual(automatic[0].sessionIds, ['double-auto-a', 'double-auto-b']);
  assert.match(automatic[0].title, /Sessão dupla/);

  const separated = buildGooglePhotosVirtualAlbumCards([
    makeSession('activity-a', '2026-06-18', 'Realizada', { time: '10:00' }),
    makeSession('activity-b', '2026-06-18', 'Realizada', { time: '11:00' }),
  ], { patientId: 'patient-1', packageNumber: 1, now: new Date('2026-06-19T12:00:00Z') });
  assert.equal(separated.length, 2);
  assert.deepEqual(separated.map(card => card.sessionIds), [['activity-b'], ['activity-a']]);
});

test('atendente configurado para sessão dupla reconstrói todos os pares históricos do pacote', () => {
  const sessions = [
    makeSession('celso-1', '2026-05-22', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-2', '2026-05-22', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-3', '2026-05-29', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-4', '2026-05-29', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-5', '2026-06-03', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-6', '2026-06-03', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-7', '2026-06-12', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-8', '2026-06-12', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-9', '2026-06-19', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('celso-10', '2026-06-19', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
  ];

  const cards = buildGooglePhotosVirtualAlbumCards(sessions, {
    patientId: 'patient-1',
    patientName: 'Celso',
    patientDoubleSession: true,
    packageNumber: 1,
    now: new Date('2026-06-19T20:00:00Z'),
  });

  assert.equal(cards.length, 5);
  assert.deepEqual(
    cards.map(card => card.sessionNumbers).sort((left, right) => left[0] - right[0]),
    [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],
  );
  assert.equal(cards.every(card => card.sessionIds.length === 2), true);
  assert.equal(cards.every(card => /Sessão dupla/.test(card.title)), true);

  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  assert.match(professionalSource, /patientDoubleSession: Boolean\(selectedPatient\?\.doubleSession\)/);
});

test('regra histórica de sessão dupla não une atendimentos simples nem horários incompatíveis', () => {
  const sessions = [
    makeSession('simple-1', '2026-06-01', 'Realizada', { time: '14:00', type: 'Sessão simples (50 min)' }),
    makeSession('simple-2', '2026-06-01', 'Realizada', { time: '15:00', type: 'Sessão simples (50 min)' }),
  ];
  const simpleCards = buildGooglePhotosVirtualAlbumCards(sessions, {
    patientId: 'patient-1',
    packageNumber: 1,
    patientDoubleSession: false,
    now: new Date('2026-06-02T12:00:00Z'),
  });
  assert.equal(simpleCards.length, 2);

  const incompatibleCards = buildGooglePhotosVirtualAlbumCards([
    makeSession('double-1', '2026-06-01', 'Realizada', { time: '14:00' }),
    makeSession('double-2', '2026-06-01', 'Realizada', { time: '16:00' }),
  ], {
    patientId: 'patient-1',
    packageNumber: 1,
    patientDoubleSession: true,
    now: new Date('2026-06-02T12:00:00Z'),
  });
  assert.equal(incompatibleCards.length, 2);
});

test('título gerado de card persistido com dois IDs é exibido como sessão dupla', () => {
  assert.equal(getGooglePhotosAlbumDisplayTitle({
    title: 'Atividade de Intervenção - Sessão 9',
    category: 'Atividade de Intervenção',
    sessionIds: ['celso-9', 'celso-10'],
  }), 'Atividade de Intervenção - Sessão dupla');

  assert.equal(getGooglePhotosAlbumDisplayTitle({
    title: 'Jogo da memória',
    category: 'Atividade de Intervenção',
    sessionIds: ['celso-9', 'celso-10'],
  }), 'Jogo da memória');
});

test('galeria não avança para pacote sem pagamento confirmado', () => {
  const sessions = [
    ...Array.from({ length: 10 }, (_, index) => makeSession(`paid-1-${index + 1}`, `2026-05-${String(index + 1).padStart(2, '0')}`)),
    makeSession('unpaid-package-2', '2026-06-19'),
  ];
  const model = buildActivityMediaPackageModel(sessions, {
    patientId: 'patient-1',
    payments: [{ patientId: 'patient-1', amount: 1000, packageNumber: 1 }],
    now: new Date('2026-06-19T20:00:00Z'),
  });
  assert.equal(model.currentPackageNumber, 1);
  assert.equal(model.awaitingPaymentSessions.length, 1);
  assert.equal(model.currentSessions.some(session => session.id === 'unpaid-package-2'), false);

  const renewed = buildActivityMediaPackageModel(sessions, {
    patientId: 'patient-1',
    payments: [
      { patientId: 'patient-1', amount: 1000, packageNumber: 1 },
      { patientId: 'patient-1', amount: 500, packageNumber: 2 },
    ],
    now: new Date('2026-06-19T20:00:00Z'),
  });
  assert.equal(renewed.currentPackageNumber, 2);
  assert.equal(renewed.currentSessions.some(session => session.id === 'unpaid-package-2'), true);
});



test('Portal bloqueia leitura direta de pacote ainda não ativado por pagamento', () => {
  const repositorySource = fs.readFileSync(new URL('../api/_lib/googlePhotosAlbumsRepository.js', import.meta.url), 'utf8');
  assert.match(repositorySource, /normalizedScope === 'portal'/);
  assert.match(repositorySource, /getActivatedPackageNumber\(payments, \{ patientId: normalizedPatientId \}\)/);
  assert.match(repositorySource, /normalizedPackageNumber > activatedPackageNumber/);
  assert.match(repositorySource, /albums: \[\]/);
});

test('área profissional avisa quando há sessão aguardando pagamento do próximo pacote', () => {
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  assert.match(professionalSource, /awaitingPaymentSessions/);
  assert.match(professionalSource, /Nenhum novo pacote foi aberto/);
});

test('mesclagem remove cards virtuais cobertos por card persistido e preserva rascunhos locais', () => {
  const virtualCards = buildGooglePhotosVirtualAlbumCards([
    makeSession('session-1', '2026-06-18'),
    makeSession('session-2', '2026-06-19'),
  ], { patientId: 'patient-1', packageNumber: 1, now: new Date('2026-06-20T12:00:00Z') });
  const persisted = {
    ...validAlbum,
    id: buildGooglePhotosAlbumGroupKey({ patientId: 'patient-1', activityDate: '2026-06-18', sessionIds: ['session-1'] }),
    sessionIds: ['session-1'],
    activityDate: '2026-06-18',
    packageNumber: 1,
  };
  const draft = {
    ...virtualCards.find(card => card.sessionIds.includes('session-2')),
    url: 'https://photos.app.goo.gl/Draft123',
    visibleToGuardian: true,
  };
  const merged = mergeGooglePhotosAlbumCards({
    virtualCards,
    persistedCards: [persisted],
    draftCards: [draft],
  });
  assert.deepEqual(merged.map(card => [card.sessionIds.join(','), card.url]), [
    ['session-2', 'https://photos.app.goo.gl/Draft123'],
    ['session-1', validAlbum.url],
  ]);
});

test('documento de pacote usa chave determinística e coleção resumida', () => {
  assert.equal(GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION, 'googlePhotosAlbumPackages');
  assert.equal(buildGooglePhotosAlbumPackageKey({ patientId: 'patient-1', packageNumber: 2 }), 'patient-1__package_2');
});

test('implementação é isolada, sob demanda, por pacote e sem leitura por card', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const responsibleSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const repositorySource = fs.readFileSync(new URL('../api/_lib/googlePhotosAlbumsRepository.js', import.meta.url), 'utf8');
  const endpointSource = fs.readFileSync(new URL('../api/google-photos-albums.js', import.meta.url), 'utf8');

  // galeria-consolidada-v3-isolated: o identificador histórico abre apenas a implementação nova por pacote.
  assert.match(appSource, /id: 'galeria-atividades', label: 'Galeria de Atividades'/);
  assert.match(
    appSource,
    /activeTab === 'galeria-atividades'\s*&&\s*<ProfessionalGooglePhotosGallery/,
  );
  assert.doesNotMatch(appSource, /<ProfessionalActivityGallery/);
  assert.doesNotMatch(appSource, /activeTab === 'galeria-google-fotos'/);

  for (const source of [professionalSource, responsibleSource, repositorySource, endpointSource]) {
    assert.doesNotMatch(source, /onSnapshot\s*\(/);
    assert.doesNotMatch(source, /iframe/i);
    assert.doesNotMatch(source, /photoslibrary\.googleapis\.com/i);
  }

  assert.match(professionalSource, /await listGooglePhotosAlbums\(\{/);
  assert.match(repositorySource, /GOOGLE_PHOTOS_ALBUM_PACKAGE_COLLECTION/);
  assert.match(repositorySource, /packageCollection\(context\)\.doc\(packageKey\)/);
  assert.match(repositorySource, /cardsMap/);
  assert.doesNotMatch(repositorySource, /activityRecords/);
  assert.doesNotMatch(endpointSource, /fetch\s*\(/);
});

test('cache da nova galeria é específico e invalidado apenas para o pacote salvo', () => {
  const apiClientSource = fs.readFileSync(new URL('../src/lib/googlePhotosAlbumsApi.ts', import.meta.url), 'utf8');

  assert.match(apiClientSource, /function lookupCacheKey\(patientId: string, packageNumber: number, scope: 'manage' \| 'portal'\)/);
  assert.match(apiClientSource, /function storageCacheKey/);
  assert.match(apiClientSource, /ownerUserId \|\| 'owner:unknown'/);
  assert.match(apiClientSource, /scope: 'manage' \| 'portal'/);
  assert.match(apiClientSource, /buildPackageKey\(\{ patientId, packageNumber \}\)/);
  assert.match(apiClientSource, /invalidateGooglePhotosAlbumsCache\(\{\s*ownerUserId: result\.ownerUserId,[\s\S]*patientId: payload\.patientId,[\s\S]*packageNumber: payload\.packageNumber,[\s\S]*packageKey: result\.packageKey,/);
  assert.match(apiClientSource, /storeGooglePhotosAlbumsCache\(\{ patientId: payload\.patientId, packageNumber: payload\.packageNumber, scope: 'manage' \}, result\)/);
  assert.doesNotMatch(apiClientSource, /responseCache\.clear\(\)[\s\S]{0,260}saveGooglePhotosAlbumPackage/);
});

test('Portal recarrega pacote invalidado e botão Atualizar ignora somente o cache atual', () => {
  const responsibleSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');

  assert.match(responsibleSource, /GOOGLE_PHOTOS_ALBUMS_CHANGED_EVENT/);
  assert.match(responsibleSource, /detail\?\.patientId === patientId/);
  assert.match(responsibleSource, /Number\(detail\.packageNumber\) === Number\(packageNumber\)/);
  assert.match(responsibleSource, /void load\(true\)/);
  assert.match(responsibleSource, /onClick=\{\(\) => void load\(true\)\}/);
  assert.match(responsibleSource, /disabled=\{loading\}/);
  assert.match(responsibleSource, /loadingRef\.current/);
  assert.match(responsibleSource, /const result = await listGooglePhotosAlbums\(\{ patientId, packageNumber, scope: 'portal', force \}\)/);
  const validLoadBranch = responsibleSource.slice(
    responsibleSource.indexOf('loadingRef.current = true;'),
    responsibleSource.indexOf('} catch (caughtError)'),
  );
  assert.doesNotMatch(validLoadBranch, /setAlbums\(\[\]\)/);
});

test('portal do responsável usa tema verde, aba única e não expõe o nome do provedor', () => {
  const responsibleSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(responsibleSource, /Galeria de atividades/);
  assert.match(responsibleSource, /Abrir Atividade <ExternalLink/);
  assert.doesNotMatch(responsibleSource, /Abrir álbum/);
  assert.match(professionalSource, /Abrir álbum <ExternalLink/);
  assert.doesNotMatch(responsibleSource, />Google Fotos</);
  assert.doesNotMatch(responsibleSource, /Galeria de atividades \(Google Fotos\)/);
  assert.doesNotMatch(portalSource, /Galeria de atividades \(Google Fotos\)/);
  assert.match(portalSource, /type PortalTab = 'dashboard' \| 'sessions' \| 'gallery' \| 'profile'/);
  assert.match(portalSource, /packageNumber=\{selectedPackage\.number\}/);
  assert.doesNotMatch(portalSource, /activePortalTab === 'googlePhotos'/);
  assert.match(responsibleSource, /bg-clinic-primary/);
  assert.match(responsibleSource, /bg-status-green-bg/);
  assert.match(responsibleSource, /text-status-green-text/);
  assert.match(responsibleSource, /target="_blank"/);
  assert.match(responsibleSource, /rel="noopener noreferrer"/);
});

test('galeria de atividades preserva densidade compacta no portal e editor profissional fechado até interação', () => {
  const responsibleSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');

  assert.match(responsibleSource, /grid gap-3 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(responsibleSource, /rounded-2xl border border-clinic-border bg-white p-3 shadow-sm sm:p-4/);
  assert.match(responsibleSource, /text-base font-bold text-clinic-text/);
  assert.match(responsibleSource, /px-4 py-2\.5 text-xs font-black uppercase tracking-wide/);
  assert.doesNotMatch(responsibleSource, /font-black text-clinic-text">\{album\.title\}/);
  assert.doesNotMatch(responsibleSource, /\{album\.patientName \|\| patientName\}/);

  assert.match(professionalSource, /const editing = editingCardIds\.includes\(card\.id\)/);
  assert.match(professionalSource, /\{editing && \(/);
  assert.match(professionalSource, /\{cardHasInvalidLink \? 'Corrigir link' : 'Adicionar link'\} <Link2/);
  assert.match(professionalSource, /Editar card/);
  assert.match(professionalSource, /authorizeNewLinkByDefault = !card\.url\.trim\(\) && card\.status !== 'hidden'/);
  assert.match(professionalSource, /visibleToGuardian: authorizeNewLinkByDefault \? true : card\.visibleToGuardian/);
});

test('nova galeria profissional aparece nos menus superior e lateral com o mesmo componente', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Navigation/SidebarNavigation.tsx', import.meta.url), 'utf8');

  // galeria-consolidada-v3-menus: existe somente uma entrada visível e ela usa o componente novo.
  const consolidatedItems = appSource.match(/id: 'galeria-atividades', label: 'Galeria de Atividades'/g) || [];
  assert.equal(consolidatedItems.length, 1);
  assert.match(
    appSource,
    /activeTab === 'galeria-atividades'\s*&&\s*<ProfessionalGooglePhotosGallery/,
  );
  assert.doesNotMatch(appSource, /galeria-google-fotos/);
  assert.match(sidebarSource, /ids: \['atendentes', 'galeria-atividades', 'pre-cadastros'\]/);
  assert.doesNotMatch(sidebarSource, /galeria-google-fotos/);
});

test('abertura externa usa proteções obrigatórias, sem carregar mídias remotas', () => {
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const responsibleSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  for (const source of [professionalSource, responsibleSource]) {
    assert.match(source, /target="_blank"/);
    assert.match(source, /rel="noopener noreferrer"/);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(source, /<img/);
    assert.doesNotMatch(source, /<video/);
  }
});

test('categoria mínima usa Atividade de Intervenção e não usa texto antigo indevido', () => {
  const sharedSource = fs.readFileSync(new URL('../shared/googlePhotosAlbums.js', import.meta.url), 'utf8');
  const professionalSource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  const cards = buildGooglePhotosVirtualAlbumCards([
    makeSession('category-session', '2026-06-18'),
  ], { patientId: 'patient-1', packageNumber: 1, now: new Date('2026-06-19T12:00:00Z') });
  assert.equal(cards[0].category, 'Atividade de Intervenção');
  assert.match(professionalSource, /Atividade de Intervenção/);
  assert.doesNotMatch(sharedSource, /Atividades de atenção e planejamento/);
  assert.doesNotMatch(professionalSource, /Atividades de atenção e planejamento/);
});

test('Firestore não concede acesso direto à nova coleção; operações passam pela API autenticada', () => {
  const rulesSource = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const endpointSource = fs.readFileSync(new URL('../api/google-photos-albums.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rulesSource, /match \/googlePhotosAlbumPackages\//);
  assert.doesNotMatch(rulesSource, /match \/googlePhotosAlbums\//);
  assert.match(rulesSource, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(endpointSource, /resolveAccessContext/);
  assert.match(endpointSource, /allowedRoles: \['admin', 'professional', 'responsible', 'monitoring'\]/);
});
