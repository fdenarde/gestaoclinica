import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEffectiveAccessContext } from '../api/_lib/accessPermissions.js';
import { isPsychologyRemoteClientEnabled } from '../src/features/psychology-persistence/remoteCanary.ts';
import { resolvePsychologyRouteMode } from '../src/features/psychology-pilot/psychologyDomain.ts';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const pilot = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
const remoteClient = await readFile(new URL('../src/features/psychology-persistence/remotePatientClient.ts', import.meta.url), 'utf8');
const apiRepository = await readFile(new URL('../src/features/psychology-persistence/repositories/api.ts', import.meta.url), 'utf8');

function psychologyAccessContext(profile) {
  return buildEffectiveAccessContext({
    decodedToken: { uid: 'synthetic-auth-user', email: 'professional@example.test' },
    profile,
    primaryAdminEmail: 'admin@example.test',
    primaryAdminWorkspaceId: 'synthetic-admin-workspace',
    requestedContext: 'professional',
  });
}

test('R42 — modo de rota separa piloto local, remoto autenticado e produção', () => {
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', true, 'localhost', 'pilot-local'), 'pilot-local');
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', true, 'localhost', 'authenticated-remote'), 'authenticated-remote');
  assert.equal(resolvePsychologyRouteMode('/psicologia', '', false, 'app.example.test', 'pilot-local'), 'authenticated-remote');
  assert.equal(resolvePsychologyRouteMode('/', '?psicologia=1', false, 'app.example.test', 'pilot-local'), 'normal');
  assert.match(app, /const psychologyPilotRoute = psychologyRouteMode === 'pilot-local'/);
  assert.match(app, /const psychologyAuthenticatedRoute = psychologyRouteMode === 'authenticated-remote'/);
  assert.match(app, /if \(psychologyPilotRoute && !psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="pilot-local" \/>/);
  assert.match(app, /if \(psychologyAuthenticatedRoute\) return <PsychologyPilot runtimeMode="authenticated-remote" \/>/);
});

test('R42 — Authenticated Remote é o único provider remoto e o piloto local não é fonte clínica', () => {
  assert.equal(isPsychologyRemoteClientEnabled('authenticated-remote'), true);
  assert.equal(isPsychologyRemoteClientEnabled('pilot-local'), false);
  assert.match(pilot, /enabled: isPsychologyRemoteClientEnabled\(runtimeMode\)/);
  assert.match(pilot, /const remoteClient = useMemo\(\(\) => remoteConfiguration\.enabled/);
  assert.match(pilot, /remoteConfiguration\.enabled\s*\?\s*remoteStore[\s\S]*:\s*doctoraliaPreview\?\.store \|\| localStore/);
  assert.match(pilot, /if \(!remoteConfiguration\.enabled\) return updateStore\(next\)/);
  assert.match(pilot, /if \(remoteConfiguration\.enabled\) \{[\s\S]*remoteClient\.updatePatient/);
  assert.match(apiRepository, /function adoptResponseScope\(/);
  assert.match(remoteClient, /repositories\.patients\.list/);
});

test('R42 — perfil legado profissional aprovado entra na Psicologia sem solicitação de acesso', () => {
  const context = psychologyAccessContext({
    role: 'professional',
    status: 'approved',
    workspaceId: 'synthetic-workspace',
  });
  assert.equal(context.role, 'professional');
  assert.equal(context.status, 'approved');
  assert.equal(context.permissions['patients.list'], true);
  assert.match(app, /psychologyAuthenticatedRoute\s*\?\s*'professional'/);
  assert.match(app, /if \(!user \|\| !canAccessInternalSystem\)/);
  assert.ok(app.indexOf('if (psychologyAuthenticatedRoute) return <PsychologyPilot') > app.indexOf('if (!user || !canAccessInternalSystem)'));
  assert.match(app, /visualContext: VisualContext = psychologyAuthenticatedRoute \? 'PSICOLOGIA' : 'DEFAULT'/);
  assert.match(app, /visualContext=\{visualContext\}/);
});

test('R42 — formulário real preserva três obrigatórios, responsável opcional e agenda sem cancelados', () => {
  const dialog = pilot.slice(pilot.indexOf('function PatientDialogR2F3E'), pilot.indexOf('function PatientDialog('));
  for (const label of ['Nome completo *', 'Data de nascimento (opcional)', 'Telefone *', 'E-mail (opcional)', 'Modalidade preferencial *']) {
    assert.match(dialog, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(dialog, /Todos os campos são opcionais/);
  assert.match(pilot, /Excluir selecionados \(\{selectedVisibleIds\.length\}\)/);
  assert.match(pilot, /getPsychologyAgendaSessionsForSlot\(sessions, date, time\)/);
  assert.match(pilot, /session\.status !== 'cancelada'/);
});
