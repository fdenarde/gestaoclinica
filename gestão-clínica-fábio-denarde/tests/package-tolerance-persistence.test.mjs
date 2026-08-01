import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const financeSource = readFileSync(new URL('../src/components/Finance.tsx', import.meta.url), 'utf8');

test('gravação de pacientes remove valores undefined antes de enviar ao Firestore', () => {
  assert.match(
    appSource,
    /syncCollection\('patients', state\.patients, newState\.patients, sanitizeForFirestore\)/,
  );
});

test('updateState informa sucesso ou falha real ao chamador', () => {
  assert.match(appSource, /const updateState = async \(newState: Partial<AppState>\): Promise<boolean>/);
  assert.match(appSource, /return true;\s*}\s*catch \(err\) \{/s);
  assert.match(appSource, /handleFirestoreError\(err, OperationType\.WRITE, 'users\/' \+ user\.uid\);\s*return false;/s);
});

test('Financeiro não exibe sucesso quando a tolerância não foi persistida', () => {
  assert.match(financeSource, /const persisted = await onUpdate\(\{\s*patients:/s);
  assert.match(financeSource, /if \(persisted === false\) \{\s*throw new Error\('A tolerância não foi gravada\./s);
});

test('encerramento da tolerância também exige confirmação de persistência', () => {
  assert.match(financeSource, /throw new Error\('O encerramento não foi gravado\. A tolerância permanece inalterada\.'\)/);
});
