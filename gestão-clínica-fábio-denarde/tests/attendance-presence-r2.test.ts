import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getCanonicalProfessionalCandidates, validateCanonicalProfessionalCandidatesResponse } from '../src/lib/accessApi';
import { assertSessionProfessionalIdentity } from '../src/features/whatsapp-persistence/canonicalProfessionalIdentity';
import { normalizeCanonicalProfessionalCandidates, resolveCanonicalProfessionalForNewSession } from '../src/features/whatsapp-persistence/canonicalSessionProfessional';
import { SessionStatus } from '../src/types';
import type { Session } from '../src/types';

const readSource = (relativePath: string) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const appSource = readSource('src/App.tsx');
const agendaSource = readSource('src/components/Agenda.tsx');
const dashboardSource = readSource('src/components/Dashboard.tsx');
const professionalId = 'professional-neuro-synthetic-001';

function legacySession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-legacy-synthetic-001',
    patientId: 'patient-legacy-synthetic-001',
    date: '2030-01-02',
    time: '09:00',
    type: 'Sessão',
    status: SessionStatus.AGENDADA,
    source: 'fixed',
    packageNumber: 7,
    consumesPackage: false,
    ...overrides,
  } as Session;
}

test('contrato canônico aceita candidato válido e lista vazia', () => {
  assert.deepEqual(validateCanonicalProfessionalCandidatesResponse({
    candidates: [{ professionalId: ` ${professionalId} `, contexts: ['NEUROPSICOPEDAGOGIA', 'NEUROPSICOPEDAGOGIA'] }],
  }), { candidates: [{ professionalId, contexts: ['NEUROPSICOPEDAGOGIA'] }] });
  assert.deepEqual(validateCanonicalProfessionalCandidatesResponse({ candidates: [] }), { candidates: [] });
});

test('contrato inválido, inclusive fallback antigo { profile: ... }, produz erro sanitizado', () => {
  for (const value of [{}, { profile: { displayName: 'legado' } }, null, { candidates: null }, { candidates: 'invalid' }, { candidates: [{}] }]) {
    assert.throws(
      () => validateCanonicalProfessionalCandidatesResponse(value),
      (error: unknown) => error instanceof Error
        && (error as Error & { code?: string }).code === 'access/invalid-canonical-professional-response'
        && error.name !== 'TypeError',
    );
  }
});

test('erro HTTP permanece controlado e sanitizado', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'access/denied', message: 'Acesso negado.' } }), { status: 403 })) as typeof fetch;
  try {
    await assert.rejects(
      () => getCanonicalProfessionalCandidates({ uid: 'uid-synthetic', getIdToken: async () => 'token-synthetic' } as never),
      (error: unknown) => error instanceof Error
        && (error as Error & { code?: string }).code === 'access/denied'
        && error.message === 'Acesso negado.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('helper normaliza coleção e nunca lança TypeError de iteração', () => {
  assert.deepEqual(normalizeCanonicalProfessionalCandidates([{ professionalId, contexts: ['NEUROPSICOPEDAGOGIA'] }]), [
    { professionalId, contexts: ['NEUROPSICOPEDAGOGIA'] },
  ]);
  assert.throws(() => resolveCanonicalProfessionalForNewSession({ candidates: [] }), /Nenhum Professional canônico autorizado/);
  assert.throws(
    () => resolveCanonicalProfessionalForNewSession({ candidates: { profile: { displayName: 'legado' } } }),
    (error: unknown) => error instanceof Error && error.name !== 'TypeError' && !/not iterable/.test(error.message),
  );
});

test('fluxo legado não depende do preflight canônico e preserva o contrato clínico', () => {
  const updateSource = appSource.slice(appSource.indexOf('const updateState = async'));
  assert.doesNotMatch(updateSource, /getCanonicalProfessionalCandidates|requiresCanonicalProfessional|resolveCanonicalProfessionalForNewSession/);
  assert.ok(updateSource.indexOf('let stateToPersist = newState') < updateSource.indexOf('let batch = writeBatch(db)'));
  const materialized = legacySession({ status: SessionStatus.REALIZADA, packageNumber: 8, consumesPackage: true });
  const reposition = { id: 'reposition-synthetic', patientId: materialized.patientId, originalSessionId: materialized.id, status: 'Pendente' };
  assert.equal(materialized.professionalId, undefined);
  assert.equal(materialized.packageNumber, 8);
  assert.equal(materialized.consumesPackage, true);
  assert.equal(reposition.originalSessionId, materialized.id);
});

test('Agenda e Dashboard mantêm materialização, ausência, falta profissional e reposição', () => {
  for (const source of [agendaSource, dashboardSource]) {
    assert.match(source, /const persistVirtualAction = async/);
    assert.match(source, /sessions: \[\.\.\.state\.sessions, result\.session\]/);
    assert.match(source, /repositions: \[\.\.\.state\.repositions, result\.reposition\]/);
    assert.match(source, /source: 'fixed'/);
    assert.match(source, /packageNumber: nextSessionNumber/);
    assert.match(source, /consumesPackage: newStatus === SessionStatus\.REALIZADA \|\| newStatus === SessionStatus\.REPOSICAO/);
    assert.match(source, /SessionStatus\.FALTA_PROF/);
  }
});

test('fluxo canônico obrigatório falha antes de qualquer escrita e WhatsApp continua fail-closed', () => {
  let writes = 0;
  assert.throws(() => {
    const resolved = resolveCanonicalProfessionalForNewSession({ candidates: null });
    writes++;
    return resolved;
  });
  assert.equal(writes, 0);
  assert.throws(() => resolveCanonicalProfessionalForNewSession({ candidates: [] }), /Nenhum Professional canônico autorizado/);
  assert.throws(() => assertSessionProfessionalIdentity({ professionalId: undefined }), /Persistência real/);
});

test('Psicologia permanece em rota e escopo próprios', () => {
  assert.match(appSource, /PsychologyPilot/);
  assert.match(readSource('src/features/psychology-persistence/scope.ts'), /context: PSYCHOLOGY_CONTEXT/);
  assert.match(readSource('src/features/psychology-pilot/PsychologyPilot.tsx'), /createPsychologyPersistenceScope/);
});
