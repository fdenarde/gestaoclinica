import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const authSource = fs.readFileSync('src/components/Auth/AccessPortal.tsx', 'utf8');
const cssSource = fs.readFileSync('src/index.css', 'utf8');

test('rota Psicologia injeta contexto visual no Auth compartilhado', () => {
  assert.match(appSource, /visualContext=\{psychologyPilotRoute \? 'PSICOLOGIA' : 'DEFAULT'\}/);
  assert.match(authSource, /export type AuthVisualContext = 'DEFAULT' \| 'PSICOLOGIA'/);
  assert.match(authSource, /data-auth-visual-context=\{visualContext\}/);
  assert.doesNotMatch(appSource, /PsychologyLoginPage/);
});

test('tema Psicologia reutiliza a paleta violeta existente sem alterar o tema global', () => {
  assert.match(cssSource, /\.auth-psychology-theme\s*\{/);
  for (const token of [
    '--color-clinic-primary: #6D28D9',
    '--color-clinic-primary-hover: #5B21B6',
    '--color-clinic-bg: #F5F3FF',
    '--color-clinic-border: #DDD6FE',
  ]) assert.match(cssSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(authSource, /psychologyAuthTheme \? 'bg-violet-50' : 'bg-status-green-bg'/);
  assert.match(authSource, /applyTheme\('health-balance'\)/);
});

test('Auth funcional permanece compartilhado e protegido', () => {
  for (const marker of [
    'await loginWithIdentifier(loginIdentifier, password)',
    'await loginWithGoogle()',
    'Esqueci minha senha',
    'Criar acesso',
    'Entrar como',
    'role="radio"',
  ]) assert.match(authSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(appSource, /if \(!user \|\| !canAccessInternalSystem\)/);
  assert.match(appSource, /if \(psychologyPilotRoute\) return <PsychologyPilot \/>;/);
});

test('R2F4-A1 não introduz revisão, bypass, identidade sintética ou integração externa', () => {
  assert.doesNotMatch(authSource, /review mode|REVIEW_MODE|auth bypass|AUTH_BYPASS|synthetic identity|SYNTHETIC_IDENTITY/i);
  assert.doesNotMatch(authSource, /sendMessage|Meta|Doctoralia|PM2|Firebase.*(?:write|setDoc|addDoc)/i);
});
