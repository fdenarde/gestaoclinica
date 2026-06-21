import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const accessPortalSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const accessApiSource = fs.readFileSync('src/lib/accessApi.ts', 'utf8');
const viteSource = fs.readFileSync('vite.config.ts', 'utf8');

test('sessão expirada usa erro controlado e mantém o acesso negado sem usuário válido', () => {
  assert.match(accessPortalSource, /Não foi possível validar o acesso/);
  assert.match(appSource, /if \(!user \|\| !canAccessInternalSystem\)/);
  assert.match(appSource, /const canAccessInternalSystem =[\s\S]*accessProfile\?\.status === 'approved'[\s\S]*accessProfile\.role === 'admin' \|\| accessProfile\.role === 'professional'/);
  assert.doesNotMatch(appSource + accessPortalSource, /profile\s*=\s*\{[^}]*role:\s*'admin'/);
});

test('sair da conta no portal limpa o estado pai e retorna ao login oficial', () => {
  assert.match(accessPortalSource, /onLogout\?: \(\) => Promise<void> \| void/);
  assert.match(accessPortalSource, /await \(onLogout \? onLogout\(\) : logout\(\)\)/);
  assert.match(accessPortalSource, /if \(!user\) return view === 'request' \? renderRequest\(\) : view === 'reset' \? renderReset\(\) : renderLogin\(\)/);

  assert.match(appSource, /const handleAccessPortalLogout = useCallback\(async \(\) => \{/);
  assert.match(appSource, /await logout\(\)/);
  assert.match(appSource, /setUser\(null\)/);
  assert.match(appSource, /setAccessProfile\(null\)/);
  assert.match(appSource, /setAccessLoading\(false\)/);
  assert.match(appSource, /setAccessError\(''\)/);
  assert.match(appSource, /onLogout=\{handleAccessPortalLogout\}/);
});

test('tentar novamente renova o ID token uma única vez e não cria loop de 401', () => {
  assert.match(accessApiSource, /interface RequestOptions \{[\s\S]*forceRefreshToken\?: boolean/);
  assert.match(accessApiSource, /getIdToken\(forceRefreshToken\)/);
  assert.match(accessApiSource, /getAccessProfile\(user\?: User, options: RequestOptions = \{\}\)/);
  assert.match(accessApiSource, /requestKey = `\$\{userKey\}:\$\{options\.forceRefreshToken \? 'refresh' : 'default'\}`/);

  assert.match(appSource, /const forceAccessTokenRefreshRef = useRef\(false\)/);
  assert.match(appSource, /const forceRefreshToken = forceAccessTokenRefreshRef\.current/);
  assert.match(appSource, /forceAccessTokenRefreshRef\.current = false/);
  assert.match(appSource, /getAccessProfile\(user, \{ forceRefreshToken \}\)/);
  assert.match(appSource, /const handleRetryAccessProfile = useCallback\(\(\) => \{/);
  assert.match(appSource, /forceAccessTokenRefreshRef\.current = true/);
  assert.match(appSource, /onRetryProfile=\{handleRetryAccessProfile\}/);
});

test('fluxo local continua usando proxy seguro para a API privada sem CORS aberto', () => {
  assert.match(viteSource, /'\/api\/access': \{[\s\S]*target: `http:\/\/127\.0\.0\.1:\$\{env\.DRIVE_API_PORT \|\| '3002'\}`[\s\S]*changeOrigin: true/);
  assert.doesNotMatch(viteSource, /cors:\s*true|Access-Control-Allow-Origin/);
});

test('correção de autenticação não toca WhatsApp, PM2, permissões nem reload global', () => {
  assert.doesNotMatch(appSource + accessPortalSource + accessApiSource, /Client\(|LocalAuth|sendMessage|pm2|ecosystem\.config|location\.reload\(\)/);
  assert.doesNotMatch(appSource + accessPortalSource, /window\.location\s*=|signInWithRedirect|getRedirectResult/);
});
