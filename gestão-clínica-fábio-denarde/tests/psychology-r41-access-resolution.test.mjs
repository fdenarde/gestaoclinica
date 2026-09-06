import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';

const token = { uid: 'sanitized-user', email: 'fixture-admin-1@synthetic.test' };

function resolvePsychologyProfile(profile) {
  return buildEffectiveAccessContext({
    decodedToken: token,
    profile,
    primaryAdminEmail: 'fixture-admin-2@synthetic.test',
    primaryAdminWorkspaceId: 'sanitized-admin-workspace',
    requestedContext: 'professional',
  });
}

test('perfil legado approved/professional resolve activeRole professional', () => {
  const context = resolvePsychologyProfile({
    role: 'professional',
    status: 'approved',
    workspaceId: 'sanitized-workspace',
  });

  assert.equal(context.role, 'professional');
  assert.equal(context.status, 'approved');
  assert.equal(context.workspaceId, 'sanitized-workspace');
  assert.equal(context.permissions['patients.list'], true);
});

test('profiles.professional approved tem precedência sobre o resumo legado', () => {
  const context = resolvePsychologyProfile({
    role: 'responsible',
    status: 'approved',
    workspaceId: 'sanitized-workspace',
    profiles: {
      professional: {
        role: 'professional',
        status: 'approved',
        workspaceId: 'sanitized-workspace',
      },
    },
  });

  assert.equal(context.role, 'professional');
  assert.equal(context.status, 'approved');
  assert.equal(context.permissions['patients.list'], true);
});

test('perfil professional pending ou revoked continua bloqueado', () => {
  for (const status of ['pending', 'revoked']) {
    assert.throws(
      () => resolvePsychologyProfile({ role: 'professional', status, workspaceId: 'sanitized-workspace' }),
      error => error?.code === 'access/approved-profile-required',
    );
  }
});
