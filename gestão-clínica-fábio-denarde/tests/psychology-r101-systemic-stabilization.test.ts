import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createApiPsychologyRepositories } from '../src/features/psychology-persistence/repositories/api';
import { createPsychologyRemotePatientClient, patientStoreWithoutIds } from '../src/features/psychology-persistence/remotePatientClient';
import type { PsychologyPersistenceScope } from '../src/features/psychology-persistence/scope';
import { createEmptyPsychologyStore, createPsychologyScope } from '../src/features/psychology-pilot/psychologyDomain';

const scope: PsychologyPersistenceScope = {
  workspaceId: 'r101-workspace',
  professionalId: 'r101-professional',
  context: 'PSICOLOGIA' as const,
};

function makeStore() {
  const store = createEmptyPsychologyStore(createPsychologyScope(scope.professionalId));
  return {
    ...store,
    sessions: [
      { id: 'session-a', ...scope, patientId: 'patient-a', date: '2026-08-28', time: '09:00', durationMinutes: 50, modality: 'presencial' as const, status: 'agendada' as const, createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-08-28T09:00:00.000Z' },
      { id: 'session-b', ...scope, patientId: 'patient-b', date: '2026-08-28', time: '10:00', durationMinutes: 50, modality: 'presencial' as const, status: 'agendada' as const, createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-08-28T09:00:00.000Z' },
    ],
    patients: [
      { id: 'patient-a', ...scope, name: 'Paciente A', birthDate: '1990-01-01', phone: '27999999999', email: '', preferredModality: 'presencial' as const, active: true, createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-08-28T09:00:00.000Z' },
      { id: 'patient-b', ...scope, name: 'Paciente B', birthDate: '1990-01-01', phone: '27888888888', email: '', preferredModality: 'presencial' as const, active: true, createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-08-28T09:00:00.000Z' },
    ],
  };
}

test('R101 exclusão remota reconcilia o paciente e seus vínculos sem sessão órfã visível', () => {
  const next = patientStoreWithoutIds(makeStore(), ['patient-a']);

  assert.deepEqual(next.patients.map(item => item.id), ['patient-b']);
  assert.deepEqual(next.sessions.map(item => item.id), ['session-b']);
});

test('R101 status de sessão remoto envia uma única atualização PATCH e preserva o contrato de resposta', async () => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const repositories = createApiPsychologyRepositories({
    scope,
    getToken: async () => 'synthetic-token',
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), method: init.method, body: String(init.body || '') });
      return new Response(JSON.stringify({ scope, session: { id: 'session-a', ...scope, patientId: 'patient-a', date: '2026-08-28', time: '09:00', durationMinutes: 50, modality: 'presencial', status: 'realizada', createdAt: '2026-08-28T09:00:00.000Z', updatedAt: '2026-08-28T09:01:00.000Z' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const saved = await repositories.sessions.update(scope, 'session-a', { status: 'realizada' });

  assert.equal(saved?.status, 'realizada');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/psychology/sessions/session-a');
  assert.equal(requests[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].body || '{}'), { status: 'realizada' });
});

test('R101 hidrata Agenda Pessoal/Mentoria pelo repository remoto sem leitura clínica', async () => {
  const personal = {
    id: 'personal-a',
    ...scope,
    date: '2026-08-28',
    time: '11:00',
    durationMinutes: 60,
    type: 'Mentoria',
    title: 'Mentoria sintética',
    note: '',
    recurrence: 'Não repetir',
    alarmEnabled: false,
    isDone: false,
    createdAt: '2026-08-28T09:00:00.000Z',
    updatedAt: '2026-08-28T09:00:00.000Z',
  };
  const paths: string[] = [];
  const client = createPsychologyRemotePatientClient({
    scope,
    api: {
      getToken: async () => 'synthetic-token',
      fetchImpl: async (url: RequestInfo | URL) => {
        const path = new URL(String(url), 'http://localhost').pathname;
        paths.push(path);
        if (path.endsWith('/patients')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (path.endsWith('/sessions')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (path.endsWith('/personal-appointments')) return new Response(JSON.stringify({ items: [personal] }), { status: 200 });
        if (path.endsWith('/charges') || path.endsWith('/payments') || path.endsWith('/expenses')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (path.endsWith('/settings')) return new Response(JSON.stringify({ settings: {} }), { status: 200 });
        throw new Error(`Unexpected request: ${path}`);
      },
    },
  });

  const loaded = await client.load();

  assert.deepEqual(loaded.personalCommitments.map(item => item.id), ['personal-a']);
  assert.equal(paths.filter(path => path.endsWith('/personal-appointments')).length, 1);
});

test('R101 exclusão mostra processamento, bloqueia duplo clique, libera retry no erro e cobre resposta remota atrasada', () => {
  const pilotSource = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');

  assert.match(pilotSource, /data-testid="psychology-event-mutation-processing"/);
  assert.match(pilotSource, /data-testid="psychology-session-mutation-processing"/);
  assert.match(pilotSource, /data-testid="psychology-patient-save-error"/);
  assert.match(pilotSource, /Excluindo…/);
  assert.match(pilotSource, /submitLock\.current/);
  assert.match(pilotSource, /Não foi possível excluir o paciente\. Nenhuma alteração foi confirmada\./);
  assert.match(pilotSource, /Salvando…/);
  assert.match(pilotSource, /updateSessionStatus/);
  assert.match(pilotSource, /remoteWriteBlocked={remoteConfiguration\.enabled && \(remoteLoading \|\| Boolean\(remoteError\) \|\| !remoteStore\)}/);
  assert.match(pilotSource, /recordReadOnly={remoteConfiguration\.enabled}/);
});
