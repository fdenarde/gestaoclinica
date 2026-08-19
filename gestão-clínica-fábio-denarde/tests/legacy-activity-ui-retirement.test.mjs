import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const patientsSource = fs.readFileSync('src/components/Patients.tsx', 'utf8');
const agendaSource = fs.readFileSync('src/components/Agenda.tsx', 'utf8');
const dashboardSource = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
const gallerySource = fs.readFileSync('src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', 'utf8');
const sidebarSource = fs.readFileSync('src/components/Navigation/SidebarNavigation.tsx', 'utf8');
const portalSource = fs.readFileSync('src/components/Auth/ResponsiblePortal.tsx', 'utf8');
const accessPortalSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const reportsSource = fs.readFileSync('src/components/Reports.tsx', 'utf8');
const whatsappReportSource = fs.readFileSync('src/lib/whatsappOperationalReport.ts', 'utf8');
const whatsappPanelSource = fs.readFileSync('src/components/WhatsApp/WhatsappOperationalReportPanel.tsx', 'utf8');

const activeUiSource = [appSource, patientsSource, agendaSource, dashboardSource].join('\n');

test('botão do card do atendente abre a nova Galeria de Atividades do atendente específico', () => {
  assert.match(patientsSource, /onNavigateToPatientGallery\?\.\(patient\.id\)/);
  assert.match(patientsSource, /Abrir Galeria de Atividades de \$\{patient\.name\}/);
  assert.doesNotMatch(patientsSource, /handleQuickActivity/);
  assert.doesNotMatch(patientsSource, /<ActivityRecordModal/);
});

test('atalhos da Agenda convergem para a mesma galeria sem abrir o modal antigo', () => {
  assert.match(agendaSource, /handleOpenActivityGallery/);
  assert.match(agendaSource, /onNavigateToPatientGallery\(patient\.id, targetSessionId\)/);
  assert.match(agendaSource, /Registrar atividade/);
  assert.doesNotMatch(agendaSource, /ActivityRecordModal/);
  assert.doesNotMatch(agendaSource, /Ver Galeria de Mídias/);
});

test('atalho explícito transporta atendente e sessão e abre o card correto sob demanda', () => {
  assert.match(appSource, /const openActivityGallery = \(\s*patientId: string \| null = null,\s*sessionId: string \| null = null/);
  assert.match(appSource, /setSelectedGalleryPatientId\(patientId\)/);
  assert.match(appSource, /setSelectedGallerySessionId\(sessionId\)/);
  assert.match(appSource, /initialPatientId=\{selectedGalleryPatientId\}/);
  assert.match(appSource, /initialSessionId=\{selectedGallerySessionId\}/);
  assert.match(gallerySource, /initialPatientId\?: string \| null/);
  assert.match(gallerySource, /initialSessionId\?: string \| null/);
  assert.match(gallerySource, /card\.sessionIds\.includes\(initialSessionId\)/);
  assert.match(gallerySource, /useState\(\(\) => String\(initialPatientId \|\| ''\)\.trim\(\)\)/);
});

test('entrada pelo menu continua sem selecionar atendente automaticamente', () => {
  assert.match(appSource, /if \(id === 'galeria-atividades'\)[\s\S]*setSelectedGalleryPatientId\(null\)/);
  assert.match(gallerySource, /Selecione o atendente/);
});

test('aba e modal antigos ficam ocultos da interface ativa, mas os arquivos históricos são preservados', () => {
  assert.doesNotMatch(activeUiSource, /ProfessionalActivityGallery/);
  assert.doesNotMatch(activeUiSource, /ActivityRecordsTab/);
  assert.doesNotMatch(activeUiSource, /ActivityRecordModal/);
  assert.doesNotMatch(patientsSource, /fullLabel: 'Registros de Atividades'/);
  assert.ok(fs.existsSync('src/components/ActivityRecords/ProfessionalActivityGallery.tsx'));
  assert.ok(fs.existsSync('src/components/ActivityRecords/ActivityRecordsTab.tsx'));
  assert.ok(fs.existsSync('src/components/ActivityRecords/ActivityRecordModal.tsx'));
  assert.ok(fs.existsSync('api/activity-records.js'));
});

test('notificações antigas não carregam nem reproduzem mídia legada automaticamente', () => {
  assert.doesNotMatch(appSource, /getActivityPhotoUrl/);
  assert.doesNotMatch(appSource, /notificationMediaUrl/);
  assert.doesNotMatch(appSource, /Mídia acessada pelo responsável/);
  assert.match(appSource, /navigateToPatientGallery\(notification\.patientId\)/);
});

test('dashboard não mantém indicador de upload da galeria antiga', () => {
  assert.doesNotMatch(dashboardSource, /activityUploadLateSessionCount/);
  assert.doesNotMatch(dashboardSource, /upload de mídia atrasado/);
  assert.doesNotMatch(dashboardSource, /registrar as mídias ou justificar/);
});

test('mudança de interface não contém exclusão ou limpeza de dados históricos', () => {
  assert.doesNotMatch(activeUiSource, /deleteActivity|removeActivity|purgeActivity|cleanupActivity/i);
  assert.match(patientsSource, /registros históricos de atividades preservados/);
});

test('logo navega para início permitido e relatório WhatsApp usa fonte compartilhada sem envio real', () => {
  assert.match(appSource, /const navigateToProfileHome = \(\) => \{/);
  assert.match(appSource, /onHome=\{navigateToProfileHome\}/);
  assert.match(appSource, /aria-label="Ir para a página inicial"/);
  assert.match(sidebarSource, /onHome: \(\) => void/);
  assert.match(sidebarSource, /aria-label="Ir para a página inicial"/);
  assert.match(portalSource, /onClick=\{\(\) => setActivePortalTab\('dashboard'\)\}/);
  assert.match(portalSource, /aria-label="Ir para a página inicial do Portal do Responsável"/);

  assert.match(whatsappReportSource, /WHATSAPP_ADMIN_REPORT_RECIPIENT = '27999072659'/);
  assert.match(whatsappReportSource, /SAO_PAULO_TIME_ZONE = 'America\/Sao_Paulo'/);
  assert.match(whatsappReportSource, /getMsUntilNextSaoPauloMidnight/);
  assert.match(appSource, /useDailyWhatsappOperationalReport/);
  assert.match(appSource, /whatsappReportState=\{whatsappOperationalReportState\}/);
  assert.match(dashboardSource, /WhatsappOperationalReportPanel/);
  assert.match(reportsSource, /WhatsappOperationalReportPanel/);
  assert.match(reportsSource, /activeReportTab === 'whatsapp' && isAdmin/);
  assert.match(whatsappPanelSource, /WhatsApp/);
  assert.doesNotMatch(dashboardSource + reportsSource, /sendMessage|Client\(|LocalAuth|initialize\(\)/);
});

test('validação visual por perfil permanece segura sem abrir Firebase real', () => {
  assert.match(appSource, /const canAccessInternalSystem =[\s\S]*accessProfile\.role === 'admin' \|\| accessProfile\.role === 'professional'/);
  assert.match(appSource, /const canAccessResponsiblePortal =[\s\S]*accessProfile\.role === 'responsible'/);
  assert.match(accessPortalSource, /profile\.status === 'approved' && profile\.role === 'monitoring'/);
  assert.match(appSource, /const canAccessMonitoringPanel =[\s\S]*accessProfile\.role === 'monitoring'/);
  assert.match(appSource, /<MonitoringPanel[\s\S]*onLogout=\{\(\) => void handleAccessPortalLogout\(\)\}/);

  assert.match(reportsSource, /\{isAdmin && \(/);
  assert.match(reportsSource, /visibleReportTab = activeReportTab === 'whatsapp' && isAdmin \? 'whatsapp' : 'clinical'/);
  assert.match(appSource, /<Reports state=\{state\} onUpdate=\{updateState\} isAdmin=\{accessProfile\?\.role === 'admin'\}/);

  assert.match(appSource, /accessProfile\.role === 'admin'/);
  assert.match(dashboardSource, /canViewWhatsappReport/);
  assert.match(dashboardSource, /whatsappReportState: WhatsappOperationalReportState/);
  assert.match(reportsSource, /whatsappReportState: WhatsappOperationalReportState/);
  assert.doesNotMatch(dashboardSource + reportsSource, /buildWhatsappOperationalReport/);

  assert.match(portalSource, /type PortalTab = 'dashboard' \| 'sessions' \| 'gallery' \| 'profile'/);
  assert.doesNotMatch(portalSource, /activePortalTab === 'relatorios'|activePortalTab === 'admin'|setActivePortalTab\('relatorios'\)|setActivePortalTab\('admin'\)/);
});
