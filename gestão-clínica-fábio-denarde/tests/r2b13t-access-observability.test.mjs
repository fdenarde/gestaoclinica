import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildSanitizedAccessAuditEvent,
  shortAuthUidHash,
} from '../api/_lib/sanitizedAccessAudit.js';

const viteSource = fs.readFileSync('vite.config.ts', 'utf8');
const serverSource = fs.readFileSync('drive-api-server.js', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const portalSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const psychologySource = fs.readFileSync('api/psychology.js', 'utf8');
const psychologyObservabilitySource = fs.readFileSync('api/_lib/psychologyObservability.js', 'utf8');

test('proxy e servidor local mantêm access e psychology em localhost:5177', () => {
  assert.match(viteSource, /['"]\/api\/access['"]\s*:/);
  assert.match(viteSource, /['"]\/api\/psychology['"]\s*:/);
  assert.match(serverSource, /app\.all\(['"]\/api\/access['"], accessHandler\)/);
  assert.match(serverSource, /app\.all\(\/\^\\\/api\\\/psychology/);
  assert.match(psychologySource, /http:\/\/localhost:5177/);
});

test('sessão autenticada permanece em verificação até a API de acesso responder', () => {
  assert.match(appSource, /setAccessProfile\(null\);\s*setAccessLoading\(true\);\s*setAccessError\(''\);/s);
  const loadingIndex = portalSource.indexOf('if (profileLoading)');
  const errorIndex = portalSource.indexOf('if (profileError)', loadingIndex);
  const requestIndex = portalSource.indexOf("if (view === 'request' && !directRoute)", errorIndex);
  assert.ok(loadingIndex >= 0 && errorIndex > loadingIndex && requestIndex > errorIndex);
});

test('evento de acesso não expõe UID completo, token, cookie ou e-mail', () => {
  const request = { method: 'GET', headers: { authorization: 'Bearer secret-token' } };
  const fullUid = 'uid-da-leila-que-nao-deve-aparecer';
  const event = buildSanitizedAccessAuditEvent(request, {
    authUid: fullUid,
    statusHttp: 200,
    technicalCode: 'OK',
    accessProfileFound: true,
    accessProfileApproved: true,
    accessRole: 'professional',
    professionalResolved: true,
    psychologyRouteAllowed: true,
  });
  const serialized = JSON.stringify(event);
  assert.equal(event.authorizationPresent, 'YES');
  assert.equal(event.authUidHash, shortAuthUidHash(fullUid));
  assert.notEqual(event.authUidHash, fullUid);
  assert.doesNotMatch(serialized, /secret-token|uid-da-leila|@/i);
  assert.deepEqual(Object.keys(event).sort(), [
    'accessProfileApproved',
    'accessProfileFound',
    'accessRole',
    'authUidHash',
    'authorizationPresent',
    'endpoint',
    'method',
    'professionalResolved',
    'psychologyRouteAllowed',
    'requestAccessScreenCause',
    'statusHttp',
    'technicalCode',
    'tokenVerificationResult',
    'timestamp',
  ].sort());
});

test('observabilidade antiga da Psicologia usa somente hash curto do ator', () => {
  assert.match(psychologyObservabilitySource, /actorUidHash: shortAuthUidHash/);
  assert.doesNotMatch(psychologyObservabilitySource, /actorUid:\s*normalize\(runtimeScope\?\.authUid/);
});
