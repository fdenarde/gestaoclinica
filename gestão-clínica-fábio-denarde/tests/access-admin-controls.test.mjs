import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEffectiveAccessContext,
} from '../api/_lib/accessPermissions.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
const accessApiSource = fs.readFileSync(new URL('../src/lib/accessApi.ts', import.meta.url), 'utf8');
const accessPortalSource = fs.readFileSync(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
const adminCardSource = fs.readFileSync(new URL('../src/components/Auth/AccessRequestsAdminCard.tsx', import.meta.url), 'utf8');
const modalSource = fs.readFileSync(new URL('../src/components/Common/Modal.tsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const previewSource = fs.existsSync(new URL('../src/components/Monitoring/MonitoringUiPreview.tsx', import.meta.url))
  ? fs.readFileSync(new URL('../src/components/Monitoring/MonitoringUiPreview.tsx', import.meta.url), 'utf8')
  : '';
const visualChecklistSource = fs.existsSync(new URL('../docs/VALIDACAO_VISUAL_MONITORAMENTO.md', import.meta.url))
  ? fs.readFileSync(new URL('../docs/VALIDACAO_VISUAL_MONITORAMENTO.md', import.meta.url), 'utf8')
  : '';
const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');

function buildMonitoring(profileOverrides = {}) {
  return buildEffectiveAccessContext({
    decodedToken: { uid: 'monitor-uid', email: 'monitor@example.com', name: 'Monitor' },
    profile: {
      role: 'monitoring',
      status: 'approved',
      workspaceId: 'clinic-workspace',
      linkedPatientIds: [],
      ...profileOverrides,
    },
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
  });
}

test('estado information_requested existe e não concede acesso aprovado', () => {
  assert.match(typesSource, /'information_requested'/);
  assert.match(accessSource, /information_requested/);
  assert.throws(
    () => buildMonitoring({ status: 'information_requested' }),
    error => error.code === 'access/approved-profile-required',
  );
});

test('suspensão ativa bloqueia Monitoramento e reativação remove somente a suspensão', () => {
  assert.throws(
    () => buildMonitoring({ suspension: { active: true, reason: 'Teste' } }),
    error => error.code === 'access/account-suspended',
  );
  assert.doesNotThrow(() => buildMonitoring({ suspension: { active: false, reason: 'Teste' } }));
});

test('validade ausente ou futura permite acesso e validade vencida bloqueia com mensagem de Monitoramento', () => {
  assert.doesNotThrow(() => buildMonitoring({ expiresAt: null }));
  assert.doesNotThrow(() => buildMonitoring({ expiresAt: '2999-01-01T03:00:00.000Z' }));
  assert.throws(
    () => buildMonitoring({ expiresAt: '2020-01-01T03:00:00.000Z' }),
    error => error.code === 'access/temporary-access-expired'
      && /Monitoramento expirou/.test(error.message),
  );
});

test('API expõe ações administrativas explícitas e exclusivas do administrador', () => {
  for (const action of [
    'suspendAccess',
    'reactivateAccess',
    'updateAccessValidity',
    'requestAdditionalInformation',
  ]) {
    assert.match(accessSource, new RegExp(`body\\.action === '${action}'`));
  }
  assert.match(accessSource, /requirePrimaryAdmin\(decodedToken\);[\s\S]*suspendAccess/);
  assert.match(accessSource, /requirePrimaryAdmin\(decodedToken\);[\s\S]*reactivateAccess/);
  assert.match(accessSource, /requirePrimaryAdmin\(decodedToken\);[\s\S]*updateAccessValidity/);
  assert.match(accessSource, /requirePrimaryAdmin\(decodedToken\);[\s\S]*requestAdditionalInformation/);
});

test('solicitante responde informações adicionais sem poder alterar campos administrativos', () => {
  assert.match(accessSource, /body\.action === 'respondAdditionalInformation'/);
  assert.match(accessSource, /requestDocumentId\(normalizedEmail, decodedToken\.uid\)/);
  assert.match(accessSource, /request\.uid[\s\S]*decodedToken\.uid/);
  assert.match(accessSource, /status: 'pending'/);
  assert.doesNotMatch(accessSource, /respondAdditionalInformation[\s\S]{0,1200}approvedAt/);
});

test('mensagens vazias e datas inválidas são rejeitadas no servidor', () => {
  assert.match(accessSource, /empty-information-request/);
  assert.match(accessSource, /empty-information-response/);
  assert.match(accessSource, /invalid-expiration-date/);
  assert.match(accessSource, /parseSaoPauloEndOfDay/);
});

test('interface pública mostra pergunta como texto e envia resposta para análise', () => {
  assert.match(accessPortalSource, /profile\.status === 'information_requested'/);
  assert.match(accessPortalSource, /informationRequestMessage/);
  assert.match(accessPortalSource, /informationRequestedAt/);
  assert.match(accessPortalSource, /\{informationResponse\.length\}\/1200/);
  assert.match(accessPortalSource, /Enviar informações para análise/);
  assert.match(accessPortalSource, /respondAdditionalAccessInformation/);
  assert.match(accessPortalSource, /profile\.status === 'pending' && profile\.informationRequestMessage/);
  assert.doesNotMatch(accessPortalSource, /dangerouslySetInnerHTML/);
});

test('painel administrativo apresenta ações por estado, validade e histórico de pergunta e resposta', () => {
  assert.match(adminCardSource, /Solicitar mais informações/);
  assert.match(adminCardSource, /Suspender acesso/);
  assert.match(adminCardSource, /Reativar acesso/);
  assert.match(adminCardSource, /Definir validade|Alterar validade/);
  assert.match(adminCardSource, /informationRequestMessage/);
  assert.match(adminCardSource, /informationResponseMessage/);
  assert.match(adminCardSource, /validityLabel/);
  assert.doesNotMatch(adminCardSource, /dangerouslySetInnerHTML/);
});

test('controles administrativos usam modais em vez de prompts nativos', () => {
  assert.match(adminCardSource, /import Modal from '..\/Common\/Modal'/);
  assert.match(adminCardSource, /type AdminActionKind = 'approveMonitoring' \| 'requestInformation' \| 'suspend' \| 'reactivate' \| 'validity' \| 'revoke' \| 'deleteAccess'/);
  assert.match(adminCardSource, /openActionModal\('suspend'/);
  assert.match(adminCardSource, /openActionModal\('reactivate'/);
  assert.match(adminCardSource, /openActionModal\('validity'/);
  assert.match(adminCardSource, /openActionModal\('requestInformation'/);
  assert.match(adminCardSource, /openActionModal\('revoke'/);
  assert.match(adminCardSource, /openActionModal\('deleteAccess'/);
  assert.doesNotMatch(adminCardSource, /window\.prompt|\bprompt\(/);
  assert.doesNotMatch(adminCardSource, /window\.confirm|\bconfirm\(/);
  assert.doesNotMatch(adminCardSource, /window\.alert|\balert\(/);
});

test('modais administrativos validam campos, datas e envio duplo sem chamar API direto no clique', () => {
  assert.match(adminCardSource, /SUSPENSION_REASON_MAX_LENGTH = 500/);
  assert.match(adminCardSource, /INFORMATION_MESSAGE_MAX_LENGTH = 1200/);
  assert.match(adminCardSource, /normalizeModalText/);
  assert.match(adminCardSource, /isValidDateInput/);
  assert.match(adminCardSource, /type="date"/);
  assert.match(adminCardSource, /validityMode === 'none'/);
  assert.match(adminCardSource, /Sem prazo/);
  assert.match(adminCardSource, /Válido até uma data/);
  assert.match(adminCardSource, /actionSubmittingRef/);
  assert.match(adminCardSource, /if \(!actionModal \|\| reviewingId \|\| actionSubmittingRef\.current\) return/);
  assert.match(adminCardSource, /setModalError\('Informe a mensagem que será enviada ao solicitante\.'/);
  assert.match(adminCardSource, /setModalError\('Informe uma data válida no formato AAAA-MM-DD\.'/);
});

test('modal comum oferece semântica acessível, escape, foco e bloqueio durante envio', () => {
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(modalSource, /aria-labelledby/);
  assert.match(modalSource, /initialFocusRef/);
  assert.match(modalSource, /previousFocusRef/);
  assert.match(modalSource, /event\.key === 'Escape' && !closeDisabled/);
  assert.match(modalSource, /disabled=\{closeDisabled\}/);
});

test('prévia visual local é protegida por DEV e variável explícita', () => {
  assert.match(appSource, /import\.meta\.env\.DEV && import\.meta\.env\.VITE_MONITORING_UI_PREVIEW === 'true'/);
  assert.match(appSource, /\/dev\/monitoring-ui-preview/);
  assert.match(appSource, /MonitoringUiPreview/);
  assert.match(previewSource, /MONITORING_UI_PREVIEW_LOCAL_ONLY/);
  assert.match(previewSource, /previewRequests=\{requests\}/);
  assert.match(previewSource, /onPreviewAction=\{handlePreviewAction\}/);
  assert.match(adminCardSource, /previewRequests\?: AccessRequestRecord\[\]/);
  assert.match(adminCardSource, /onPreviewAction\?: \(input: AccessAdminMockActionInput\) => Promise<AccessRequestRecord>/);
});

test('prévia visual usa apenas dados fictícios e não chama APIs reais diretamente', () => {
  assert.match(previewSource, /usuario\.teste@example\.invalid/);
  assert.match(previewSource, /admin\.teste@example\.invalid/);
  assert.match(previewSource, /27999990000/);
  assert.match(previewSource, /mock-monitoring-/);
  assert.doesNotMatch(previewSource, /fdenarde@gmail\.com|Fábio Denarde|Fabio Denarde/);
  assert.doesNotMatch(previewSource, /firebase|firestore|auth\.|db\.|getMonitoringPanelData|listAccessRequests|reviewAccessRequest|revokeAccessRequest/);
  if (visualChecklistSource) {
    assert.match(visualChecklistSource, /http:\/\/localhost:3000\/dev\/monitoring-ui-preview/);
    assert.match(visualChecklistSource, /VITE_MONITORING_UI_PREVIEW=true/);
  }
});

test('perfil revogado exibe exclusão de cadastro e perfil aprovado exige revogação primeiro', () => {
  assert.match(adminCardSource, /function canDeleteAccessRegistration/);
  assert.match(adminCardSource, /\['rejected', 'revoked', 'disabled', 'canceled'\]\.includes\(request\.status\)/);
  assert.match(adminCardSource, /canDeleteAccessRegistration\(request\)/);
  assert.match(adminCardSource, /Excluir cadastro de acesso/);
  assert.match(accessSource, /access\/delete-requires-inactive-profile/);
  assert.match(accessSource, /Revogue ou rejeite este perfil antes de excluir o cadastro de acesso/);
});

test('exclusão remove todos os rastros atuais do mesmo perfil e preserva conta e dados clínicos', () => {
  const deletionSource = accessSource.slice(
    accessSource.indexOf('async function collectAccessRequestRefsForDeletion'),
    accessSource.indexOf('function isQuotaExceededError'),
  );
  assert.match(deletionSource, /collectAccessRequestRefsForDeletion/);
  assert.match(deletionSource, /collectAccessApprovalRefsForDeletion/);
  assert.match(deletionSource, /for \(const field of \['email', 'normalizedEmail'\]\)/);
  assert.match(deletionSource, /legacyRequestDocumentId\(normalizedEmail, uid\)/);
  assert.match(deletionSource, /for \(const ref of requestRefsToDelete\.values\(\)\) transaction\.delete\(ref\)/);
  assert.match(deletionSource, /for \(const ref of approvalRefsToDelete\.values\(\)\) transaction\.delete\(ref\)/);
  assert.match(deletionSource, /transaction\.update\(profileRef, \{/);
  assert.match(deletionSource, /profileDeletePatchForRole\(role\)/);
  assert.match(deletionSource, /removedRequestIds/);
  assert.match(deletionSource, /scope: 'access-profile-only'/);
  assert.match(deletionSource, /preserved: \['firebaseAuth', 'patients', 'sessions', 'payments', 'media', 'clinicalRecords', 'activities'\]/);
  assert.doesNotMatch(deletionSource, /getAuth\(\)\.deleteUser|deleteUser\(/);
  assert.match(adminCardSource, /item\.role === request\.role[\s\S]*item\.email\.trim\(\)\.toLowerCase\(\) === request\.email\.trim\(\)\.toLowerCase\(\)/);
});

test('perfil revogado precisa ser excluído antes de nova solicitação do mesmo tipo', () => {
  assert.match(accessSource, /access\/revoked-registration-must-be-deleted/);
  assert.match(accessSource, /O administrador precisa excluir somente esse cadastro de acesso antes de uma nova solicitação/);
  assert.match(accessSource, /approvalDocumentId\(input\.email, role\)/);
  assert.match(accessSource, /requestDocumentId\(input\.email, decodedToken\.uid, role\)/);
});

test('perfil revogado órfão de uma exclusão antiga é autocorrigido no novo recadastro', () => {
  assert.match(accessSource, /const discoveredRequestSnapshot = await findRequestByEmail\(db, input\.email, role\)/);
  assert.match(accessSource, /const discoveredApprovalSnapshot = await findApprovalByEmail\(db, input\.email, role\)/);
  assert.match(accessSource, /const hasPersistedRoleRecord = Boolean/);
  assert.match(accessSource, /const orphanedRevokedProfile = currentRoleProfile\?\.status === 'revoked' && !hasPersistedRoleRecord/);
  assert.match(accessSource, /currentRoleProfile\?\.status === 'revoked' && !orphanedRevokedProfile/);
  assert.match(accessSource, /status: 'pending'/);
});

test('cliente de Monitoramento usa cache curto e evita chamadas duplicadas da consulta de resumo', () => {
  assert.match(accessApiSource, /MONITORING_PANEL_CACHE_MS/);
  assert.match(accessApiSource, /monitoringPanelRequests/);
  assert.match(accessApiSource, /if \(existing\) return existing/);
});

test('consulta de sessões continua limitada e sem listener global ou padrão N\+1', () => {
  const start = accessSource.indexOf('async function getMonitoringPanelData');
  const end = accessSource.indexOf('async function getResponsiblePortalData', start);
  const monitoringSource = accessSource.slice(start, end);
  assert.match(monitoringSource, /sessionsRef\.limit\(2000\)\.get\(\)/);
  assert.doesNotMatch(monitoringSource, /onSnapshot/);
  assert.doesNotMatch(monitoringSource, /for \(const patient[\s\S]{0,300}sessionsRef\.where/);
});
