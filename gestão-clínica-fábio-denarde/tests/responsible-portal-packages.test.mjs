import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResponsiblePackages,
  getPackageForMedia,
  sessionConsumesPackage,
} from '../api/_lib/responsiblePortalPackages.js';

test('falta só consome pacote quando o profissional decide', () => {
  assert.equal(sessionConsumesPackage({ status: 'Falta' }), false);
  assert.equal(sessionConsumesPackage({ status: 'Falta', consumesPackage: true }), true);
  assert.equal(sessionConsumesPackage({ status: 'Falta.Prof', consumesPackage: true }), false);
});

test('pacote atual avança depois de dez sessões consumidas', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index + 1}`,
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    time: '14:00',
    status: 'Realizada',
  }));
  const result = buildResponsiblePackages(sessions, { today: '2026-06-14' });
  assert.equal(result.currentPackageNumber, 2);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].number, 2);
  assert.equal(result.packages[0].consumedCount, 0);
});

test('sessões agendadas recebem posições sequenciais no pacote atual e futuro', () => {
  const sessions = [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `r${index + 1}`,
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      time: '14:00',
      status: 'Realizada',
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `a${index + 1}`,
      date: `2026-06-${String(index + 20).padStart(2, '0')}`,
      time: '14:00',
      status: 'Agendada',
    })),
  ];
  const result = buildResponsiblePackages(sessions, { today: '2026-06-14' });
  assert.equal(result.currentPackageNumber, 1);
  assert.deepEqual(result.packages.map(pkg => pkg.number), [1, 2]);
  assert.deepEqual(result.packages[0].sessions.filter(s => s.status === 'Agendada').map(s => s.sessionNumber), [9, 10]);
  assert.deepEqual(result.packages[1].sessions.map(s => s.sessionNumber), [1, 2]);
});

test('mídia usa vínculo da sessão e respeita a data atual', () => {
  const sessionMap = new Map([['s1', 1]]);
  const packages = [{ number: 1, startDate: '2026-06-01', endDate: '2026-06-30' }];
  assert.equal(getPackageForMedia({ sessionId: 's1', sessionDate: '2026-06-10' }, sessionMap, packages, '2026-06-14'), 1);
  assert.equal(getPackageForMedia({ sessionId: 's2', sessionDate: '2026-06-20' }, sessionMap, packages, '2026-06-14'), null);
});

test('portal oculta pacotes futuros, organiza mídias por sessão e oferece atualização cadastral', async () => {
  const fs = await import('node:fs');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  assert.match(portalSource, /filter\(pkg => pkg\.status !== 'future'\)/);
  assert.match(portalSource, /toggleSessionGroup/);
  assert.match(portalSource, /Atualizar cadastro/);
  assert.match(portalSource, /patientPhotoExpanded/);
  assert.match(accessSource, /DEFAULT_PROFESSIONAL_NAME = 'Fábio Denarde'/);
  assert.match(accessSource, /return 'Intervenção'/);
  assert.match(accessSource, /updateResponsiblePatient/);
});

test('URLs assinadas preferem a origem local confiável para funcionar em rede privada', async () => {
  const fs = await import('node:fs');
  const mediaDriveSource = fs.readFileSync(new URL('../api/_lib/activityRecordsDrive.js', import.meta.url), 'utf8');
  const photoDriveSource = fs.readFileSync(new URL('../api/_lib/googleDrive.js', import.meta.url), 'utf8');
  for (const source of [mediaDriveSource, photoDriveSource]) {
    assert.match(source, /function preferredSignedUrlOrigin\(req\)/);
    assert.match(source, /isPrivateLan/);
    assert.match(source, /preferredSignedUrlOrigin\(req\)/);
  }
});


test('portal mantém as abas principais e substitui a galeria anterior pela nova experiência', async () => {
  const fs = await import('node:fs');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const responsibleGallerySource = fs.readFileSync(new URL('../src/components/GooglePhotosAlbums/ResponsibleGooglePhotosGallery.tsx', import.meta.url), 'utf8');
  assert.match(portalSource, /type PortalTab = 'dashboard' \| 'sessions' \| 'gallery' \| 'profile'/);
  assert.match(portalSource, /Resumo geral/);
  assert.match(portalSource, /Sessões agendadas/);
  assert.match(portalSource, /Galeria de atividades/);
  assert.match(responsibleGallerySource, /Abrir Atividade/);
  assert.doesNotMatch(responsibleGallerySource, /Abrir álbum/);
  assert.doesNotMatch(portalSource, /Galeria de atividades \(Google Fotos\)/);
  assert.doesNotMatch(portalSource, /id: 'googlePhotos'/);
  assert.match(portalSource, /Atualização cadastral/);
  assert.match(portalSource, /GRADE_OPTIONS/);
  assert.match(portalSource, /SHIFT_OPTIONS/);
  assert.match(portalSource, /<ResponsibleGooglePhotosGallery/);
  assert.doesNotMatch(portalSource, /Carregar mais mídias/);
  assert.match(portalSource, /showSaveFilePicker/);
  assert.doesNotMatch(portalSource, /target === 'instagram'[\s\S]{0,500}wa\.me/);
});

test('documentos do responsável usam Drive, aparecem no cadastro profissional e notificam pelo sino', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const driveSource = fs.readFileSync(new URL('../api/_lib/googleDrive.js', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const patientsSource = fs.readFileSync(new URL('../src/components/Patients.tsx', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(accessSource, /prepareResponsibleDocumentUpload/);
  assert.match(accessSource, /finalizeResponsibleDocumentUpload/);
  assert.match(accessSource, /patient_document_upload/);
  assert.match(accessSource, /portalNotifications/);
  assert.match(driveSource, /createResponsibleDocumentUploadSession/);
  assert.match(driveSource, /responsible-portal-document/);
  assert.match(portalSource, /Enviar documento/);
  assert.match(patientsSource, /Enviados pelo responsável/);
  assert.match(appSource, /getProfessionalPortalNotifications/);
  assert.match(appSource, /<Bell/);
});


test('portal substitui a galeria individual pela galeria de atividades sob demanda', async () => {
  const fs = await import('node:fs');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  assert.match(portalSource, /activePortalTab === 'gallery' && patientData/);
  assert.match(portalSource, /<ResponsibleGooglePhotosGallery/);
  assert.doesNotMatch(portalSource, /activePortalTab === 'googlePhotos'/);
  assert.doesNotMatch(portalSource, /Carregar mais mídias/);
  assert.match(accessSource, /const media = \[\];/);
  const responsibleLoader = accessSource.slice(
    accessSource.indexOf('async function getResponsiblePortalData'),
    accessSource.indexOf('async function listAdminResponsiblePreviewOptions'),
  );
  assert.doesNotMatch(responsibleLoader, /activityRecords/);
  assert.doesNotMatch(responsibleLoader, /portalMediaInteractions/);
});

test('notificações profissionais ficam restritas a login, galeria e atualização cadastral', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const apiClientSource = fs.readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(accessSource, /type: 'portal_access'/);
  assert.match(accessSource, /type: 'patient_profile_update'/);
  assert.match(accessSource, /type: 'gallery_access'/);
  assert.match(accessSource, /passiveActions/);
  assert.match(accessSource, /return \{ recorded: false, notificationId: null \}/);
  assert.match(apiClientSource, /portalSessionId: getResponsiblePortalSessionId\(\)/);
  assert.match(portalSource, /responsible-gallery-notified:/);
  assert.doesNotMatch(portalSource, /eventType: 'media_view'/);
  assert.doesNotMatch(portalSource, /eventType: 'media_download'/);
  assert.doesNotMatch(portalSource, /eventType: 'media_share_instagram'/);
  assert.doesNotMatch(appSource, /NOTIFICATION_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(appSource, /notificationRefreshTimerRef/);
  assert.match(appSource, /refreshPortalNotifications\(\{ initial: true, force: true \}\)/);
  assert.match(appSource, /refreshPortalNotifications\(\{ force: true \}\)/);
});


test('foto do atendente fica maior, sem legenda sobreposta e continua ampliável ao clicar', async () => {
  const fs = await import('node:fs');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  assert.match(portalSource, /sm:h-32 sm:w-32/);
  assert.match(portalSource, /setPatientPhotoExpanded\(true\)/);
  assert.doesNotMatch(portalSource, /Clique para ampliar/);
});

test('atualização cadastral gera uma única notificação consolidada com antes e depois', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(accessSource, /RESPONSIBLE_PATIENT_FIELD_LABELS/);
  assert.match(accessSource, /previousValue/);
  assert.match(accessSource, /newValue/);
  assert.match(accessSource, /Cadastro atualizado pelo responsável/);
  assert.doesNotMatch(accessSource, /portalPatientUpdates/);
  assert.doesNotMatch(accessSource, /portalAudit/);
  assert.doesNotMatch(portalSource, /eventType: session\.mediaType === 'video'/);
  assert.match(appSource, /Comparação visual do que foi alterado/);
});


test('curtidas e comentários permanecem funcionais sem criar notificação ou auditoria', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/ResponsiblePortal.tsx', import.meta.url), 'utf8');

  assert.match(accessSource, /portalMediaInteractions/);
  assert.match(accessSource, /media_like/);
  assert.match(accessSource, /media_comment/);
  assert.match(accessSource, /recorded: false/);
  assert.doesNotMatch(accessSource, /shouldConsolidateMediaView/);
  assert.doesNotMatch(accessSource, /Tempo efetivamente reproduzido/);
  assert.match(portalSource, /eventType: nextLiked \? 'media_like' : 'media_unlike'/);
  assert.match(portalSource, /eventType: 'media_comment'/);
  assert.doesNotMatch(portalSource, /eventType: 'video_playback'/);
});


test('controle de acesso reduz consumo de cota e trata indisponibilidade sem expor erro interno', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const apiClientSource = fs.readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');

  assert.match(accessSource, /if \(profileSnapshot\.exists\) \{\s*return profileSnapshot;/);
  assert.match(accessSource, /PRIMARY_ADMIN_UID_CACHE_TTL_MS/);
  assert.match(accessSource, /PROFESSIONAL_NOTIFICATION_INITIAL_LIMIT = 20/);
  assert.match(accessSource, /where\('updatedAt', '>', updatedAfter\)/);
  assert.match(accessSource, /access\/quota-temporarily-unavailable/);
  assert.match(accessSource, /portalSessionId/);
  assert.match(accessSource, /last-portal-access/);
  assert.match(accessSource, /last-gallery-access/);

  assert.match(apiClientSource, /accessProfileRequests/);
  assert.match(apiClientSource, /accessProfileBackoffByUid/);
  assert.match(apiClientSource, /ACCESS_PROFILE_QUOTA_BACKOFF_MS/);
  assert.match(apiClientSource, /updatedAfter/);
  assert.match(apiClientSource, /responsible-portal-session/);

  assert.match(appSource, /NOTIFICATION_MANUAL_MIN_INTERVAL_MS = 5 \* 1000/);
  assert.doesNotMatch(appSource, /NOTIFICATION_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(appSource, /NOTIFICATION_MAX_RETRY_INTERVAL_MS/);
  assert.match(appSource, /mergePortalNotifications/);
  assert.doesNotMatch(appSource, /5000\)/);

  assert.match(typesSource, /updatedAt: string \| null/);
});



test('central de notificações possui pendentes, não lidas, histórico e ações em lote', async () => {
  const fs = await import('node:fs');
  const centerSource = fs.readFileSync(new URL('../src/components/Notifications/NotificationCenter.tsx', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(centerSource, /Pendentes/);
  assert.match(centerSource, /Não lidas/);
  assert.match(centerSource, /Histórico/);
  assert.match(centerSource, /Selecionar página/);
  assert.match(centerSource, /Limpar lidas informativas/);
  assert.match(centerSource, /Arquivar todas as lidas/);
  assert.match(centerSource, /Excluir todas as arquivadas/);
  assert.match(centerSource, /Marcar como lida sem abrir/);
  assert.match(appSource, /notificationAttentionCount/);
  assert.match(appSource, /Ver todas/);
  assert.doesNotMatch(appSource, /markProfessionalPortalNotificationsRead/);
});

test('login e galeria atualizam registros estáveis sem acumular documentos', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  assert.match(accessSource, /last-portal-access/);
  assert.match(accessSource, /last-gallery-access/);
  assert.match(accessSource, /lastAccessAt/);
  assert.match(accessSource, /lastGalleryAccessAt/);
  assert.match(accessSource, /\{ merge: true \}/);
  assert.doesNotMatch(accessSource, /portalSessionId}:portal-access/);
  assert.doesNotMatch(accessSource, /portalSessionId}:gallery-access/);
});

test('atualizações cadastrais e documentos são pendentes e protegidos contra exclusão', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');
  assert.match(accessSource, /notificationPendingForType/);
  assert.match(accessSource, /notificationProtectedFromDeletion/);
  assert.match(accessSource, /patient_profile_update/);
  assert.match(accessSource, /patient_document_upload/);
  assert.match(accessSource, /operation === 'complete'/);
  assert.match(accessSource, /lifecycle\.protectedFromDeletion/);
  assert.match(typesSource, /pendingAction: boolean/);
  assert.match(typesSource, /protectedFromDeletion: boolean/);
});

test('notificações usam paginação de vinte itens e atualização manual', async () => {
  const fs = await import('node:fs');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const apiClientSource = fs.readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(accessSource, /PROFESSIONAL_NOTIFICATION_INITIAL_LIMIT = 20/);
  assert.match(accessSource, /requestedLimit \+ 1/);
  assert.match(accessSource, /nextPageCursor/);
  assert.match(apiClientSource, /before\?: string \| null/);
  assert.match(appSource, /loadOlderPortalNotifications/);
  assert.match(appSource, /limit: 20/);
  assert.doesNotMatch(appSource, /setInterval/);
});


test('painel rápido do sininho oferece ações independentes com legendas', async () => {
  const fs = await import('node:fs');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');

  assert.match(appSource, /Ações rápidas da notificação/);
  assert.match(appSource, /Marcar como não lida/);
  assert.match(appSource, /Arquivar notificação/);
  assert.match(appSource, /Excluir definitivamente/);
  assert.match(appSource, /event\.stopPropagation\(\)/);
  assert.match(appSource, /notification\.read \? 'mark_unread' : 'mark_read'/);
  assert.match(accessSource, /'mark_unread'/);
  assert.match(accessSource, /update\.read = false/);
  assert.match(typesSource, /\| 'mark_unread'/);
});
