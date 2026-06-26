import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';

const PRIMARY_ADMIN_EMAIL = 'fdenarde@gmail.com';
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const accessPortalSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const accessApiSource = fs.readFileSync('src/lib/accessApi.ts', 'utf8');
const accessServerSource = fs.readFileSync('api/access.js', 'utf8');
const viteSource = fs.readFileSync('vite.config.ts', 'utf8');

test('tela real de login exige escolha explícita entre Profissional, Monitoramento e Responsável', () => {
  assert.match(accessPortalSource, /Entrar como/);
  assert.match(accessPortalSource, /role: 'professional'/);
  assert.match(accessPortalSource, /role: 'monitoring'/);
  assert.match(accessPortalSource, /role: 'responsible'/);
  assert.match(accessPortalSource, /selectedLoginRole: AccessRequestRole \| null/);
  assert.match(accessPortalSource, /role="radio"/);
  assert.match(accessPortalSource, /aria-checked=\{selected\}/);
  assert.match(accessPortalSource, /Nenhum modo de entrada selecionado/);
  assert.match(accessPortalSource, /disabled=\{busy \|\| !effectiveLoginRole\}/);
});

test('login por usuário, e-mail e Google bloqueiam autenticação sem modo escolhido', () => {
  const requiredMessage = /Escolha se deseja entrar como Profissional, Monitoramento ou Responsável\./;
  assert.match(accessPortalSource, /const handleEmailLogin[\s\S]*if \(!effectiveLoginRole\)[\s\S]*throw new Error/);
  assert.match(accessPortalSource, /const handleGoogleLogin[\s\S]*if \(!effectiveLoginRole\)[\s\S]*throw new Error/);
  assert.match(accessPortalSource, requiredMessage);
  assert.match(accessPortalSource, /await loginWithIdentifier\(loginIdentifier, password\)/);
  assert.match(accessPortalSource, /await loginWithGoogle\(\)/);
});

test('cadastro reutiliza conta Auth existente e cria somente nova solicitação de perfil', () => {
  assert.match(accessPortalSource, /function isEmailAlreadyInUseError\(error: unknown\)/);
  assert.match(accessPortalSource, /authErrorCode\(error\) === 'auth\/email-already-in-use'/);
  assert.match(accessPortalSource, /try \{[\s\S]*await createEmailAccount[\s\S]*catch \(accountError\)/);
  assert.match(accessPortalSource, /if \(!isEmailAlreadyInUseError\(accountError\)\) throw accountError/);
  assert.match(accessPortalSource, /await loginWithEmail\(normalized\.email, password\)/);
  assert.match(accessPortalSource, /const result = await submitAccessRequest\(normalized, authenticatedUser\)/);
  assert.match(accessPortalSource, /Conta existente confirmada\. A nova solicitação de perfil foi enviada para aprovação\./);
});

test('perfil escolhido no login é enviado ao backend e controla o roteamento', () => {
  assert.match(appSource, /selectedLoginRole=\{selectedAccessRole/);
  assert.match(appSource, /onSelectedLoginRoleChange=\{role => setSelectedAccessRole\(directAccessRole \|\| role\)\}/);
  assert.match(appSource, /getAccessProfile\(user, \{ forceRefreshToken, activeRole: selectedAccessRole \}\)/);
  assert.match(accessApiSource, /\?activeRole=\$\{encodeURIComponent\(options\.activeRole\)\}/);
  assert.match(accessServerSource, /assertSelectedProfileIsActive\(sourceProfile, activeRole\)/);
  assert.match(accessServerSource, /access\/profile-not-configured/);
  assert.match(accessServerSource, /access\/selected-profile-not-active/);
});

test('backend não faz fallback para Profissional quando existem múltiplos perfis', () => {
  const profile = {
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
      decodedToken: { uid: 'multi-user', email: 'multi@example.com' },
      profile,
      primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
      primaryAdminWorkspaceId: 'clinic-workspace',
    }),
    error => error.code === 'access/invalid-profile-role',
  );

  const monitoring = buildEffectiveAccessContext({
    decodedToken: { uid: 'multi-user', email: 'multi@example.com' },
    profile,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
    requestedContext: 'monitoring',
  });
  assert.equal(monitoring.role, 'monitoring');
  assert.equal(monitoring.activeContext, 'monitoring');
});

test('perfil solicitado inexistente, pendente, suspenso ou expirado permanece negado', () => {
  const base = {
    role: 'professional',
    status: 'approved',
    workspaceId: 'clinic-workspace',
    profiles: {
      professional: { role: 'professional', status: 'approved' },
    },
  };

  const build = (profile, requestedContext) => buildEffectiveAccessContext({
    decodedToken: { uid: 'user-1', email: 'user@example.com' },
    profile,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    primaryAdminWorkspaceId: 'clinic-workspace',
    requestedContext,
  });

  assert.throws(() => build(base, 'monitoring'), error => error.code === 'access/invalid-profile-role');
  assert.throws(() => build({
    ...base,
    profiles: { monitoring: { role: 'monitoring', status: 'pending' } },
  }, 'monitoring'), error => error.code === 'access/approved-profile-required');
  assert.throws(() => build({
    ...base,
    profiles: { monitoring: { role: 'monitoring', status: 'approved', suspension: { active: true } } },
  }, 'monitoring'), error => error.code === 'access/account-suspended');
  assert.throws(() => build({
    ...base,
    profiles: { monitoring: { role: 'monitoring', status: 'approved', expiresAt: '2020-01-01T00:00:00.000Z' } },
  }, 'monitoring'), error => error.code === 'access/temporary-access-expired');
});

test('troca de perfil limpa dados da sessão e não exige nova autenticação', () => {
  assert.match(appSource, /const resetSessionScopedData = useCallback/);
  assert.match(appSource, /clearAccessApiCaches\(\)/);
  assert.match(appSource, /const switchAccessRole = useCallback\(\(\) => \{/);
  assert.match(appSource, /setSelectedAccessRole\(null\)/);
  assert.match(appSource, /activeProfileRoles\.length > 0 && !selectedAccessRole/);
  assert.match(appSource, /Trocar perfil/);
});

test('sair da conta limpa usuário, perfil e modo escolhido', () => {
  assert.match(appSource, /const handleAccessPortalLogout = useCallback\(async \(\) => \{/);
  assert.match(appSource, /await logout\(\)/);
  assert.match(appSource, /setUser\(null\)/);
  assert.match(appSource, /setAccessProfile\(null\)/);
  assert.match(appSource, /setSelectedAccessRole\(directAccessRole\)/);
  assert.match(appSource, /onLogout=\{handleAccessPortalLogout\}/);
});

test('tentar novamente renova o ID token e separa cache por perfil ativo', () => {
  assert.match(accessApiSource, /forceRefreshToken\?: boolean/);
  assert.match(accessApiSource, /activeRole\?: AccessProfile\['role'\] \| null/);
  assert.match(accessApiSource, /getIdToken\(forceRefreshToken\)/);
  assert.match(accessApiSource, /options\.activeRole \|\| 'selector'/);
  assert.match(appSource, /forceAccessTokenRefreshRef\.current = true/);
});

test('fluxo local continua usando proxy seguro para a API privada', () => {
  assert.match(viteSource, /'\/api\/access': \{[\s\S]*target: `http:\/\/127\.0\.0\.1:\$\{env\.DRIVE_API_PORT \|\| '3002'\}`[\s\S]*changeOrigin: true/);
  assert.doesNotMatch(viteSource, /cors:\s*true|Access-Control-Allow-Origin/);
});

test('correção de autenticação não toca WhatsApp, PM2 nem usa redirecionamento global', () => {
  assert.doesNotMatch(appSource + accessPortalSource + accessApiSource, /Client\(|LocalAuth|sendMessage|pm2|ecosystem\.config|location\.reload\(\)/);
  assert.doesNotMatch(appSource + accessPortalSource, /window\.location\s*=|signInWithRedirect|getRedirectResult/);
});
