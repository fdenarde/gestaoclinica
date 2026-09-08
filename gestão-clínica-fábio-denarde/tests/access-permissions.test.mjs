import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ACCESS_PERMISSION_KEYS,
  assertAccessPermission,
  assertAllowedRole,
  assertPatientBinding,
  buildEffectiveAccessContext,
  normalizePermissionOverrides,
  resolveEffectivePermissions,
} from '../api/_lib/accessPermissions.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';

function approvedProfile(overrides = {}) {
  return {
    role: 'professional',
    status: 'approved',
    displayName: 'Profissional Teste',
    linkedPatientIds: ['patient-1', 'patient-2'],
    ...overrides,
  };
}

function buildProfessional(profileOverrides = {}, contextOverrides = {}) {
  return buildEffectiveAccessContext({
    decodedToken: {
      uid: 'professional-uid',
      email: 'profissional@example.com',
      name: 'Profissional Teste',
    },
    profile: approvedProfile(profileOverrides),
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
    ...contextOverrides,
  });
}

test('contrato registra os quatro perfis e todas as permissões têm valor booleano', () => {
  const monitoring = resolveEffectivePermissions({ role: 'monitoring' });
  assert.ok(ACCESS_PERMISSION_KEYS.length >= 60);
  for (const key of ACCESS_PERMISSION_KEYS) {
    assert.equal(typeof monitoring[key], 'boolean', `Permissão sem valor booleano: ${key}`);
  }
});

test('profissional aprovado recebe workspace canônico, pacientes vinculados e permissões compatíveis', () => {
  const context = buildProfessional();
  assert.equal(context.role, 'professional');
  assert.equal(context.activeContext, 'professional');
  assert.equal(context.workspaceId, 'clinic-workspace');
  assert.equal(context.legacyStorageOwnerId, 'professional-uid');
  assert.deepEqual(context.allowedPatientIds, ['patient-1', 'patient-2']);
  assert.equal(context.permissions['patients.photo.upload'], true);
  assert.equal(context.permissions['settings.clinic.view'], true);
  assert.equal(context.permissions['settings.clinic.manage'], false);
  assert.equal(context.permissions['finance.global.view'], false);
});

test('override individual booleano substitui o padrão do perfil', () => {
  const context = buildProfessional({
    permissionOverrides: {
      'patients.photo.upload': false,
      'agenda.general.view': true,
      'finance.global.view': true,
      'chave.inexistente': true,
      'patients.edit': 'yes',
    },
  });
  assert.equal(context.permissions['patients.photo.upload'], false);
  assert.equal(context.permissions['agenda.general.view'], true);
  assert.equal(context.permissions['finance.global.view'], false);
  assert.deepEqual(normalizePermissionOverrides({
    'patients.photo.upload': false,
    'chave.inexistente': true,
    'patients.edit': 'yes',
  }), {
    'patients.photo.upload': false,
  });
});

test('contexto Monitoramento não herda escrita do papel Profissional', () => {
  const context = buildProfessional({
    profiles: {
      monitoring: {
        status: 'approved',
        permissionOverrides: {
          'patients.edit': true,
          'media.image.upload': true,
          'monitoring.media.download': true,
        },
      },
    },
  }, {
    requestedContext: 'monitoring',
  });
  assert.equal(context.role, 'monitoring');
  assert.equal(context.activeContext, 'monitoring');
  assert.equal(context.permissions['monitoring.panel.view'], true);
  assert.equal(context.permissions['patients.edit'], false);
  assert.equal(context.permissions['media.image.upload'], false);
  assert.equal(context.permissions['monitoring.media.download'], false);
  assert.equal(context.permissions['settings.clinic.view'], false);
  assert.equal(context.permissions['settings.clinic.manage'], false);
});

test('perfil Responsável permanece isolado da leitura e gestão de configurações clínicas', () => {
  const context = buildEffectiveAccessContext({
    decodedToken: { uid: 'responsible-uid', email: 'responsible@example.com' },
    profile: {
      role: 'responsible',
      status: 'approved',
      workspaceId: 'clinic-workspace',
      linkedPatientIds: ['patient-1'],
    },
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
  });
  assert.equal(context.permissions['settings.clinic.view'], false);
  assert.equal(context.permissions['settings.clinic.manage'], false);
});

test('contexto adicional não autorizado não pode ser ativado', () => {
  assert.throws(
    () => buildProfessional({ enabledContexts: ['admin'] }, { requestedContext: 'admin' }),
    error => error.code === 'access/invalid-profile-role',
  );
});

test('bloqueio global prevalece sobre padrão e override', () => {
  const context = buildProfessional({
    permissionOverrides: { 'patients.photo.upload': true },
  }, {
    globalBlocks: ['patients.photo.upload'],
  });
  assert.equal(context.permissions['patients.photo.upload'], false);
});

test('perfil Monitoramento é sempre somente leitura nas ações absolutas', () => {
  const context = buildEffectiveAccessContext({
    decodedToken: { uid: 'monitor-uid', email: 'monitor@example.com' },
    profile: {
      role: 'monitoring',
      status: 'approved',
      workspaceId: 'clinic-workspace',
      permissionOverrides: {
        'patients.edit': true,
        'media.image.download': true,
        'monitoring.any_write': true,
      },
      linkedPatientIds: ['patient-1'],
    },
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
  });
  assert.equal(context.permissions['monitoring.panel.view'], true);
  assert.equal(context.permissions['patients.edit'], false);
  assert.equal(context.permissions['media.image.download'], false);
  assert.equal(context.permissions['monitoring.any_write'], false);
});

test('perfil pendente, suspenso ou com acesso temporário expirado é negado', () => {
  assert.throws(() => buildProfessional({ status: 'pending' }), error => error.code === 'access/approved-profile-required');
  assert.throws(() => buildProfessional({
    suspension: { active: true, reason: 'Teste' },
  }), error => error.code === 'access/account-suspended');
  assert.throws(() => buildProfessional({
    temporaryAccess: { endsAt: '2020-01-01T00:00:00.000Z' },
  }), error => error.code === 'access/temporary-access-expired');
});

test('troca obrigatória de senha bloqueia dados protegidos até a conclusão', () => {
  assert.throws(() => buildProfessional({
    mustChangePassword: true,
  }), error => error.code === 'access/password-change-required');
});

test('administrador principal permanece aprovado sem depender de documento de perfil', () => {
  const context = buildEffectiveAccessContext({
    decodedToken: { uid: 'admin-uid', email: PRIMARY_ADMIN_EMAIL, name: 'Administrador' },
    profile: null,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'outro-workspace',
  });
  assert.equal(context.role, 'admin');
  assert.equal(context.workspaceId, 'admin-uid');
  assert.equal(context.permissions['access.permissions.manage'], true);
  assert.equal(context.permissions['settings.clinic.view'], true);
  assert.equal(context.permissions['settings.clinic.manage'], true);
});

test('asserts negam papel, permissão e atendente fora do vínculo', () => {
  const context = buildProfessional();
  assert.doesNotThrow(() => assertAllowedRole(context, ['professional']));
  assert.throws(() => assertAllowedRole(context, ['admin']), error => error.code === 'access/role-denied');
  assert.doesNotThrow(() => assertAccessPermission(context, 'patients.photo.view'));
  assert.throws(
    () => assertAccessPermission(context, 'settings.clinic.manage'),
    error => error.code === 'access/permission-denied',
  );
  assert.throws(
    () => assertAccessPermission(context, 'settings.firebase.manage'),
    error => error.code === 'access/permission-denied',
  );
  assert.equal(assertPatientBinding(context, 'patient-1'), 'patient-1');
  assert.throws(() => assertPatientBinding(context, 'patient-3'), error => error.code === 'access/patient-access-denied');
});

test('api de fotos exige perfil, permissão, vínculo e preserva namespace legado nesta fase', () => {
  const driveUrl = new URL('../api/drive.js', import.meta.url);
  if (!fs.existsSync(driveUrl)) return;
  const driveSource = fs.readFileSync(driveUrl, 'utf8');
  assert.match(driveSource, /resolveAccessContext\(req/);
  assert.match(driveSource, /allowedRoles: \['admin', 'professional'\]/);
  assert.match(driveSource, /patients\.photo\.upload/);
  assert.match(driveSource, /patients\.photo\.view/);
  assert.match(driveSource, /patients\.photo\.delete/);
  assert.match(driveSource, /assertPatientBinding/);
  assert.match(driveSource, /context\.legacyStorageOwnerId/);
});

test('perfil Monitoramento abre solicitação pública e painel próprio sem virar sistema interno comum', () => {
  const typesSource = fs.readFileSync(new URL('../src/types/access.ts', import.meta.url), 'utf8');
  const accessSource = fs.readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const portalSource = fs.readFileSync(new URL('../src/components/Auth/AccessPortal.tsx', import.meta.url), 'utf8');
  assert.match(typesSource, /'admin' \| 'professional' \| 'responsible' \| 'monitoring'/);
  assert.match(typesSource, /Exclude<AccessRole, 'admin'>/);
  assert.match(accessSource, /ACCESS_PROFILE_ROLES\.has\(data\.role\)/);
  assert.match(accessSource, /const ACCESS_ROLES = new Set\(\['professional', 'responsible', 'monitoring'\]\)/);
  assert.match(accessSource, /approvalDocumentId\(.*role/);
  assert.match(accessSource, /function profilePatchForRole\(role, patch = \{\}\)/);
  assert.match(accessSource, /\[`profiles\.\$\{normalizedRole\}`\]: patch/);
  assert.match(portalSource, /<option value="monitoring">Monitoramento<\/option>/);
  assert.match(portalSource, /applyTheme\('health-balance'\)/);
  assert.doesNotMatch(portalSource, /applyTheme\('calm-tech'\)/);
  assert.match(appSource, /const canAccessMonitoringPanel =/);
  assert.match(appSource, /<MonitoringPanel[\s\S]*onLogout=\{\(\) => void handleAccessPortalLogout\(\)\}/);
  assert.match(appSource, /accessProfile\.role === 'admin' \|\| accessProfile\.role === 'professional'/);
});

test('conta com múltiplos perfis exige contexto explícito e não prioriza Profissional', () => {
  const multiProfile = {
    role: 'professional',
    status: 'approved',
    workspaceId: 'clinic-workspace',
    profiles: {
      professional: { role: 'professional', status: 'approved' },
      monitoring: { role: 'monitoring', status: 'approved' },
    },
  };

  assert.throws(
    () => buildEffectiveAccessContext({
      decodedToken: { uid: 'multi-uid', email: 'multi@example.com' },
      profile: multiProfile,
      primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
      primaryAdminWorkspaceId: 'clinic-workspace',
    }),
    error => error.code === 'access/invalid-profile-role',
  );

  assert.equal(buildEffectiveAccessContext({
    decodedToken: { uid: 'multi-uid', email: 'multi@example.com' },
    profile: multiProfile,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
    requestedContext: 'monitoring',
  }).role, 'monitoring');
});
