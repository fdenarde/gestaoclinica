import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { classifyFirebaseTokenVerificationError } from '../api/_lib/firebaseAdmin.js';
import { buildSanitizedAccessAuditEvent } from '../api/_lib/sanitizedAccessAudit.js';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');

test('classificação sanitizada diferencia token expirado, inválido e projeto incompatível', () => {
  assert.equal(
    classifyFirebaseTokenVerificationError({ code: 'auth/id-token-expired' }).tokenVerificationResult,
    'EXPIRED',
  );
  assert.equal(
    classifyFirebaseTokenVerificationError({ code: 'auth/argument-error', message: 'incorrect audience claim' }).tokenVerificationResult,
    'PROJECT_MISMATCH',
  );
  assert.equal(
    classifyFirebaseTokenVerificationError({ code: 'auth/invalid-id-token' }).tokenVerificationResult,
    'INVALID',
  );
});

test('token ausente e resposta de erro permanecem JSON e não liberam solicitação de acesso', () => {
  const missing = buildSanitizedAccessAuditEvent({ method: 'GET', headers: {} }, {
    statusHttp: 401,
    technicalCode: 'drive-api/missing-auth-token',
    tokenVerificationResult: 'MISSING',
  });
  const invalid = buildSanitizedAccessAuditEvent({ method: 'GET', headers: { authorization: 'Bearer diagnostic' } }, {
    statusHttp: 401,
    technicalCode: 'drive-api/invalid-auth-token',
    tokenVerificationResult: 'INVALID',
  });
  assert.equal(missing.tokenVerificationResult, 'MISSING');
  assert.equal(invalid.tokenVerificationResult, 'INVALID');
  assert.equal(missing.requestAccessScreenCause, 'NOT_OBSERVED');
  assert.equal(invalid.requestAccessScreenCause, 'NOT_OBSERVED');
});

test('token inválido ou expirado recebe uma única renovação antes do erro visual', () => {
  assert.match(appSource, /drive-api\/expired-auth-token/);
  assert.match(appSource, /drive-api\/invalid-auth-token/);
  assert.match(appSource, /getAccessProfile\(user, \{ forceRefreshToken: true, activeRole: selectedAccessRole \}\)/);
  assert.match(appSource, /const canRefreshToken = !forceRefreshToken/);
});
