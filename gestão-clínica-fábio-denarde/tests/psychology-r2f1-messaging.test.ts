import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDefaultMessageCenterState,
  extractSemanticVariables,
  isReminderEligibleForSession,
  renderMessagePreview,
  validateMessageTemplate,
} from '../src/features/psychology-messaging/messagingDomain';
import { createLocalMessageCenterRepository } from '../src/features/psychology-messaging/repository';
import { createNoopMessageTemplateProvider } from '../src/features/psychology-messaging/provider';
import { createMemoryStorage } from '../src/features/psychology-persistence/repositories/local';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope';

const scopeA = createPsychologyPersistenceScope('professional-a', 'workspace-messaging-test');
const scopeB = createPsychologyPersistenceScope('professional-b', 'workspace-messaging-test');

function templateInput(body = 'Olá, [PROFISSIONAL]. Seu atendimento é em [DATA] às [HORÁRIO].'): Parameters<ReturnType<typeof createLocalMessageCenterRepository>['createTemplate']>[0] {
  return {
    displayName: 'Lembrete sintético', purpose: 'Lembrete administrativo', reminderType: 'EVE_OF_APPOINTMENT', modalityScope: 'ALL', body,
    semanticVariables: extractSemanticVariables(body), language: 'pt_BR', requestedCategory: 'UTILITY', localStatus: 'DRAFT', enabled: true,
    metaTemplateId: null, metaTemplateName: null, metaStatus: null,
  };
}

test('central local começa sem seed operacional e isola workspace, profissional e contexto', () => {
  const storage = createMemoryStorage();
  const repositoryA = createLocalMessageCenterRepository({ scope: scopeA, storage, now: () => '2026-08-17T12:00:00.000Z' });
  const repositoryB = createLocalMessageCenterRepository({ scope: scopeB, storage, now: () => '2026-08-17T12:00:00.000Z' });
  assert.deepEqual(createDefaultMessageCenterState({ ...scopeA, contextId: 'PSICOLOGIA' }).templates, []);
  repositoryA.createTemplate(templateInput());
  assert.equal(repositoryA.load().templates.length, 1);
  assert.equal(repositoryB.load().templates.length, 0);
  assert.match(Object.keys(storage.values).join('\n'), /psychology-r2f1:messaging:v1/);
});

test('rascunho pode ser criado, editado, duplicado, habilitado e excluído localmente', () => {
  const repository = createLocalMessageCenterRepository({ scope: scopeA, storage: createMemoryStorage(), now: () => '2026-08-17T12:00:00.000Z' });
  const created = repository.createTemplate(templateInput());
  const edited = repository.updateTemplate(created.id, { displayName: 'Lembrete editado', body: 'Texto [DATA]', semanticVariables: ['DATE'] });
  assert.equal(edited.displayName, 'Lembrete editado');
  const duplicate = repository.duplicateTemplate(created.id);
  assert.equal(duplicate.localStatus, 'DRAFT');
  assert.equal(duplicate.metaTemplateId, null);
  assert.equal(repository.setTemplateEnabled(created.id, false).enabled, false);
  repository.deleteTemplate(duplicate.id);
  assert.equal(repository.load().templates.length, 1);
});

test('variáveis permitidas são semânticas, sem conteúdo clínico ou ID técnico', () => {
  const body = '[PROFISSIONAL] · [DATA] · [HORÁRIO] · [TIPO_ATENDIMENTO] · [LOCAL] · [ENDEREÇO] · [MAPS] · [GERENCIAR_CONSULTA]';
  assert.deepEqual(extractSemanticVariables(body), ['PROFESSIONAL', 'DATE', 'TIME', 'APPOINTMENT_TYPE', 'LOCATION', 'ADDRESS', 'MAPS', 'MANAGE_APPOINTMENT']);
  const validation = validateMessageTemplate({ ...templateInput(body), displayName: 'Mensagem sintética' });
  assert.deepEqual(validation.errors, []);
  const clinical = validateMessageTemplate({ ...templateInput('Diagnóstico: [DIAGNOSTICO]'), displayName: 'Inválida' });
  assert.ok(clinical.errors.some(error => error.includes('clínicas')));
  assert.equal(clinical.semanticVariables.length, 0);
});

test('Online alerta localização e presencial resolve local, endereço e Maps apenas na prévia sintética', () => {
  const onlineTemplate = { ...templateInput('Atendimento online: [TIPO_ATENDIMENTO]. Local: [LOCAL] [ENDEREÇO] [MAPS]'), modalityScope: 'ONLINE' as const };
  const validation = validateMessageTemplate(onlineTemplate);
  assert.equal(validation.canMarkReady, false);
  assert.ok(validation.warnings.some(warning => warning.includes('localização')));
  const onlinePreview = renderMessagePreview(onlineTemplate, 'ONLINE');
  assert.ok(onlinePreview.warnings.length > 0);
  assert.doesNotMatch(onlinePreview.text, /Clínica Sintética|Avenida Sintética|maps\.example/);
  assert.doesNotMatch(onlinePreview.text, /Local:|Endereço:|Maps:/);
  const presencialTemplate = { ...onlineTemplate, modalityScope: 'PRESENCIAL' as const };
  const presencialPreview = renderMessagePreview(presencialTemplate, 'PRESENCIAL');
  assert.match(presencialPreview.text, /Clínica Sintética/);
  assert.match(presencialPreview.text, /Avenida Sintética/);
  assert.match(presencialPreview.text, /maps\.example\.test/);
  assert.doesNotMatch(presencialPreview.text, /managementToken|diagnóstico|financeiro/i);
});

test('regras suportam Véspera e No dia e sessão cancelada não é elegível', () => {
  const repository = createLocalMessageCenterRepository({ scope: scopeA, storage: createMemoryStorage(), now: () => '2026-08-17T12:00:00.000Z' });
  const template = repository.createTemplate(templateInput());
  const eve = repository.createRule({ templateId: template.id, reminderType: 'EVE_OF_APPOINTMENT', offsetDays: 1, sendTime: '09:00', modalityScope: 'ALL', enabled: true });
  const day = repository.createRule({ templateId: template.id, reminderType: 'DAY_OF_APPOINTMENT', offsetDays: 0, sendTime: '08:00', modalityScope: 'ALL', enabled: false });
  assert.equal(eve.offsetDays, 1);
  assert.equal(day.offsetDays, 0);
  assert.equal(repository.setRuleEnabled(day.id, true).enabled, true);
  assert.equal(isReminderEligibleForSession('cancelada'), false);
  assert.equal(isReminderEligibleForSession('CANCELLED'), false);
  assert.equal(isReminderEligibleForSession('agendada'), true);
});

test('provider Meta é fake/no-op, não chama Graph API e não carrega segredo no frontend', async () => {
  const provider = createNoopMessageTemplateProvider();
  assert.equal(await provider.connectionStatus(), 'NOT_CONNECTED');
  assert.deepEqual(await provider.listTemplates(), []);
  assert.deepEqual(provider.capabilities(), { canRead: false, canWrite: false, metaWriteEnabled: false });
  await assert.rejects(() => provider.createTemplate({} as never), /META_WRITE_DISABLED/);
  const source = await readFile(new URL('../src/features/psychology-messaging/provider.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|graph\.facebook|Authorization|client_secret/i);
});

test('A central de mensagens permanece coberta, mas fora da UI normal até o contrato externo estar pronto', async () => {
  const settingsSource = await readFile(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  const centerSource = await readFile(new URL('../src/features/psychology-messaging/PsychologyMessagingCenter.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(settingsSource, /id: 'messages', label: 'Mensagens e Lembretes'/);
  assert.doesNotMatch(settingsSource, /activeTab === 'messages'/);
  for (const label of ['Mensagens', 'Regras de Envio', 'Integração Meta']) assert.match(centerSource, new RegExp(label));
  assert.match(centerSource, /Enviar para análise da Meta/);
  assert.match(centerSource, /disabled/);
  assert.match(centerSource, /Não conectado/);
  assert.match(centerSource, /flex-wrap/);
});
