import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const portal = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const firebase = fs.readFileSync('src/firebase.ts', 'utf8');
const api = fs.readFileSync('api/access.js', 'utf8');
const permissions = fs.readFileSync('api/_lib/accessPermissions.js', 'utf8');
const accessClient = fs.readFileSync('src/lib/accessApi.ts', 'utf8');
const admin = fs.readFileSync('src/components/Auth/AccessRequestsAdminCard.tsx', 'utf8');
const directAdmin = fs.readFileSync('src/components/Auth/DirectAccessAdminCard.tsx', 'utf8');
const passwordPanel = fs.readFileSync('src/components/Auth/PasswordSecurityPanel.tsx', 'utf8');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

const allSensitiveSources = [app, portal, firebase, api, permissions, accessClient, admin, directAdmin, passwordPanel].join('\n');

test('aplicação reconhece as três rotas específicas sem remover a rota principal', () => {
  assert.match(app, /normalizedPath === '\/responsavel'/);
  assert.match(app, /normalizedPath === '\/profissional'/);
  assert.match(app, /normalizedPath === '\/monitoramento'/);
  assert.match(app, /accessRouteRole=\{directAccessRole\}/);
  assert.match(portal, /Acesso do Responsável/);
  assert.match(portal, /Acesso do Profissional/);
  assert.match(portal, /Acesso ao Monitoramento/);
  assert.match(portal, /Voltar ao acesso geral/);
});

test('rotas específicas ocultam escolha de perfil, cadastro público e recuperação por e-mail', () => {
  assert.match(portal, /\{!directRoute && <fieldset/);
  assert.match(portal, /\{!directRoute && \(\s*<div className="flex items-center justify-between/);
  assert.match(portal, /const psychologyGoogleOnly = psychologyAuthTheme && effectiveLoginRole === 'professional'/);
  assert.match(portal, /\{\(psychologyGoogleOnly \|\| !directRoute\) && \(/);
  assert.match(portal, /if \(directRoute\) return renderLogin\(\)/);
});

test('login aceita nome de usuário ou e-mail e não expõe o e-mail técnico', () => {
  assert.match(portal, /E-mail ou nome de usuário/);
  assert.match(portal, /autoComplete="username"/);
  assert.match(portal, /loginWithIdentifier\(loginIdentifier, password\)/);
  assert.match(firebase, /usernameToManagedAuthEmail\(username\)/);
  assert.match(firebase, /Usuário\/e-mail ou senha inválidos\./);
  assert.match(firebase, /auth\/network-request-failed[\s\S]*auth\/too-many-requests/);
  assert.doesNotMatch(firebase, /loginWithIdentifier[\s\S]*auth\/user-disabled[\s\S]*toFriendlyAuthError/);
  assert.doesNotMatch(portal, /login\.gestaoclinica\.invalid/);
});

test('backend cria conta direta no Firebase Auth, reserva nome e não persiste senha', () => {
  assert.match(api, /async function createDirectAccess/);
  assert.match(api, /accessUsernames/);
  assert.match(api, /getAuth\(\)\.createUser/);
  assert.match(api, /reserveDirectAccessUsername/);
  assert.match(api, /getAuth\(\)\.deleteUser\(createdAuthUser\.uid\)/);
  assert.match(api, /temporaryPassword/);
  assert.doesNotMatch(api, /transaction\.(?:set|update)\([^\n]+password/);
  assert.match(accessClient, /action: 'createDirectAccess'/);
  assert.match(directAdmin, /Criar acesso direto/);
  assert.match(directAdmin, /Exigir que o usuário crie uma senha particular/);
});

test('troca obrigatória bloqueia a interface protegida e confirma mudança real no Firebase Auth', () => {
  assert.match(app, /accessProfile\?\.mustChangePassword === true/);
  assert.match(app, /<PasswordSecurityPanel[\s\S]*required/);
  assert.match(passwordPanel, /changeCurrentUserPassword\(currentPassword, newPassword\)/);
  assert.match(passwordPanel, /await user\.getIdToken\(true\);[\s\S]*completePasswordChange\(profile\.role, user\)/);
  assert.match(firebase, /reauthenticateWithCredential/);
  assert.match(firebase, /updatePassword/);
  assert.match(permissions, /access\/password-change-required/);
  assert.match(api, /passwordCredentialBaselineAt/);
  assert.match(api, /authUser\.tokensValidAfterTime/);
  assert.match(api, /access\/password-change-not-confirmed/);
});

test('administrador pode redefinir senha temporária sem reativar bloqueios administrativos', () => {
  const resetFunction = api.match(/async function resetDirectAccessPassword[\s\S]*?async function completePasswordChange/)?.[0] || '';
  assert.match(resetFunction, /getAuth\(\)\.updateUser/);
  assert.match(resetFunction, /mustChangePassword: true/);
  assert.match(resetFunction, /passwordCredentialBaselineAt: null/);
  assert.doesNotMatch(resetFunction, /disabled\s*:\s*false/);
  assert.match(accessClient, /action: 'resetDirectAccessPassword'/);
  assert.match(admin, /Gerar senha temporária/);
  assert.doesNotMatch(admin, /window\.confirm/);
});

test('Vercel preserva as três rotas diretas da SPA e roteia IDs da Psicologia para a API', () => {
  const sources = vercel.rewrites.map(entry => entry.source);
  for (const route of ['/responsavel', '/profissional', '/monitoramento']) {
    assert.ok(sources.includes(route));
    assert.ok(sources.includes(`${route}/`));
  }
  const spaRewrites = vercel.rewrites.filter(entry => !entry.source.startsWith('/api'));
  assert.ok(spaRewrites.every(entry => entry.destination === '/index.html'));
  assert.ok(vercel.rewrites.some(entry => entry.source === '/api/psychology/:resource/:id'));
});

test('escopo não introduz integração com WhatsApp ou PM2', () => {
  assert.doesNotMatch(allSensitiveSources, /Client\(|LocalAuth|sendMessage|ecosystem\.config|pm2 restart|pm2 stop/i);
});
