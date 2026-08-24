import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPsychologyPersistenceScope,
  createPsychologyProfessionalProfile,
  resolvePsychologyRuntimeIdentity,
  presentationProfileFromRuntimeIdentity,
  type PsychologyProfessionalProfile,
} from '../src/features/psychology-persistence';
import {
  createEmptyPsychologyStore,
  createPsychologyScope,
  parsePsychologyStore,
  serializePsychologyStore,
  updatePsychologySettings,
} from '../src/features/psychology-pilot/psychologyDomain';
import { normalizePsychologySettings } from '../src/features/psychology-pilot/psychologyR2a';
import { createPsychologyPeriod } from '../src/features/psychology-pilot/psychologyFinancialLedger';
import { getPsychologyReport } from '../src/features/psychology-pilot/psychologyReports';
import { buildPsychologyReportPdf } from '../src/features/psychology-pilot/psychologyReportExports';
import type { PsychologyReportExportPayload } from '../src/features/psychology-pilot/psychologyReportExports';
import type { ProfessionalId } from '../src/types/professional';

const scopeA = createPsychologyPersistenceScope('r2d1a-professional-a', 'r2d1a-workspace');
const scopeB = createPsychologyPersistenceScope('r2d1a-professional-b', 'r2d1a-workspace');
const now = '2026-08-14T15:00:00.000Z';

test('R2D1A 01 — profile runtime exige workspaceId, professionalId e PSICOLOGIA', () => {
  const profile = createPsychologyProfessionalProfile(scopeA, undefined, now);
  assert.equal(profile.workspaceId, scopeA.workspaceId);
  assert.equal(profile.professionalId, scopeA.professionalId);
  assert.equal(profile.context, 'PSICOLOGIA');
  assert.throws(() => createPsychologyProfessionalProfile({ ...scopeA, workspaceId: '' }));
  assert.throws(() => createPsychologyProfessionalProfile({ ...scopeA, context: 'NEUROPSICOPEDAGOGIA' } as never));
});

test('R2D1A 02 — default local sintético é Leila Chaves — Psicóloga', () => {
  const local = createPsychologyProfessionalProfile(createPsychologyPersistenceScope('psychology-local-professional'));
  assert.equal(local.displayName, 'Leila Chaves');
  assert.equal(local.professionalTitle, 'Psicóloga');
  assert.equal(local.professionalRegistration, undefined);
});

test('R2D1A 03 — título, nome e registro são editáveis sem alterar identidade técnica', () => {
  const edited = createPsychologyProfessionalProfile(scopeA, { displayName: 'Maria Silva', professionalTitle: 'Psicóloga Clínica', professionalRegistration: 'CRP 00/00000' }, now);
  assert.deepEqual({ workspaceId: edited.workspaceId, professionalId: edited.professionalId, context: edited.context }, scopeA);
  assert.equal(edited.displayName, 'Maria Silva');
  assert.equal(edited.professionalTitle, 'Psicóloga Clínica');
  assert.equal(edited.professionalRegistration, 'CRP 00/00000');
});

test('R2D1A 04 — registro é opcional e não impõe formato de conselho', () => {
  const profile = createPsychologyProfessionalProfile(scopeA, { displayName: 'João Souza', professionalTitle: 'Psicólogo', professionalRegistration: 'Registro futuro / ABC' });
  assert.equal(profile.professionalRegistration, 'Registro futuro / ABC');
  assert.equal(createPsychologyProfessionalProfile(scopeB, { displayName: 'João Souza', professionalTitle: 'Psicólogo' }).professionalRegistration, undefined);
});

test('R2D1A 05 — dados legados de Settings são normalizados para o contrato novo', () => {
  const settings = normalizePsychologySettings({ professionalProfile: { name: 'Leila Chaves', specialty: 'Psicóloga', crp: 'CRP 00/00000', email: 'leila@example.test', phone: '27999990000' } }, createPsychologyScope(scopeA.professionalId));
  assert.equal(settings.professionalProfile.displayName, 'Leila Chaves');
  assert.equal(settings.professionalProfile.professionalTitle, 'Psicóloga');
  assert.equal(settings.professionalProfile.professionalRegistration, 'CRP 00/00000');
  assert.equal(settings.professionalProfile.name, settings.professionalProfile.displayName);
});

test('R2D1A 06 — runtime identity não infere ID por nome ou e-mail', () => {
  const identity = resolvePsychologyRuntimeIdentity({ scope: scopeA, presentationProfile: { displayName: 'Nome diferente', email: 'outro@example.test', professionalTitle: 'Psicóloga' } });
  assert.equal(identity.scope.professionalId, scopeA.professionalId);
  assert.equal(identity.profile.displayName, 'Nome diferente');
  assert.throws(() => resolvePsychologyRuntimeIdentity({ scope: scopeA, accessProfile: { workspaceId: scopeA.workspaceId, linkedProfessionalIds: ['different-id'] } }));
});

test('R2D1A 07 — fontes canônicas de Professional, ContextLink e AuthLink precisam corresponder', () => {
  assert.throws(() => resolvePsychologyRuntimeIdentity({ scope: scopeA, professional: { professionalId: scopeB.professionalId as ProfessionalId, authUid: 'uid' } }));
  assert.throws(() => resolvePsychologyRuntimeIdentity({ scope: scopeA, contextLink: { professionalId: scopeA.professionalId, context: 'NEUROPSICOPEDAGOGIA' } as never }));
  assert.throws(() => resolvePsychologyRuntimeIdentity({ scope: scopeA, authLink: { professionalId: scopeB.professionalId as ProfessionalId, authUid: 'uid' } }));
});

test('R2D1A 08 — converter de runtime mantém somente apresentação editável', () => {
  const identity = resolvePsychologyRuntimeIdentity({ scope: scopeA, presentationProfile: { displayName: 'Fábio Denarde', professionalTitle: 'Neuropsicopedagogo' } });
  const presentation = presentationProfileFromRuntimeIdentity(identity);
  assert.equal(presentation.displayName, 'Fábio Denarde');
  assert.equal(presentation.professionalTitle, 'Neuropsicopedagogo');
  assert.equal(presentation.name, 'Fábio Denarde');
  assert.equal(presentation.specialty, 'Neuropsicopedagogo');
  assert.equal('professionalId' in presentation, false);
});

test('R2D1A 09 — perfil A e perfil B permanecem isolados', () => {
  const a = createPsychologyProfessionalProfile(scopeA, { displayName: 'Profissional A', professionalTitle: 'Psicóloga' });
  const b = createPsychologyProfessionalProfile(scopeB, { displayName: 'Profissional B', professionalTitle: 'Psicólogo' });
  assert.equal(a.displayName, 'Profissional A');
  assert.equal(b.displayName, 'Profissional B');
  assert.notEqual(a.professionalId, b.professionalId);
});

test('R2D1A 10 — Profile Neuro não é aceito no contexto Psicologia', () => {
  assert.throws(() => resolvePsychologyRuntimeIdentity({ scope: { ...scopeA, context: 'NEUROPSICOPEDAGOGIA' } as never, presentationProfile: { displayName: 'Neuro', professionalTitle: 'Neuropsicopedagogo' } }));
});

test('R2D1A 11 — salvar e recarregar Settings local preserva apresentação sem mudar scope', () => {
  let store = createEmptyPsychologyStore(createPsychologyScope('psychology-local-professional'));
  store = updatePsychologySettings(store, { professionalProfile: { ...store.settings.professionalProfile, displayName: 'Leila Chaves Teste', professionalTitle: 'Psicóloga Escolar', professionalRegistration: 'CRP TESTE', name: 'Leila Chaves Teste', specialty: 'Psicóloga Escolar', crp: 'CRP TESTE' } }, now);
  const reloaded = parsePsychologyStore(serializePsychologyStore(store), store.scope);
  assert.equal(reloaded.settings.professionalProfile.displayName, 'Leila Chaves Teste');
  assert.equal(reloaded.settings.professionalProfile.professionalTitle, 'Psicóloga Escolar');
  assert.equal(reloaded.settings.professionalProfile.professionalRegistration, 'CRP TESTE');
  assert.deepEqual(reloaded.scope, store.scope);
});

test('R2D1A 12 — PDF usa nome, título e registro separados da mesma identidade', () => {
  const store = updatePsychologySettings(createEmptyPsychologyStore(createPsychologyScope(scopeA.professionalId)), {
    professionalProfile: {
      ...createEmptyPsychologyStore(createPsychologyScope(scopeA.professionalId)).settings.professionalProfile,
      displayName: 'Leila Chaves', professionalTitle: 'Psicóloga', professionalRegistration: 'CRP 00/00000', name: 'Leila Chaves', specialty: 'Psicóloga', crp: 'CRP 00/00000',
    },
  }, now);
  const filter = { period: createPsychologyPeriod('custom', undefined, '2026-08-01', '2026-08-31'), sessionStatus: 'all' as const, modality: 'all' as const, patientStatus: 'all' as const };
  const payload: PsychologyReportExportPayload = {
    kind: 'patients',
    report: getPsychologyReport(store, 'patients', filter),
    store,
    meta: { professionalName: store.settings.professionalProfile.displayName, specialty: store.settings.professionalProfile.professionalTitle, professionalId: store.scope.professionalId, crp: store.settings.professionalProfile.professionalRegistration, periodLabel: '01/08/2026 a 31/08/2026', filtersLabel: 'Todos' },
  };
  const pdf = buildPsychologyReportPdf(payload) as unknown as { internal: { pages: unknown } };
  const pdfText = JSON.stringify(pdf.internal.pages);
  assert.match(pdfText, /Leila Chaves/);
  assert.match(pdfText, /Psicóloga/);
  assert.match(pdfText, /CRP: CRP 00\/00000/);
  assert.equal(store.scope.professionalId, scopeA.professionalId);
});

test('R2D1A 13 — shell consome runtime identity e não hardcoda Psicologia como nome', () => {
  const source = readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  assert.match(source, /resolvePsychologyRuntimeIdentity/);
  assert.match(source, /runtimeIdentity\.profile\.displayName/);
  assert.match(source, /runtimeIdentity\.profile\.professionalTitle/);
});

test('R2D1A 14 — Ajustes expõe campos, preview, salvar e restaurar', () => {
  const source = readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
  for (const text of ['Nome de exibição', 'Área \/ título profissional', 'Registro profissional', 'Prévia no sistema', 'Salvar alterações', 'Restaurar dados do perfil']) assert.match(source, new RegExp(text));
});
