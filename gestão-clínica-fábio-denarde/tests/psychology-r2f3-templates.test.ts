import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMetaTemplateDryRunPayload } from '../api/_lib/metaTemplateDryRun.js';
import { createMetaTemplateProvider, MetaWriteDisabledError } from '../api/_lib/metaTemplateProvider.js';
import {
  R2F3_TEMPLATE_SPECS,
  compileMetaTemplateDraft,
  createR2f3TemplateDrafts,
  invalidateTemplateApproval,
  prepareTemplateDraft,
  runTemplatePreflight,
  sha256Hex,
} from '../src/features/psychology-messaging/templatePreparation';
import {
  buildSubmissionCandidate,
  evaluateR2f3ReminderEligibility,
  isCivilEveEligible,
  resolveProfessionalDisplayName,
} from '../src/features/psychology-messaging/r2f3RuntimeContract';
import { renderMessagePreview } from '../src/features/psychology-messaging/messagingDomain';
import { createLocalMessageCenterRepository, ensurePsychologyR2f3LocalState } from '../src/features/psychology-messaging/repository';
import { createMemoryStorage } from '../src/features/psychology-persistence/repositories/local';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope';

const scope = createPsychologyPersistenceScope('professional-r2f3', 'workspace-r2f3');
const noCollision = { existingMetaTemplates: [], metaLookupComplete: true } as const;

test('R2F3 preserva estritamente os dois textos aprovados', () => {
  assert.equal(R2F3_TEMPLATE_SPECS.PRESENCIAL.approvedText, `Olá! Este é um lembrete da Gestão Clínica. Seu atendimento com [PROFISSIONAL] está agendado para amanhã, [DATA], às [HORÁRIO].\n\nLocal: [LOCAL]\nEndereço: [ENDEREÇO]\n\nPara confirmar, cancelar ou consultar os dados do atendimento:\nGerenciar minha consulta`);
  assert.equal(R2F3_TEMPLATE_SPECS.ONLINE.approvedText, `Olá! Este é um lembrete da Gestão Clínica. Seu atendimento online com [PROFISSIONAL] está agendado para amanhã, [DATA], às [HORÁRIO].\n\nPara confirmar, cancelar ou consultar os dados do atendimento:\nGerenciar minha consulta`);
  assert.doesNotMatch(R2F3_TEMPLATE_SPECS.ONLINE.body, /Local:|Endereço:|Maps:/i);
});

test('compiler mantém variáveis 1:1, ordem estável, exemplos fictícios e preflight', () => {
  const [presencial, online] = createR2f3TemplateDrafts(scope);
  const preparedPresencial = prepareTemplateDraft(presencial, noCollision);
  const preparedOnline = prepareTemplateDraft(online, noCollision);
  const compiledPresencial = compileMetaTemplateDraft(preparedPresencial);
  const compiledOnline = compileMetaTemplateDraft(preparedOnline);
  assert.equal(preparedPresencial.preflightStatus, 'READY');
  assert.equal(preparedPresencial.preflightBlockers?.length || 0, 0);
  assert.equal(preparedPresencial.metaNameCollisionStatus, 'NO_COLLISION');
  assert.equal(preparedOnline.preflightStatus, 'READY');
  assert.equal(preparedOnline.localContentApproval, 'CONTENT_APPROVED_LOCALLY');
  assert.deepEqual(compiledOnline.bodyVariables, ['PROFESSIONAL', 'DATE', 'TIME']);
  assert.deepEqual(compiledOnline.semanticVariableMap.map(entry => [entry.semanticVariable, entry.metaPlaceholder]), [['PROFESSIONAL', '{{1}}'], ['DATE', '{{2}}'], ['TIME', '{{3}}'], ['MANAGE_APPOINTMENT', '{{1}}']]);
  assert.equal(compiledPresencial.semanticVariableMap.find(entry => entry.semanticVariable === 'MAPS')?.metaPlaceholder, '{{1}}');
  assert.deepEqual(compiledPresencial.payload.components.find(component => component.type === 'BUTTONS')?.buttons.map(button => button.text), ['Abrir no Google Maps', 'Gerenciar minha consulta']);
  assert.equal(validateMetaTemplateDryRunPayload(compiledPresencial.payload).validated, true);
  assert.equal(compiledOnline.payload.components.some(component => component.type === 'BUTTONS'), true);
  assert.doesNotMatch(JSON.stringify(compiledOnline.payload), /managementToken|patient|telefone|diagnóstico/i);
  assert.equal(validateMetaTemplateDryRunPayload(compiledOnline.payload).validated, true);
  assert.equal(buildSubmissionCandidate(preparedOnline, true).payloadDryRunValidated, true);
  const preview = renderMessagePreview(preparedOnline, 'ONLINE');
  assert.deepEqual(preview.actions.filter(action => action.enabled).map(action => action.label), compiledOnline.payload.components.find(component => component.type === 'BUTTONS')?.buttons.map(button => button.text));
});

test('hash é SHA-256 determinístico, normaliza somente line endings/Unicode e muda com edição real', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const online = createR2f3TemplateDrafts(scope)[1];
  const a = compileMetaTemplateDraft(online).contentHash;
  const b = compileMetaTemplateDraft({ ...online, body: online.body.replace(/\n/g, '\r\n') }).contentHash;
  const c = compileMetaTemplateDraft({ ...online, body: `${online.body}!` }).contentHash;
  assert.equal(a, b);
  assert.notEqual(a, c);
  const edited = prepareTemplateDraft({ ...online, body: `${online.body}!`, draftVersion: 2 }, noCollision);
  assert.equal(edited.draftVersion, 2);
  assert.notEqual(edited.contentHash, online.contentHash);
  assert.equal(invalidateTemplateApproval(edited, 2).localContentApproval, 'NOT_APPROVED');
});

test('preflight bloqueia variável desconhecida, placeholder duplicado e incompatibilidade Online/Presencial', () => {
  const online = createR2f3TemplateDrafts(scope)[1];
  const unknown = { ...online, semanticVariables: [...online.semanticVariables, 'UNKNOWN' as never] };
  assert.equal(runTemplatePreflight(unknown, compileMetaTemplateDraft(unknown), noCollision).status, 'BLOCKED');
  const duplicatePayload = { name: 'psicologia_teste', language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}} {{1}}', example: { body_text: [['Teste', 'Teste']] } }] } as const;
  assert.throws(() => validateMetaTemplateDryRunPayload(duplicatePayload), /placeholder/i);
  const missingExample = { ...duplicatePayload, components: [{ type: 'BODY', text: 'Olá {{1}}', example: { body_text: [[]] } }] } as const;
  assert.throws(() => validateMetaTemplateDryRunPayload(missingExample), /exemplo|placeholders/i);
  const onlineWithLocation = { ...online, body: `${online.body}\nLocal: [LOCAL]`, semanticVariables: [...online.semanticVariables, 'LOCATION' as const] };
  assert.equal(runTemplatePreflight(onlineWithLocation, compileMetaTemplateDraft(onlineWithLocation), noCollision).status, 'BLOCKED');
  const presencialWithoutAddress = { ...createR2f3TemplateDrafts(scope)[0], semanticVariables: ['PROFESSIONAL', 'DATE', 'TIME', 'LOCATION', 'MAPS', 'MANAGE_APPOINTMENT'] as Array<'PROFESSIONAL' | 'DATE' | 'TIME' | 'LOCATION' | 'MAPS' | 'MANAGE_APPOINTMENT'> };
  assert.equal(runTemplatePreflight(presencialWithoutAddress, compileMetaTemplateDraft(presencialWithoutAddress), noCollision).errors.some(error => error.includes('Endereço')), true);
  const collision = prepareTemplateDraft(online, { existingMetaTemplates: [{ id: 'synthetic', name: online.technicalName!, language: 'pt_BR', category: 'UTILITY', status: 'APPROVED' }], metaLookupComplete: true });
  assert.equal(collision.preflightStatus, 'BLOCKED');
  assert.equal(collision.metaNameCollisionStatus, 'COLLISION');
  const localDuplicate = runTemplatePreflight(online, compileMetaTemplateDraft(online), { ...noCollision, existingLocalDrafts: [{ ...online, id: 'other-local-id' }] });
  assert.equal(localDuplicate.status, 'BLOCKED');
  assert.ok(localDuplicate.blockers.some(blocker => blocker.includes('DUPLICIDADE LOCAL')));
});

test('persistência/reload mantém os dois drafts, hash, versão, aprovação e preflight', () => {
  const storage = createMemoryStorage();
  const repositoryA = createLocalMessageCenterRepository({ scope, storage, now: () => '2026-08-17T12:00:00.000Z' });
  const first = ensurePsychologyR2f3LocalState({ repository: repositoryA, scope, metaTemplates: [] });
  assert.equal(first.templates.filter(template => template.technicalName?.startsWith('psicologia_lembrete_')).length, 2);
  const repositoryB = createLocalMessageCenterRepository({ scope, storage, now: () => '2026-08-17T12:00:00.000Z' });
  const reloaded = ensurePsychologyR2f3LocalState({ repository: repositoryB, scope, metaTemplates: [] });
  for (const template of reloaded.templates.filter(item => item.technicalName?.startsWith('psicologia_lembrete_'))) {
    assert.ok(template.body);
    assert.ok(template.semanticVariables.length);
    assert.ok(template.technicalName);
    assert.equal(template.language, 'pt_BR');
    assert.equal(template.requestedCategory, 'UTILITY');
    assert.equal(template.draftVersion, 1);
    assert.match(template.contentHash || '', /^[a-f0-9]{64}$/);
    assert.equal(template.localContentApproval, 'CONTENT_APPROVED_LOCALLY');
    assert.equal(template.metaNameCollisionStatus, 'NO_COLLISION');
  }
});

test('falha de leitura Meta não transforma ausência de resposta em ausência de colisão nem apaga aprovação', () => {
  const storage = createMemoryStorage();
  const repository = createLocalMessageCenterRepository({ scope, storage, now: () => '2026-08-17T12:00:00.000Z' });
  const connected = ensurePsychologyR2f3LocalState({ repository, scope, metaTemplates: [] });
  const online = connected.templates.find(template => template.modalityScope === 'ONLINE')!;
  assert.equal(online.localContentApproval, 'CONTENT_APPROVED_LOCALLY');
  const failedRead = ensurePsychologyR2f3LocalState({ repository, scope });
  const preserved = failedRead.templates.find(template => template.id === online.id)!;
  assert.equal(preserved.localContentApproval, 'CONTENT_APPROVED_LOCALLY');
  assert.equal(preserved.contentHash, online.contentHash);
  assert.equal(preserved.metaNameCollisionStatus, 'UNVERIFIED');
  assert.equal(preserved.preflightStatus, 'BLOCKED');
  assert.equal(buildSubmissionCandidate(preserved, true).payloadDryRunValidated, false);
});

test('elegibilidade futura usa dia civil America/Sao_Paulo, cancela e exige dados por modalidade', () => {
  const now = new Date('2026-08-17T15:00:00.000Z');
  assert.equal(isCivilEveEligible(now, '2026-08-18'), true);
  assert.equal(isCivilEveEligible(new Date('2026-08-18T15:00:00.000Z'), '2026-08-19'), true);
  assert.equal(isCivilEveEligible(now, '2026-08-17'), false);
  const online = evaluateR2f3ReminderEligibility({ status: 'SCHEDULED', modality: 'ONLINE', professionalDisplayName: 'Leila Chaves – Psicóloga', civilDate: '2026-08-18', startTime: '15:00', managementUrl: 'https://app.example/consulta/management-preview' }, now);
  assert.equal(online.status, 'ELIGIBLE');
  const presencial = evaluateR2f3ReminderEligibility({ status: 'SCHEDULED', modality: 'PRESENCIAL', professionalDisplayName: 'Profissional Teste – Psicóloga', civilDate: '2026-08-18', startTime: '15:00', locationId: 'location-synthetic', location: { displayName: 'Clínica Sintética', fullAddress: 'Avenida Sintética, 100 – Vila Velha/ES' }, managementUrl: 'https://app.example/consulta/management-preview' }, now);
  assert.equal(presencial.status, 'ELIGIBLE');
  const missingLocation = evaluateR2f3ReminderEligibility({ status: 'SCHEDULED', modality: 'PRESENCIAL', professionalDisplayName: 'Profissional Teste', civilDate: '2026-08-18', startTime: '15:00', managementUrl: 'https://app.example/consulta/management-preview' }, now);
  assert.equal(missingLocation.status, 'BLOCKED_MISSING_DATA');
  assert.ok(missingLocation.missing.includes('locationId'));
  const cancelled = evaluateR2f3ReminderEligibility({ status: 'CANCELLED', modality: 'ONLINE', civilDate: '2026-08-18' }, now);
  assert.equal(cancelled.status, 'SKIPPED_CANCELLED');
  const late = evaluateR2f3ReminderEligibility({ status: 'SCHEDULED', modality: 'ONLINE', professionalDisplayName: 'Profissional Teste', civilDate: '2026-08-19', startTime: '15:00', managementUrl: 'https://app.example/consulta/management-preview' }, now);
  assert.equal(late.status, 'SKIPPED_OUTSIDE_WINDOW');
  assert.equal(resolveProfessionalDisplayName('Leila Chaves – Psicóloga'), 'Leila Chaves – Psicóloga');
});

test('write adapter permanece fail-closed antes de qualquer transporte', async () => {
  let transportCalls = 0;
  const provider = createMetaTemplateProvider({ env: { META_TEMPLATE_READ_ENABLED: 'YES', META_GRAPH_API_VERSION: 'v-test', META_WABA_ID: 'synthetic', META_ACCESS_TOKEN: 'synthetic', META_WRITE_ENABLED: 'NO', META_SEND_ENABLED: 'NO' }, request: async () => { transportCalls += 1; return { ok: true, json: async () => ({ data: [] }) }; } });
  assert.equal(provider.capabilities().canWrite, false);
  await assert.rejects(() => provider.createTemplate({} as never), MetaWriteDisabledError);
  await assert.rejects(() => provider.editTemplate({} as never), MetaWriteDisabledError);
  await assert.rejects(() => provider.deleteTemplate({} as never), MetaWriteDisabledError);
  await assert.rejects(() => provider.submitTemplate({} as never), MetaWriteDisabledError);
  assert.equal(transportCalls, 0);
});
