import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
const permissionsSource = fs.readFileSync(new URL('../api/_lib/accessPermissions.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const panelSource = fs.readFileSync(new URL('../src/components/Monitoring/MonitoringPanel.tsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');
const centerSource = fs.readFileSync(new URL('../src/components/Notifications/NotificationCenter.tsx', import.meta.url), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Trecho inicial não encontrado: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Trecho final não encontrado: ${end}`);
  return source.slice(from, to);
}

test('central administrativa exige o administrador principal', () => {
  const block = between(accessSource, 'async function requireInternalNotificationContext', 'function notificationCategoryForType');
  assert.match(block, /requirePrimaryAdmin\(decodedToken\)/);
  assert.doesNotMatch(block, /professionalProfile/);
});

test('Profissional e Monitoramento não recebem notifications.manage', () => {
  const professional = between(permissionsSource, 'const PROFESSIONAL_PERMISSIONS', 'const RESPONSIBLE_PERMISSIONS');
  const monitoring = between(permissionsSource, 'const MONITORING_PERMISSIONS', 'export const DEFAULT_ROLE_PERMISSIONS');
  const professionalCeiling = between(permissionsSource, 'const PROFESSIONAL_PERMISSION_CEILING', 'const RESPONSIBLE_PERMISSION_CEILING');
  const monitoringCeiling = between(permissionsSource, 'const MONITORING_PERMISSION_CEILING', 'const CONTEXT_PERMISSION_CEILINGS');
  for (const block of [professional, monitoring, professionalCeiling, monitoringCeiling]) {
    assert.doesNotMatch(block, /notifications\.manage/);
  }
});

test('Responsável mantém somente os quatro tipos já aprovados no sino', () => {
  for (const type of ['portal_access', 'gallery_access', 'patient_profile_update', 'patient_document_upload']) {
    assert.match(accessSource, new RegExp(`type: '${type}'`));
  }
});

test('backend do Monitoramento aceita somente login, Agenda e Galeria', () => {
  const block = between(accessSource, 'async function recordMonitoringAction', 'async function getMonitoringPanelData');
  assert.match(block, /\['session_start', 'tab_access'\]/);
  assert.match(accessSource, /const MONITORING_NOTIFICATION_TABS = new Set\(\['agenda', 'galeria'\]\)/);
  assert.match(block, /monitoring_login/);
  assert.match(block, /monitoring_tab_access/);
  assert.match(block, /db\.getAll/);
  assert.match(block, /monitoringSessionId/);
  assert.doesNotMatch(block, /monitoring_logout/);
  assert.doesNotMatch(block, /monitoring_panel_access/);
  assert.doesNotMatch(block, /'dashboard'/);
});

test('API expõe somente gravação autenticada de login e abas necessárias', () => {
  assert.match(accessSource, /body\.action === 'recordMonitoringAction'/);
  assert.match(accessSource, /verifyFirebaseRequest\(req\)/);
  assert.match(apiSource, /recordMonitoringSessionStart/);
  assert.match(apiSource, /recordMonitoringTabAccess/);
  assert.doesNotMatch(apiSource, /recordMonitoringLogout/);
});

test('entrada inicial registra somente login, sem acesso genérico ou Dashboard', () => {
  assert.match(panelSource, /if \(!adminPreview\)[\s\S]*recordMonitoringSessionStart\(\)/);
  assert.match(accessSource, /\['monitoring_login', ''\]/);
  assert.doesNotMatch(accessSource, /monitoring_panel_access/);
  assert.doesNotMatch(accessSource, /\['monitoring_tab_access', 'dashboard'\]/);
});

test('troca real de aba registra somente Agenda e Galeria uma vez por sessão', () => {
  assert.match(panelSource, /if \(tab === activeTab\) return/);
  assert.match(panelSource, /tab === 'agenda' \|\| tab === 'galeria'/);
  assert.match(panelSource, /recordMonitoringTabAccess\(tab\)/);
  assert.match(panelSource, /onClick=\{\(\) => changeMonitoringTab\(tab\.id\)\}/);
  assert.match(accessSource, /crypto\.createHash\('sha256'\)/);
  assert.match(accessSource, /existingSnapshots/);
  assert.match(accessSource, /missingNotifications\.length === 0/);
});

test('logout do Monitoramento apenas limpa a sessão local e sai da conta', () => {
  const block = between(appSource, 'const handleAccessPortalLogout', 'const resetSessionScopedData');
  assert.match(block, /accessProfile\?\.role === 'monitoring'/);
  assert.match(block, /clearMonitoringSessionId/);
  assert.match(block, /await logout\(\)/);
  assert.doesNotMatch(block, /recordMonitoringLogout/);
});

test('sino e Central de Notificações ficam visíveis somente ao Administrador', () => {
  assert.match(appSource, /const canManagePortalNotifications =[\s\S]*accessProfile\.role === 'admin'/);
  assert.match(appSource, /\{canManagePortalNotifications && \([\s\S]*aria-label="Abrir notificações"/);
  assert.match(appSource, /\{canManagePortalNotifications && \([\s\S]*<NotificationCenter/);
});

test('modelo e interface distinguem Monitoramento de Responsável', () => {
  assert.match(typesSource, /actorRole: AccessRole \| null/);
  assert.match(typesSource, /\| 'monitoring'/);
  assert.match(typesSource, /MonitoringNotificationTab = 'agenda' \| 'galeria'/);
  assert.match(centerSource, /monitoring: 'Monitoramento'/);
  assert.match(centerSource, /Ações do sistema/);
  assert.match(centerSource, /notification\.actorName/);
});
