import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getActivitySessionDurationMinutes,
  getActivitySessionEndAt,
  getActivityUploadDeadline,
  normalizeActivitySessionIds,
  resolveActivityUploadState,
} from '../shared/activityGalleryStatus.js';
import {
  buildActivityMediaPackageModel,
  getCurrentActivityMediaSessions,
  isActivityMediaSelectableSession,
} from '../shared/activityMediaPackages.js';

const monitoringStart = '2026-06-01T03:00:00.000Z';
const simpleSession = {
  id: 'session-1',
  patientId: 'patient-1',
  date: '2026-06-14',
  time: '14:00',
  status: 'Realizada',
  type: 'Sessão simples (50 min)',
};

function resolve(now, overrides = {}, statusRecord = null) {
  return resolveActivityUploadState({
    session: { ...simpleSession, ...overrides },
    monitoringStart,
    statusRecord,
    now: new Date(now),
  });
}

test('sessão simples termina em cinquenta minutos e sessão dupla em cem minutos', () => {
  assert.equal(getActivitySessionDurationMinutes('Sessão simples (50 min)'), 50);
  assert.equal(getActivitySessionDurationMinutes('Sessão dupla (2 × 50 min)'), 100);
  assert.equal(getActivitySessionEndAt(simpleSession)?.toISOString(), '2026-06-14T17:50:00.000Z');
  assert.equal(
    getActivitySessionEndAt({ ...simpleSession, type: 'Sessão dupla (2 × 50 min)' })?.toISOString(),
    '2026-06-14T18:40:00.000Z',
  );
});

test('prazo vence vinte e quatro horas corridas após o horário final', () => {
  assert.equal(getActivityUploadDeadline(simpleSession)?.toISOString(), '2026-06-15T17:50:00.000Z');
});

test('sessão anterior ao início do monitoramento não gera alerta retroativo', () => {
  const result = resolveActivityUploadState({
    session: { ...simpleSession, date: '2026-05-31' },
    monitoringStart,
    statusRecord: null,
    now: new Date('2026-06-16T20:00:00.000Z'),
  });
  assert.equal(result.state, 'not_applicable');
});

test('monitoramento sem data de ativação não cria pendências', () => {
  const result = resolveActivityUploadState({
    session: simpleSession,
    monitoringStart: null,
    statusRecord: null,
    now: new Date('2026-06-15T12:00:00.000Z'),
  });
  assert.equal(result.state, 'not_applicable');
});

test('sessão futura ou ainda em andamento não gera alerta', () => {
  assert.equal(resolve('2026-06-14T17:30:00.000Z').state, 'not_applicable');
});

test('sessão realizada dentro das primeiras vinte e quatro horas aguarda upload', () => {
  const result = resolve('2026-06-15T12:00:00.000Z');
  assert.equal(result.state, 'waiting');
  assert.equal(result.escalation, 0);
});

test('sessão realizada ultrapassando vinte e quatro horas fica atrasada', () => {
  const result = resolve('2026-06-15T18:50:00.000Z');
  assert.equal(result.state, 'overdue');
  assert.equal(result.escalation, 24);
  assert.equal(Math.round(result.overdueHours), 1);
});

test('destaques progressivos são aplicados após quarenta e oito e setenta e duas horas do término', () => {
  const after48Hours = resolve('2026-06-16T18:50:00.000Z');
  const after72Hours = resolve('2026-06-17T18:50:00.000Z');
  assert.equal(after48Hours.escalation, 48);
  assert.equal(after72Hours.escalation, 72);
});

test('mídia válida regulariza a sessão', () => {
  const result = resolve('2026-06-17T20:00:00.000Z', {}, { hasMedia: true, mediaCount: 1 });
  assert.equal(result.state, 'sent');
  assert.equal(result.overdueHours, 0);
});

test('justificativa ativa encerra a pendência sem mídia', () => {
  const result = resolve('2026-06-17T20:00:00.000Z', {}, {
    hasMedia: false,
    mediaCount: 0,
    justification: { active: true, reason: 'atividade sem registro visual' },
  });
  assert.equal(result.state, 'excused');
});

test('mídia enviada prevalece visualmente e a justificativa continua disponível para auditoria', () => {
  const result = resolve('2026-06-17T20:00:00.000Z', {}, {
    hasMedia: true,
    mediaCount: 1,
    justification: { active: true, reason: 'problema técnico' },
  });
  assert.equal(result.state, 'sent');
});

test('sessão não realizada e bloqueio pessoal não são monitorados', () => {
  assert.equal(resolve('2026-06-17T20:00:00.000Z', { status: 'Cancelada' }).state, 'not_applicable');
  assert.equal(resolve('2026-06-17T20:00:00.000Z', { isBlocked: true }).state, 'not_applicable');
});

test('múltiplas sessões são normalizadas sem duplicação e preservam compatibilidade singular', () => {
  assert.deepEqual(normalizeActivitySessionIds({ sessionId: 's1' }), ['s1']);
  assert.deepEqual(normalizeActivitySessionIds({ sessionId: 's1', sessionIds: ['s2', 's1', 's2', ''] }), ['s2', 's1']);
});

test('interface inclui aba, selo, indicadores, filtros e carregamento sob demanda', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /Galeria de atividades/);
  assert.match(appSource, /lateSessionCount/);
  assert.match(gallerySource, /Atendentes com upload atrasado/);
  assert.match(gallerySource, /Sessões aguardando upload/);
  assert.match(gallerySource, /Sessões regularizadas hoje/);
  assert.match(gallerySource, /Todos os atendentes/);
  assert.match(gallerySource, /Carregar mais/);
  assert.match(gallerySource, /Visualizar galeria/);
  assert.match(gallerySource, /ActivityRecordsTab/);
  const viewerSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordViewer.tsx', import.meta.url), 'utf8');
  assert.match(viewerSource, /Baixar mídia/);
  const cardSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordCard.tsx', import.meta.url), 'utf8');
  assert.match(cardSource, /Visível ao responsável/);
  assert.match(cardSource, /Somente uso profissional/);
});

test('acesso profissional é validado também no backend e o responsável permanece limitado ao atendente vinculado', () => {
  const accessSource = fs.readFileSync(new URL('../api/_lib/accessContext.js', import.meta.url), 'utf8');
  const permissionsSource = fs.readFileSync(new URL('../api/_lib/accessPermissions.js', import.meta.url), 'utf8');
  const apiSource = fs.readFileSync(new URL('../api/activity-records.js', import.meta.url), 'utf8');
  assert.match(accessSource, /assertActivityPatientAccess/);
  assert.match(accessSource, /assertPatientBinding/);
  assert.match(permissionsSource, /allowedPatientIds/);
  assert.match(permissionsSource, /context\?\.allowedPatientIds/);
  assert.match(apiSource, /role: 'responsible'/);
  assert.match(apiSource, /allowedPatientIds: \[patientId\]/);
});

test('uma remessa atualiza cada sessão vinculada sem duplicar o arquivo físico', () => {
  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityGalleryRepository.js', import.meta.url), 'utf8');
  assert.match(repositorySource, /for \(const sessionId of sessionIds\)/);
  assert.match(repositorySource, /mediaCount: FieldValue\.increment\(1\)/);
  assert.match(repositorySource, /recordId: record\.id \|\| recordRef\.id/);
});

test('galeria não cria listener Firestore global e usa evento interno filtrado', () => {
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(gallerySource, /onSnapshot\s*\(/);
  assert.match(gallerySource, /ACTIVITY_GALLERY_CHANGED_EVENT/);
  assert.match(gallerySource, /PAGE_SIZE = 20/);
});

test('navegação lateral é padrão e o menu superior alternativo não usa rolagem horizontal', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const preferencesSource = fs.readFileSync(new URL('../src/lib/navigationPreferences.ts', import.meta.url), 'utf8');
  const settingsSource = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');
  const sidebarSource = fs.readFileSync(new URL('../src/components/Navigation/SidebarNavigation.tsx', import.meta.url), 'utf8');

  assert.match(preferencesSource, /return stored === 'top' \? 'top' : 'sidebar'/);
  assert.match(preferencesSource, /gestao-clinica:navigation-mode/);
  assert.match(preferencesSource, /gestao-clinica:sidebar-collapsed/);
  assert.match(appSource, /navigationMode === 'sidebar'/);
  assert.match(appSource, /<SidebarNavigation/);
  assert.match(appSource, /grid w-full grid-cols-3 gap-px/);
  assert.doesNotMatch(appSource, /overflow-x-auto[^\n]*tabs/);
  assert.match(settingsSource, /Menu lateral/);
  assert.match(settingsSource, /Menu superior/);
  assert.match(sidebarSource, /Principal/);
  assert.match(sidebarSource, /Atendimento/);
  assert.match(sidebarSource, /Gestão/);
  assert.match(sidebarSource, /Sistema/);
  assert.match(sidebarSource, /title=\{effectiveCollapsed \? item.label : undefined\}/);
});

test('pacote atual só avança quando o próximo pacote é efetivamente iniciado', () => {
  const completed = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index + 1}`,
    patientId: 'p1',
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    time: '14:00',
    type: 'Sessão simples (50 min)',
    status: 'Realizada',
  }));
  const future = {
    id: 's11-future',
    patientId: 'p1',
    date: '2026-06-20',
    time: '14:00',
    type: 'Sessão simples (50 min)',
    status: 'Agendada',
  };
  const beforeNextStarts = buildActivityMediaPackageModel([...completed, future], {
    patientId: 'p1',
    now: new Date('2026-06-15T15:00:00.000Z'),
  });
  assert.equal(beforeNextStarts.currentPackageNumber, 1);
  assert.equal(beforeNextStarts.currentSessions.length, 10);
  assert.equal(beforeNextStarts.currentSessions.some(session => session.id === future.id), false);

  const inProgress = { ...future, date: '2026-06-15', time: '13:00' };
  const afterNextStarts = buildActivityMediaPackageModel([...completed, inProgress], {
    patientId: 'p1',
    now: new Date('2026-06-15T16:20:00.000Z'),
  });
  assert.equal(afterNextStarts.currentPackageNumber, 2);
  assert.deepEqual(afterNextStarts.currentSessions.map(session => session.id), [inProgress.id]);
  assert.equal(afterNextStarts.currentSessions[0].activitySessionNumber, 1);

  const packageTwoStartedByConsumedAbsence = buildActivityMediaPackageModel([
    ...completed,
    { ...future, id: 'absence-11', date: '2026-06-15', status: 'Falta', consumesPackage: true },
  ], {
    patientId: 'p1',
    now: new Date('2026-06-16T15:00:00.000Z'),
  });
  assert.equal(packageTwoStartedByConsumedAbsence.currentPackageNumber, 2);
  assert.deepEqual(packageTwoStartedByConsumedAbsence.currentSessions, []);
});

test('seleção de mídia aceita apenas sessões realizadas ou em andamento do pacote atual', () => {
  const sessions = [
    { id: 'done', patientId: 'p1', date: '2026-06-15', time: '10:00', type: 'Sessão simples (50 min)', status: 'Realizada' },
    { id: 'running', patientId: 'p1', date: '2026-06-16', time: '10:00', type: 'Sessão simples (50 min)', status: 'Agendada' },
    { id: 'future', patientId: 'p1', date: '2026-06-17', time: '10:00', type: 'Sessão simples (50 min)', status: 'Agendada' },
    { id: 'cancelled', patientId: 'p1', date: '2026-06-15', time: '12:00', type: 'Sessão simples (50 min)', status: 'Cancelada' },
  ];
  const now = new Date('2026-06-16T13:20:00.000Z');
  assert.equal(isActivityMediaSelectableSession(sessions[0], now), true);
  assert.equal(isActivityMediaSelectableSession(sessions[1], now), true);
  assert.equal(isActivityMediaSelectableSession(sessions[2], now), false);
  assert.equal(isActivityMediaSelectableSession(sessions[3], now), false);
  assert.deepEqual(
    getCurrentActivityMediaSessions(sessions, { patientId: 'p1', now }).map(session => session.id),
    ['running', 'done'],
  );
});

test('registro restringe sessões ao pacote atual e galeria oferece anteriores apenas sob demanda', () => {
  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  const tabSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordsTab.tsx', import.meta.url), 'utf8');
  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityGalleryRepository.js', import.meta.url), 'utf8');

  assert.match(modalSource, /getCurrentActivityMediaSessions/);
  assert.match(modalSource, /Nenhuma sessão do pacote atual disponível até o momento/);
  assert.match(gallerySource, /Selecionar pacote/);
  assert.match(gallerySource, /Pacotes anteriores são carregados somente quando selecionados/);
  assert.match(gallerySource, /selectedGalleryPackageNumber/);
  assert.match(gallerySource, /allowNewRecord=\{viewingCurrentPackage\}/);
  assert.match(tabSource, /Pacote anterior: somente consulta/);
  assert.match(repositorySource, /selectCurrentPackageRealizedSessions/);
  assert.match(repositorySource, /buildActivityMediaPackageModel/);
});

test('galeria profissional só carrega mídias depois da seleção no dropdown de sessão', () => {
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  assert.match(gallerySource, /Selecionar sessão da galeria/);
  assert.match(gallerySource, /selectedGallerySessionId/);
  assert.match(gallerySource, /Nenhuma mídia será carregada até que uma data seja escolhida/);
  assert.match(gallerySource, /selectedSessionId=\{selectedGallerySession\.id\}/);
  assert.match(gallerySource, /sessionScoped/);
  assert.doesNotMatch(gallerySource, /<ActivityRecordsTab[\s\S]*?selectedPatientSessions[\s\S]*?\/>[\s\S]*?<ActivityRecordsTab/);
});

test('consulta de mídias é filtrada no backend pela sessão selecionada e mantém compatibilidade legada', () => {
  const hookSource = fs.readFileSync(new URL('../src/lib/useActivityRecords.ts', import.meta.url), 'utf8');
  const clientSource = fs.readFileSync(new URL('../src/lib/activityRecordsApi.ts', import.meta.url), 'utf8');
  const apiSource = fs.readFileSync(new URL('../api/activity-records.js', import.meta.url), 'utf8');
  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityRecordsRepository.js', import.meta.url), 'utf8');
  assert.match(hookSource, /listActivityRecords\(patientId, sessionId \|\| undefined, \{ force \}\)/);
  assert.match(clientSource, /action: 'listRecords', patientId, sessionId/);
  assert.match(apiSource, /listActivityRecords\(context, patientId, sessionId\)/);
  assert.match(repositorySource, /where\('sessionIds', 'array-contains', normalizedSessionId\)/);
  assert.match(repositorySource, /where\('sessionId', '==', normalizedSessionId\)/);
  assert.match(repositorySource, /uniqueDocuments/);
});

test('foto do atendente usa ampliação clicável sem texto visível de instrução sobre a imagem', () => {
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  assert.match(gallerySource, /PatientPhoto/);
  assert.match(gallerySource, /expandable/);
  assert.doesNotMatch(gallerySource, />\s*Clique para ampliar\s*</);
});

test('hooks da galeria permanecem antes dos retornos condicionais de autenticação', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const authReturnIndex = appSource.indexOf('if (authLoading)');
  const gallerySummaryIndex = appSource.indexOf('getProfessionalActivityGallerySummary');
  assert.ok(authReturnIndex > 0, 'retorno condicional de autenticação não encontrado');
  assert.ok(gallerySummaryIndex > 0, 'efeito de resumo da galeria não encontrado');
  assert.ok(
    gallerySummaryIndex < authReturnIndex,
    'o efeito da Galeria de atividades deve ser declarado antes do retorno condicional de autenticação',
  );
  assert.ok(
    appSource.lastIndexOf('useEffect(') < authReturnIndex,
    'nenhum useEffect pode ser declarado depois do retorno condicional de autenticação',
  );
});

test('sessão inicial é pré-selecionada e o dropdown continua editável durante a preparação', () => {
  const modalSource = fs.readFileSync(new URL('../src/components/ActivityRecords/ActivityRecordModal.tsx', import.meta.url), 'utf8');
  assert.match(modalSource, /disabled=\{uploadLocked\}/);
  assert.match(modalSource, /const uploadLocked = stage === 'uploading' \|\| stage === 'finalizing'/);
  assert.doesNotMatch(modalSource, /initialSessionsLocked|metadataLocked/);
  assert.match(modalSource, /handleSessionGroupChange/);
  assert.match(modalSource, /getCurrentActivityMediaSessions/);
});


test('marca do menu lateral usa a mesma escala do cabeçalho e permanece em uma única linha', () => {
  const sidebarSource = fs.readFileSync(new URL('../src/components/Navigation/SidebarNavigation.tsx', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(sidebarSource, /bg-clinic-header/);
  assert.match(sidebarSource, /variant="horizontal"/);
  assert.doesNotMatch(sidebarSource, /variant="sidebar"/);
  assert.match(sidebarSource, /w-\[380px\]/);
  assert.match(sidebarSource, /w-\[min\(92vw,380px\)\]/);
  assert.match(appSource, /lg:pl-\[380px\]/);
  assert.match(sidebarSource, /whitespace-nowrap/);
  assert.match(sidebarSource, /min-h-\[88px\]/);
  assert.match(sidebarSource, /text-white\/80/);
});

test('cabeçalho mobile amplia a marca e mantém login e notificações na lateral', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(appSource, /navigationMode === 'top'[\s\S]*?'min-h-\[64px\] flex-nowrap gap-2/);
  assert.match(appSource, /md:hidden[\s\S]*?variant="horizontal"[\s\S]*?max-w-\[calc\(100vw-116px\)\][\s\S]*?whitespace-nowrap/);
  assert.doesNotMatch(appSource, /md:hidden[\s\S]*?variant="compact"/);
  assert.match(appSource, /flex shrink-0 items-center justify-end gap-2 sm:gap-4/);
  assert.doesNotMatch(appSource, /flex shrink-0 flex-wrap items-center justify-center/);
  assert.match(appSource, /h-9 w-9 rounded-full[\s\S]*?sm:h-10 sm:w-10/);
  assert.match(appSource, /flex h-9 w-9 items-center justify-center rounded-full[\s\S]*?sm:p-2/);
});


test('Fase 1 evita resumo duplicado e usa cache por usuário com atualização forçada apenas quando necessário', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const clientSource = fs.readFileSync(new URL('../src/lib/activityRecordsApi.ts', import.meta.url), 'utf8');

  assert.match(clientSource, /ACTIVITY_GALLERY_SUMMARY_CACHE_TTL_MS = 5 \* 60_000/);
  assert.match(clientSource, /activityGallerySummaryInFlight/);
  assert.match(clientSource, /scope === scope/);
  assert.match(clientSource, /getProfessionalActivityGallerySummary\(\s*options: \{ force\?: boolean \} = \{\}/);
  assert.match(appSource, /getProfessionalActivityGallerySummary\(\{ force \}\)/);
  assert.match(appSource, /const handleChanged = \(\) => void refresh\(true\)/);
  assert.match(appSource, /document\.visibilityState === 'visible'\) void refresh\(false\)/);
  assert.match(appSource, /\}, \[canAccessInternalSystem, user\?\.uid\]\);/);
  assert.doesNotMatch(appSource, /\[canAccessInternalSystem, state\.sessions, state\.settings\.activityMediaMonitoringStart, user\?\.uid\]/);
});

test('Fase 2A.1 ignora bootstrap de sessions antes de disparar refresh forçado da galeria', () => {
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const baselineStart = appSource.indexOf('let hasReceivedAuthoritativeSessionsSnapshot = false;');
  const listenerStart = appSource.indexOf("onSnapshot(collection(userDocRef, 'sessions'), { includeMetadataChanges: true }, (snapshot) => {", baselineStart);
  const listenerEnd = appSource.indexOf("}, (error) => handleFirestoreError(error, OperationType.GET, 'sessions'))", listenerStart);
  assert.ok(baselineStart > 0, 'controle de baseline autoritativo de sessões não encontrado');
  assert.ok(listenerStart > baselineStart, 'listener de sessions com includeMetadataChanges não encontrado depois do controle de baseline');
  assert.ok(listenerEnd > listenerStart, 'fim do listener de sessions não encontrado');

  const listenerSource = appSource.slice(baselineStart, listenerEnd);
  const metadataOptionsIndex = listenerSource.indexOf("{ includeMetadataChanges: true }");
  const setStateIndex = listenerSource.indexOf('setState(prev => ({ ...prev, sessions }))');
  const fromCacheIndex = listenerSource.indexOf('if (snapshot.metadata.fromCache) return;');
  const baselineCheckIndex = listenerSource.indexOf('if (!hasReceivedAuthoritativeSessionsSnapshot)');
  const baselineMarkIndex = listenerSource.indexOf('hasReceivedAuthoritativeSessionsSnapshot = true;', baselineCheckIndex);
  const docChangesIndex = listenerSource.indexOf('snapshot.docChanges().length > 0');
  const dispatchIndex = listenerSource.indexOf('window.dispatchEvent(new CustomEvent(ACTIVITY_GALLERY_CHANGED_EVENT');

  assert.ok(metadataOptionsIndex > 0, 'listener de sessions deve receber eventos de metadata para confirmar fromCache=false');
  assert.ok(setStateIndex > 0, 'estado local de sessions deve continuar sendo atualizado');
  assert.ok(fromCacheIndex > setStateIndex, 'snapshot de cache deve ser ignorado apenas depois de atualizar o estado local');
  assert.ok(baselineCheckIndex > fromCacheIndex, 'baseline autoritativo deve ser avaliado depois de descartar cache');
  assert.ok(baselineMarkIndex > baselineCheckIndex, 'primeiro snapshot autoritativo deve marcar o baseline');
  assert.ok(docChangesIndex > baselineMarkIndex, 'docChanges deve ser exigido apenas após o baseline autoritativo');
  assert.ok(dispatchIndex > docChangesIndex, 'evento da galeria deve depender de docChanges autoritativo posterior');
  assert.doesNotMatch(listenerSource, /docChanges\(\s*\{/);
  assert.doesNotMatch(listenerSource, /hadInitialSnapshot/);
});

test('resumo desativado retorna antes de consultar sessões do Firestore', () => {
  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityGalleryRepository.js', import.meta.url), 'utf8');
  const earlyReturnIndex = repositorySource.indexOf('if (summaryOnly && !monitoringStart)');
  const summaryQueryIndex = repositorySource.indexOf('const activitySessions = await listAccessibleActivitySessions(context);', earlyReturnIndex);

  assert.ok(earlyReturnIndex > 0, 'retorno antecipado sem monitoramento não encontrado');
  assert.ok(summaryQueryIndex > earlyReturnIndex, 'consulta de sessões do resumo não encontrada');
  assert.match(repositorySource.slice(earlyReturnIndex, summaryQueryIndex), /return \{/);
  assert.match(repositorySource.slice(earlyReturnIndex, summaryQueryIndex), /calculateGalleryMetrics\(\[\], new Map\(\), null, now\)/);
});

test('galeria não recarrega por mudança do array global e adia verificação de mídias legadas', () => {
  const gallerySource = fs.readFileSync(new URL('../src/components/ActivityRecords/ProfessionalActivityGallery.tsx', import.meta.url), 'utf8');
  const repositorySource = fs.readFileSync(new URL('../api/_lib/activityGalleryRepository.js', import.meta.url), 'utf8');

  assert.match(gallerySource, /useEffect\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\);/);
  assert.doesNotMatch(gallerySource, /\}, \[load, sessions\]\);/);
  assert.match(gallerySource, /load\(\{ force: true \}\)/);
  assert.match(gallerySource, /item\.hasAnyMedia === false/);
  assert.match(repositorySource, /hasAnyMedia: knownPatientsWithMedia\.has\(patient\.id\) \? true : null/);
  const offsetIndex = repositorySource.indexOf('const offset = (filters.page - 1) * filters.pageSize;');
  const returnIndex = repositorySource.indexOf('return {', offsetIndex);
  assert.doesNotMatch(repositorySource.slice(offsetIndex, returnIndex), /resolveLegacyMediaPresence/);
});

test('registros de atividade deduplicam chamadas e não recarregam a cada retorno rápido ao navegador', () => {
  const hookSource = fs.readFileSync(new URL('../src/lib/useActivityRecords.ts', import.meta.url), 'utf8');
  const clientSource = fs.readFileSync(new URL('../src/lib/activityRecordsApi.ts', import.meta.url), 'utf8');

  assert.match(hookSource, /ACTIVITY_RECORDS_VISIBILITY_REFRESH_INTERVAL_MS = 2 \* 60_000/);
  assert.match(hookSource, /inFlightRef/);
  assert.match(hookSource, /lastLoadedAtRef/);
  assert.match(hookSource, /const stale = Date\.now\(\) - lastLoadedAtRef\.current >= ACTIVITY_RECORDS_VISIBILITY_REFRESH_INTERVAL_MS/);
  assert.match(clientSource, /ACTIVITY_RECORD_LIST_CACHE_TTL_MS = 60_000/);
  assert.match(clientSource, /activityRecordListInFlight/);
  assert.match(clientSource, /invalidateActivityCaches\(patientId\)/);
});

test('visualização administrativa do Portal não repete o carregamento ao selecionar o responsável inicial', () => {
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');

  assert.match(portalSource, /const previewResponsibleUidRef = useRef\(''\)/);
  assert.match(portalSource, /const loadPortal = useCallback\(async \(responsibleUidOverride\?: string\)/);
  assert.match(portalSource, /requestedResponsibleUid = responsibleUidOverride \?\? previewResponsibleUidRef\.current/);
  assert.match(portalSource, /\}, \[adminPreview, user\]\);/);
  assert.doesNotMatch(portalSource, /\}, \[adminPreview, previewResponsibleUid, user\]\);/);
  assert.match(portalSource, /void loadPortal\(nextResponsibleUid\)/);
});
