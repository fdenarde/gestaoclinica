import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeAccessErrorMessage } from '../api/access.js';

const accessSource = readFileSync(new URL('../api/access.js', import.meta.url), 'utf8');

test('R44 erro Firestore 5 NOT_FOUND é sanitizado para o profissional', () => {
  const error = Object.assign(new Error('5 NOT_FOUND:'), { code: 5, statusCode: 500 });
  assert.equal(
    sanitizeAccessErrorMessage(error),
    'Não foi possível validar seu acesso à Psicologia. Tente novamente em alguns instantes.',
  );
  assert.doesNotMatch(sanitizeAccessErrorMessage(error), /5 NOT_FOUND/);
});

test('R44 mantém o estágio técnico no log sem expor diagnóstico cru na resposta', () => {
  assert.match(accessSource, /annotateAccessError\(error, 'getProfile\.profileRef\.get'\)/);
  assert.match(accessSource, /technicalMessage/);
  assert.match(accessSource, /sanitizeAccessErrorMessage\(error, statusCode\)/);
  assert.match(accessSource, /stage=\$\{error\?\.accessStage \|\| 'unknown'\}/);
});
