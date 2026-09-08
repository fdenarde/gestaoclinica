import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = relativePath => readFile(new URL(relativePath, root), 'utf8');

const forbiddenKeys = /uid|sessionid|patientid|phone|email|name|message|token|credential|payment|clinical|content|password|secret|authorization/i;

test('gate backend false não emite métrica', async () => {
  const { createFirestoreDiagnostics } = await import('../api/_lib/firestoreDiagnostics.js');
  const logs = [];
  const diagnostics = createFirestoreDiagnostics({ enabled: false, logger: (...entry) => logs.push(entry) });
  diagnostics.emit({ source: 'test', docs: 3 });
  assert.equal(logs.length, 0);
});
test('gate literal true emite apenas campos sanitizados', async () => {
  const { createFirestoreDiagnostics } = await import('../api/_lib/firestoreDiagnostics.js');
  const logs = [];
  const diagnostics = createFirestoreDiagnostics({ enabled: true, instanceId: 'test-instance', logger: (_label, record) => logs.push(record) });
  diagnostics.emit({
    source: 'api',
    operation: 'monitoringPanel',
    docs: 4,
    patientId: 'não deve aparecer',
    email: 'nao-deve-aparecer@example.com',
    content: 'texto clínico não deve aparecer',
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].docs, 4);
  assert.equal(logs[0].instanceId, 'test-instance');
  assert.equal(Object.keys(logs[0]).some(key => forbiddenKeys.test(key)), false);
});

test('falha do logger de telemetria não interrompe a aplicação', async () => {
  const { createFirestoreDiagnostics } = await import('../api/_lib/firestoreDiagnostics.js');
  const diagnostics = createFirestoreDiagnostics({ enabled: true, logger: () => { throw new Error('logger failure'); } });
  assert.doesNotThrow(() => diagnostics.emit({ operation: 'test', docs: 1 }));
});

test('helper não importa nem escreve no Firestore', async () => {
  const frontend = await read('src/lib/firestoreDiagnostics.ts');
  const backend = await read('api/_lib/firestoreDiagnostics.js');
  for (const source of [frontend, backend]) {
    assert.doesNotMatch(source, /from ['"][^'"]*firebase[^'"]*['"]/i);
    assert.doesNotMatch(source, /getDocs|onSnapshot|setDoc|updateDoc|addDoc|writeBatch|\.commit\(/);
  }
});

test('gate frontend exige VITE_FIRESTORE_DIAGNOSTICS=true', async () => {
  const source = await read('src/lib/firestoreDiagnostics.ts');
  assert.match(source, /VITE_FIRESTORE_DIAGNOSTICS/);
  assert.match(source, /toLowerCase\(\) === ['"]true['"]/);
  assert.doesNotMatch(source, /VITE_FIRESTORE_DIAGNOSTICS[^\n]*\|\|\s*true/);
});

test('AuthenticatedApp instrumenta somente os nove listeners existentes e reutiliza snapshots', async () => {
  const source = await read('src/App.tsx');
  assert.equal((source.match(/onSnapshot\(/g) || []).length, 9);
  assert.equal((source.match(/event: ['"]attach['"]/g) || []).length, 1);
  assert.equal((source.match(/event: ['"]detach['"]/g) || []).length, 1);
  assert.match(source, /docChanges\(\{ includeMetadataChanges: false \}\)/);
  assert.match(source, /metadataOnly[,}:]/);
  assert.match(source, /billedRead:/);
  assert.match(source, /hasPendingWrites:/);
  assert.doesNotMatch(source, /getDocs\(/);
});

test('Monitoramento registra cache, deduplicação, duração e contagens sem nova query', async () => {
  const source = await read('src/lib/accessApi.ts');
  const start = source.indexOf('export async function getMonitoringPanelData');
  const end = source.indexOf('export async function recordMonitoringSessionStart');
  const monitoringSource = source.slice(start, end);
  assert.match(monitoringSource, /cache-lookup/);
  assert.match(monitoringSource, /in-flight-dedupe/);
  assert.match(source, /event: ['"]request-start['"]/);
  assert.match(source, /event: ['"]request-finish['"]/);
  assert.match(source, /durationMs:/);
  assert.doesNotMatch(monitoringSource, /getDocs\(|onSnapshot\(|collection\(/);
});

test('runtime WhatsApp só mede consultas já existentes e não cria persistência', async () => {
  const source = await read('src/lib/whatsappReminderRuntime.js');
  assert.match(source, /buildReminderPlanContexts/);
  assert.match(source, /configSnapshots:/);
  assert.match(source, /patientsRead[,}]/);
  assert.match(source, /sessionsRead[,}]/);
  assert.match(source, /reminders[,}]/);
  assert.match(source, /invocationReason/);
  assert.doesNotMatch(source, /setDoc|updateDoc|addDoc|writeBatch|\.set\(|\.update\(|\.create\(/);
});

test('endpoints prioritários usam somente o helper de stdout sanitizado', async () => {
  const endpointPaths = [
    'api/access.js',
    'api/activity-records.js',
    'api/psychology.js',
    'api/public-booking.ts',
  ];
  for (const endpointPath of endpointPaths) {
    const source = await read(endpointPath);
    assert.match(source, /attachFirestoreDiagnostics/);
    assert.doesNotMatch(source, /firestoreDiagnostics\.(set|write|persist|save)/i);
  }
});

test('escritas WhatsApp existentes distinguem tentativa, sucesso e skip por hash', async () => {
  const source = await read('server.js');
  assert.match(source, /operation: ['"]dailyOperationalReport['"]/);
  assert.match(source, /operation: ['"]technicalSnapshot['"]/);
  assert.match(source, /attempted:/);
  assert.match(source, /persisted:/);
  assert.match(source, /skippedSameHash:/);
});

test('telemetria não altera resposta: attach só envolve res.json quando o gate está ativo', async () => {
  const source = await read('api/_lib/firestoreDiagnostics.js');
  assert.match(source, /if \(!firestoreDiagnostics\.enabled\) return;/);
  assert.match(source, /return originalJson\(payload\);/);
});
