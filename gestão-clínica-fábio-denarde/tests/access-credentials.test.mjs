import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessUsernameValidationError,
  directAccessPathForRole,
  isManagedAuthEmail,
  normalizeAccessUsername,
  usernameToManagedAuthEmail,
} from '../shared/accessCredentials.js';

test('normaliza nome de usuário sem diferenciar maiúsculas e espaços externos', () => {
  assert.equal(normalizeAccessUsername('  Prof.Alicia  '), 'prof.alicia');
});

test('aceita os formatos previstos e rejeita nomes inseguros ou reservados', () => {
  assert.equal(accessUsernameValidationError('responsavel.lara'), '');
  assert.equal(accessUsernameValidationError('prof.alicia'), '');
  assert.match(accessUsernameValidationError('admin'), /reservado/i);
  assert.match(accessUsernameValidationError('1usuario'), /Comece com uma letra/i);
  assert.match(accessUsernameValidationError('nome com espaço'), /Use letras minúsculas/i);
});

test('gera e reconhece e-mail técnico determinístico sem colisão entre pontuação suportada', () => {
  const dotted = usernameToManagedAuthEmail('prof.alicia');
  const dashed = usernameToManagedAuthEmail('prof-alicia');
  const underscored = usernameToManagedAuthEmail('prof_alicia');
  assert.notEqual(dotted, dashed);
  assert.notEqual(dotted, underscored);
  assert.notEqual(dashed, underscored);
  assert.equal(isManagedAuthEmail(dotted), true);
  assert.equal(isManagedAuthEmail('usuario@example.com'), false);
});

test('mapeia cada perfil para o link específico', () => {
  assert.equal(directAccessPathForRole('responsible'), '/responsavel');
  assert.equal(directAccessPathForRole('professional'), '/profissional');
  assert.equal(directAccessPathForRole('monitoring'), '/monitoramento');
});

test('identificador público prefere usuário ou e-mail real e nunca expõe e-mail técnico', async () => {
  const { publicAccessEmail, publicAccessIdentifier } = await import('../shared/accessCredentials.js');
  const technicalEmail = usernameToManagedAuthEmail('debriane');
  assert.equal(publicAccessIdentifier({ username: 'debriane', email: technicalEmail }), 'debriane');
  assert.equal(publicAccessIdentifier({ email: technicalEmail, displayName: 'Debriane' }), 'Debriane');
  assert.equal(publicAccessIdentifier({ contactEmail: 'real@example.com', email: technicalEmail }), 'real@example.com');
  assert.equal(publicAccessEmail({ email: technicalEmail }), '');
  assert.equal(publicAccessEmail({ contactEmail: 'real@example.com', email: technicalEmail }), 'real@example.com');
});
