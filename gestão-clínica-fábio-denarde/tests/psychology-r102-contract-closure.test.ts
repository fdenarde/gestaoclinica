import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path: string) => fs.readFileSync(new URL(path, root), 'utf8');

test('R102/R104 financeiro remoto usa contrato explícito e não confirma alteração local falsa', () => {
  const finance = read('src/features/psychology-pilot/PsychologyFinanceView.tsx');
  const routes = read('api/psychology.js');
  const accessPermissions = read('api/_lib/accessPermissions.js');

  assert.match(finance, /onRemoteMutation\?:/);
  assert.match(finance, /disabled=\{remoteWriteBlocked \|\| processing\}/);
  assert.match(finance, /data-testid="psychology-finance-remote-readonly"/);
  assert.match(finance, /Aguarde o carregamento do provider remoto antes de salvar o financeiro/);
  assert.ok(finance.indexOf('if (remoteWriteBlocked)') < finance.indexOf('onRemoteMutation(result)'));
  assert.match(routes, /charges: \{ aggregate: 'charges', readPermission: 'finance\.patient\.view', writePermission: 'finance\.manage' \}/);
  assert.match(routes, /payments: \{ aggregate: 'payments', readPermission: 'finance\.patient\.view', writePermission: 'finance\.manage' \}/);
  assert.match(routes, /expenses: \{ aggregate: 'expenses', readPermission: 'finance\.patient\.view', writePermission: 'finance\.manage' \}/);
  const professionalBlock = accessPermissions.match(/const PROFESSIONAL_PERMISSIONS = permissionsFromAllowedKeys\(\[(.*?)\]\);/s)?.[1] || '';
  assert.match(professionalBlock, /finance\.patient\.view/);
  assert.match(professionalBlock, /finance\.manage/);
});

test('R102 registros clínicos e documentos não ficam como controles remotos habilitados sem contrato', () => {
  const pilot = read('src/features/psychology-pilot/PsychologyPilot.tsx');
  const chart = read('src/features/psychology-pilot/PsychologyPatientChart.tsx');
  const routes = read('api/psychology.js');

  assert.match(pilot, /recordReadOnly=\{remoteConfiguration\.enabled\}/);
  assert.match(pilot, /if \(isPreview \|\| remoteConfiguration\.enabled\) return/);
  assert.match(routes, /if \(resource === 'session-records' && req\.method === 'GET' && !id\)/);
  const genericRoutes = routes.match(/const GENERIC_OPERATION_ROUTES = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.doesNotMatch(genericRoutes, /session-records/);
  assert.match(routes, /documents: \{ aggregate: 'documents', readPermission: 'documents\.view', writePermission: null \}/);
  assert.match(routes, /attachments: \{ aggregate: 'attachments', readPermission: 'documents\.view', writePermission: null \}/);
  assert.match(chart, /const tabs: Array<\{ id: ChartTab; label: string \}>/);
  assert.match(chart, /\{ id: 'summary', label: 'Resumo' \}/);
  assert.match(chart, /\{ id: 'sessions', label: 'Sessões' \}/);
  assert.doesNotMatch(chart, /<RecordsTab[\s\S]*<FinanceTab|<FinanceTab[\s\S]*<DocumentsTab|<DocumentsTab/);
});

test('R102 superfície bloqueada fica classificada sem decisão de produto inventada', () => {
  const finance = read('src/features/psychology-pilot/PsychologyFinanceView.tsx');
  const pilot = read('src/features/psychology-pilot/PsychologyPilot.tsx');

  assert.match(finance, /Escrita financeira remota ainda não disponível/);
  assert.match(pilot, /Registro clínico remoto ainda não está disponível neste painel/);
  assert.match(pilot, /Provider remoto ativo: esta ação ainda não está disponível neste painel/);
  assert.doesNotMatch(pilot, /fallback.*Neuro/i);
  assert.doesNotMatch(pilot, /pilot-local/i);
});
