import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const featureRoot = path.join(root, 'src', 'features', 'whatsapp-simulation');
const featureFiles = [
  'SimulationDashboard.tsx',
  'simulationFixtures.ts',
  'simulationProvider.ts',
  'simulationState.ts',
  'simulationTypes.ts',
].map(file => path.join(featureRoot, file));
const source = featureFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

test('o módulo simulado existe somente na pasta autorizada', () => {
  assert.ok(featureFiles.every(file => fs.existsSync(file)));
  assert.equal(featureFiles.some(file => file.includes('src\\lib') || file.includes('src/components/WhatsApp')), false);
});

test('fixtures usam somente dados sintéticos e não possuem campos clínicos ou telefones', async () => {
  const { SIMULATION_FIXTURES } = await import('../src/features/whatsapp-simulation/simulationFixtures.ts');
  const serialized = JSON.stringify(SIMULATION_FIXTURES);
  assert.match(serialized, /SIM-TENANT-A/);
  assert.match(serialized, /SIM-CONTATO-001/);
  assert.doesNotMatch(serialized, /\b\d{8,15}\b/);
  assert.doesNotMatch(serialized, /\(\d{2}\)\s?\d{4,5}[- ]?\d{4}/);

  const forbiddenKeys = new Set(['patientId', 'patient', 'guardian', 'diagnosis', 'anamnesis', 'clinicalRecord', 'payment', 'session']);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `campo clínico indevido: ${key}`);
      visit(child);
    }
  };
  visit(SIMULATION_FIXTURES);
});

test('a árvore do módulo não possui dependências reais ou APIs de rede/persistência', () => {
  const forbidden = [
    /(?:from|import\s*\(|require\s*\()[^\n;]*firebase/i,
    /(?:from|import\s*\(|require\s*\()[^\n;]*firebase-admin/i,
    /(?:from|import\s*\(|require\s*\()[^\n;]*whatsapp-web\.js/i,
    /(?:from|import\s*\(|require\s*\()[^\n;]*server\.js/i,
    /(?:from|import\s*\(|require\s*\()[^\n;]*(scheduler|watchdog|OperationalReport)/i,
    /\bfetch\s*\(/i,
    /\baxios\b/i,
    /WebSocket/i,
    /XMLHttpRequest/i,
    /process\.env/i,
    /import\.meta\.env/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /document\.cookie/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `dependência proibida: ${pattern}`);
});

test('provedor fictício registra, falha e mantém idempotência em memória', async () => {
  const { createSimulationProvider } = await import('../src/features/whatsapp-simulation/simulationProvider.ts');
  const provider = createSimulationProvider();
  const input = {
    provider: 'simulation',
    tenantId: 'SIM-TENANT-A',
    conversationId: 'SIM-CONVERSA-001',
    operationKey: 'SIM-OP-TESTE-001',
    body: 'Mensagem exclusivamente fictícia.',
  };
  const first = provider.registerMessage(input);
  const duplicate = provider.registerMessage(input);
  assert.equal(first.status, 'simulated_queued');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.messageId, first.messageId);

  const failed = provider.registerMessage({ ...input, operationKey: 'SIM-OP-TESTE-002', shouldFail: true });
  assert.equal(failed.status, 'simulated_failed');
  assert.throws(() => provider.registerMessage({ ...input, provider: 'production', operationKey: 'SIM-OP-TESTE-003' }), /simulation/);
});

test('provedor não chama rede mesmo quando fetch é substituído por bloqueio', async () => {
  const { createSimulationProvider } = await import('../src/features/whatsapp-simulation/simulationProvider.ts');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('rede bloqueada pelo teste');
  };
  try {
    createSimulationProvider().registerMessage({
      provider: 'simulation',
      tenantId: 'SIM-TENANT-A',
      conversationId: 'SIM-CONVERSA-001',
      operationKey: 'SIM-OP-REDE-001',
      body: 'A rede não deve ser acessada.',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test('status simulados avançam e cancelamento respeita estados terminais', async () => {
  const { createSimulationProvider } = await import('../src/features/whatsapp-simulation/simulationProvider.ts');
  const provider = createSimulationProvider();
  assert.equal(provider.advanceStatus('simulated_queued'), 'simulated_processed');
  assert.equal(provider.advanceStatus('simulated_processed'), 'simulated_delivered');
  assert.equal(provider.advanceStatus('simulated_delivered'), 'simulated_read');
  assert.equal(provider.cancelStatus('simulated_processed'), 'simulated_cancelled');
  assert.equal(provider.cancelStatus('simulated_read'), 'simulated_read');
});

test('tenants sintéticos permanecem separados', async () => {
  const { SIMULATION_FIXTURES } = await import('../src/features/whatsapp-simulation/simulationFixtures.ts');
  const tenantA = SIMULATION_FIXTURES.filter(item => item.tenantId === 'SIM-TENANT-A');
  const tenantB = SIMULATION_FIXTURES.filter(item => item.tenantId === 'SIM-TENANT-B');
  assert.ok(tenantA.length > 0);
  assert.ok(tenantB.length > 0);
  assert.equal(tenantA.some(item => tenantB.some(other => other.id === item.id)), false);
  assert.equal(tenantA.some(item => tenantB.some(other => other.contact.id === item.contact.id)), false);
});

test('interface mantém aviso e ação explicitamente simulados', () => {
  const dashboard = [
    fs.readFileSync(path.join(featureRoot, 'SimulationDashboard.tsx'), 'utf8'),
    fs.readFileSync(path.join(featureRoot, 'components', 'SimulationHeader.tsx'), 'utf8'),
    fs.readFileSync(path.join(featureRoot, 'components', 'SimulationShell.tsx'), 'utf8'),
    fs.readFileSync(path.join(featureRoot, 'components', 'inbox', 'ConversationView.tsx'), 'utf8'),
  ].join('\n');
  assert.match(dashboard, /Ambiente de demonstração — nenhuma mensagem será enviada/);
  assert.match(dashboard, /Registrar mensagem/);
  assert.doesNotMatch(dashboard, />\s*Enviar\s*</i);
  assert.match(dashboard, /memória local/i);
});

test('nenhum arquivo proibido foi adicionado ao escopo novo', () => {
  const prohibitedNames = ['server.js', 'ecosystem.config.cjs', 'package.json', 'vercel.json', 'firebase.json'];
  assert.equal(featureFiles.some(file => prohibitedNames.includes(path.basename(file))), false);
});
