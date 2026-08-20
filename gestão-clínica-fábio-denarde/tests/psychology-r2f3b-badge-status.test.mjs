import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');

test('badge não afirma envio Meta enquanto a rota pública estiver pendente', () => {
  assert.match(source, /submissionReady = template\.submissionState === 'SUBMISSION_READY' && template\.publicRouteStatus === 'READY'/);
  assert.match(source, /'AGUARDANDO PUBLICAÇÃO'/);
  assert.match(source, /'VALIDAÇÃO CONCLUÍDA'/);
  assert.match(source, /submissionReady \? messageStatusLabel\(template\.localStatus\)/);
});
