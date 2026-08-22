import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEffectiveAccessContext,
} from '../api/_lib/accessPermissions.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';

function accessContext(role, uid = `${role}-uid`) {
  return buildEffectiveAccessContext({
    decodedToken: { uid, email: `${role}@example.com` },
    profile: role === 'admin'
      ? null
      : { role, status: 'approved', workspaceId: 'clinic-workspace', linkedPatientIds: ['patient-1'] },
    primaryAdminEmail: role === 'admin' ? `${role}@example.com` : PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
  });
}

test('contrato da API separa leituras clínicas de configurações das mutações administrativas', () => {
  const source = fs.readFileSync(new URL('../api/psychology.js', import.meta.url), 'utf8');

  assert.match(source, /resource === 'patients'[\s\S]*?req\.method === 'GET'[\s\S]*?requiredPermissions: \['patients\.list'\]/);
  assert.match(source, /resource === 'sessions'[\s\S]*?req\.method === 'GET'[\s\S]*?requiredPermissions: \['agenda\.own\.view'\]/);
  assert.match(source, /resource === 'settings'[\s\S]*?req\.method === 'GET'[\s\S]*?requiredPermissions: \['settings\.clinic\.view'\]/);
  assert.match(source, /\(resource === 'services' \|\| resource === 'locations'\)[\s\S]*?req\.method === 'GET'[\s\S]*?requiredPermissions: \['settings\.clinic\.view'\]/);
  assert.match(source, /resource === 'settings'[\s\S]*?req\.method === 'PUT'[\s\S]*?assertOperationalSettingsWrite\(runtimeScope\)/);
});

test('permissões efetivas preservam leitura profissional, gestão administrativa e isolamento dos demais contextos', () => {
  const professional = accessContext('professional');
  const admin = accessContext('admin');
  const responsible = accessContext('responsible');
  const monitoring = accessContext('monitoring');

  assert.equal(professional.permissions['patients.list'], true);
  assert.equal(professional.permissions['agenda.own.view'], true);
  assert.equal(professional.permissions['settings.clinic.view'], true);
  assert.equal(professional.permissions['settings.clinic.edit'], true);
  assert.equal(professional.permissions['settings.clinic.manage'], false);

  assert.equal(admin.permissions['settings.clinic.view'], true);
  assert.equal(admin.permissions['settings.clinic.edit'], true);
  assert.equal(admin.permissions['settings.clinic.manage'], true);

  assert.equal(responsible.permissions['settings.clinic.view'], false);
  assert.equal(responsible.permissions['settings.clinic.edit'], false);
  assert.equal(responsible.permissions['settings.clinic.manage'], false);
  assert.equal(monitoring.permissions['settings.clinic.view'], false);
  assert.equal(monitoring.permissions['settings.clinic.edit'], false);
  assert.equal(monitoring.permissions['settings.clinic.manage'], false);
});
