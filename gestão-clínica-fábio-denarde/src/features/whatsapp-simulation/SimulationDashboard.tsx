import { useState } from 'react';
import { createSimulationProvider } from './simulationProvider';
import { SimpleSimulationView } from './components/SimpleSimulationView';
import { SimulationShell } from './components/SimulationShell';
import { extractTemplateVariables, resolveTemplateContent, SIMULATION_TEMPLATE_VARIABLES } from './domain/templateValidation';
import { composeTemplateContent, createDefaultTemplatePresentation, createTemplatePresentation, renderTemplatePreview } from './domain/templatePresentation';
import {
  activateSimulationTemplate,
  createSimulationPreview,
  createSimulationTemplate,
  deactivateSimulationTemplate,
  duplicateSimulationTemplate,
  registerPreviewedSimulatedMessage,
  selectSimulationConversation,
  setSimulationComposition,
  setSimulationPreview,
  setSimulationTemplateDraft,
  setSimulationView,
  updateSimulationTemplate,
} from './state/simulationActions';
import {
  cancelSimulationSchedule,
  confirmSimulationSchedulePreview,
  createSimulationSchedulePreview,
  editSimulationSchedule,
  reprocessSimulationJob,
  setSimulationSchedulePreview,
} from './state/simulationScheduleActions';
import { getActiveTenantData, selectVisibleTemplates } from './state/simulationSelectors';
import { selectVisibleSimulationSchedules } from './state/simulationScheduleSelectors';
import { createInitialSimulationState } from './state/simulationStore';
import type { SimulationComposerState, SimulationMessageMetadata, SimulationState, SimulationTemplateDraft, SimulationView } from './simulationTypes';
import type { SimulationScheduleEdit } from './scheduleTypes';

// InboxView permanece preservado nos componentes antigos para a regressão R1/R2-A; a navegação simples não o exibe.

function errorNotice(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/Nome obrigatório/i.test(message)) return 'Informe o nome da mensagem.';
  if (/Categoria obrigatória/i.test(message)) return 'Selecione uma finalidade.';
  if (/Conteúdo obrigatório/i.test(message)) return 'Escreva o texto principal.';
  if (/Variáveis não permitidas|script|elemento executável|links executáveis|campos clínicos|telefone ou identificador real|Template|template|draft/i.test(message)) return 'Não foi possível concluir esta ação com a mensagem pronta.';
  return message || 'Ação não concluída nesta demonstração.';
}

function syntheticValues(state: SimulationState, conversationId: string): Record<string, string> {
  const tenant = state.tenants[state.activeTenantId];
  const conversation = tenant.conversations.find(item => item.id === conversationId);
  const professional = tenant.professionals.find(item => item.id === conversation?.assignedProfessionalId);
  return {
    contato_nome: conversation?.contact.displayName || 'Contato Fictício 001',
    profissional_nome: professional?.displayName || 'Profissional Simulado A',
    tenant_nome: tenant.tenant.label,
    data_ficticia: '2026-03-20',
    horario_ficticio: '14:30',
  };
}

function scheduleDate(value: string): string {
  return value;
}

export default function SimulationDashboard({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<SimulationState>(createInitialSimulationState);
  const [provider, setProvider] = useState(createSimulationProvider);
  const [connected, setConnected] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const activeTenantId = state.activeTenantId;
  const activeTenant = getActiveTenantData(state);
  const visibleTemplates = selectVisibleTemplates(state, activeTenantId);
  const visibleSchedules = selectVisibleSimulationSchedules(state, activeTenantId);
  const selectedConversation = activeTenant.conversations.find(item => item.id === state.selectedConversationId) || null;

  const apply = (action: (current: SimulationState) => SimulationState) => {
    setState(current => {
      try {
        return action(current);
      } catch (error) {
        return { ...current, notice: errorNotice(error) };
      }
    });
  };

  const onReset = () => {
    setState(createInitialSimulationState());
    setProvider(() => createSimulationProvider());
    setConnected(false);
    setViewKey(value => value + 1);
  };

  const onNavigate = (view: SimulationView) => apply(current => setSimulationView(current, view));

  const onSelectConversation = (conversationId: string) => apply(current => selectSimulationConversation(current, current.activeTenantId, conversationId));

  const onCompositionChange = (composition: SimulationComposerState) => apply(current => setSimulationComposition(current, composition));

  const onDraftChange = (value: string) => apply(current => setSimulationComposition(current, { ...current.composer, draft: value }));

  const onUseTemplate = (templateId: string) => apply(current => {
    const conversationId = current.selectedConversationId || current.tenants[current.activeTenantId].conversations[0]?.id || '';
    const selected = conversationId && current.selectedConversationId !== conversationId
      ? selectSimulationConversation(current, current.activeTenantId, conversationId)
      : current;
    const template = selected.tenants[selected.activeTenantId].templates.find(item => item.id === templateId);
    if (!template) throw new Error('Mensagem pronta fictícia não encontrada.');
    const body = resolveTemplateContent(template, syntheticValues(selected, conversationId));
    return setSimulationView(setSimulationComposition(selected, { mode: 'template', draft: body, quickReplyId: '', templateId }), 'new_message');
  });

  const ensureConversation = (current: SimulationState): SimulationState => {
    if (current.selectedConversationId) return current;
    const first = current.tenants[current.activeTenantId].conversations[0];
    return first ? selectSimulationConversation(current, current.activeTenantId, first.id) : current;
  };

  const messageMetadata = (current: SimulationState): SimulationMessageMetadata => current.composer.mode === 'template'
    ? { source: 'template', templateId: current.composer.templateId, templateVersion: current.tenants[current.activeTenantId].templates.find(item => item.id === current.composer.templateId)?.version }
    : { source: 'manual' };

  const onPreviewMessage = (when: 'now' | 'scheduled', scheduledAt?: string) => apply(current => {
    const next = ensureConversation(current);
    const metadata = messageMetadata(next);
    if (when === 'now') return setSimulationPreview(next, createSimulationPreview(next, next.activeTenantId, next.composer.draft, metadata));
    if (!scheduledAt) throw new Error('Escolha uma data e um horário.');
    const preview = createSimulationSchedulePreview(next, {
      tenantId: next.activeTenantId,
      conversationId: next.selectedConversationId,
      sourceType: metadata.source,
      sourceId: metadata.templateId,
      templateVersion: metadata.templateVersion,
      contentSnapshot: next.composer.draft,
      scheduledAt: scheduleDate(scheduledAt),
    });
    return setSimulationSchedulePreview(next, preview);
  });

  const onConfirmMessage = () => apply(current => registerPreviewedSimulatedMessage(current, provider, current.activeTenantId, false));
  const onConfirmSchedule = () => apply(current => confirmSimulationSchedulePreview(current));
  const onCancelPreview = () => apply(current => ({ ...current, preview: null, schedulePreview: null }));

  const onCancelSchedule = (scheduleId: string) => apply(current => cancelSimulationSchedule(current, current.activeTenantId, scheduleId));
  const onEditSchedule = (scheduleId: string, edit: SimulationScheduleEdit) => apply(current => editSimulationSchedule(current, current.activeTenantId, scheduleId, edit));
  const onRetrySchedule = (scheduleId: string) => apply(current => {
    const schedule = current.schedules.find(item => item.id === scheduleId && item.tenantId === current.activeTenantId);
    const job = schedule?.queueJobId ? current.queueJobs.find(item => item.id === schedule.queueJobId) : current.queueJobs.find(item => item.scheduleId === scheduleId && item.tenantId === current.activeTenantId);
    if (!job) throw new Error('Não foi possível tentar novamente esta mensagem.');
    return reprocessSimulationJob(current, current.activeTenantId, job.id);
  });

  const onBeginTemplate = (templateId = '') => apply(current => {
    const template = templateId ? current.tenants[current.activeTenantId].templates.find(item => item.id === templateId) : null;
    const draft: SimulationTemplateDraft = template
      ? { name: template.name, description: template.description, category: template.category, content: template.content, allowedVariables: [...template.allowedVariables], presentation: createTemplatePresentation(template.content) }
      : { name: '', description: '', category: 'atendimento', content: '', allowedVariables: [], presentation: createDefaultTemplatePresentation() };
    return setSimulationTemplateDraft(current, draft, templateId);
  });

  const onEditTemplate = (templateId: string) => apply(current => {
    const template = current.tenants[current.activeTenantId].templates.find(item => item.id === templateId);
    if (!template) throw new Error('Mensagem pronta fictícia não encontrada.');
    if (template.status === 'draft') return setSimulationTemplateDraft(current, { name: template.name, description: template.description, category: template.category, content: template.content, allowedVariables: [...template.allowedVariables], presentation: createTemplatePresentation(template.content) }, template.id);
    const duplicated = duplicateSimulationTemplate(current, current.activeTenantId, templateId);
    const copy = duplicated.tenants[current.activeTenantId].templates.find(item => item.sourceTemplateId === templateId && item.status === 'draft');
    if (!copy) throw new Error('Não foi possível preparar a edição desta mensagem.');
    return setSimulationTemplateDraft(duplicated, { name: copy.name, description: copy.description, category: copy.category, content: copy.content, allowedVariables: [...copy.allowedVariables], presentation: createTemplatePresentation(copy.content) }, copy.id);
  });

  const onTemplateDraftChange = (draft: SimulationTemplateDraft) => apply(current => {
    const content = draft.presentation ? composeTemplateContent(draft.presentation) : draft.content;
    const allowedVariables = extractTemplateVariables(content).filter(variable => SIMULATION_TEMPLATE_VARIABLES.includes(variable as SimulationTemplateDraft['allowedVariables'][number])) as SimulationTemplateDraft['allowedVariables'];
    return setSimulationTemplateDraft(current, { ...draft, content, allowedVariables }, current.templateEditingId);
  });
  const onSaveTemplate = () => apply(current => current.templateDraft ? current.templateEditingId ? updateSimulationTemplate(current, current.activeTenantId, current.templateEditingId, current.templateDraft) : createSimulationTemplate(current, current.activeTenantId, current.templateDraft) : current);
  const onCancelTemplate = () => apply(current => setSimulationTemplateDraft(current, null));
  const onActivateTemplate = (templateId: string) => apply(current => {
    const template = current.tenants[current.activeTenantId].templates.find(item => item.id === templateId);
    if (!template) throw new Error('Mensagem pronta fictícia não encontrada.');
    if (template.status === 'inactive') {
      const duplicated = duplicateSimulationTemplate(current, current.activeTenantId, templateId);
      const copy = duplicated.tenants[current.activeTenantId].templates.find(item => item.sourceTemplateId === templateId && item.status === 'draft');
      if (!copy) throw new Error('Não foi possível ativar esta mensagem pronta.');
      return activateSimulationTemplate(duplicated, current.activeTenantId, copy.id);
    }
    return activateSimulationTemplate(current, current.activeTenantId, templateId);
  });
  const onDeactivateTemplate = (templateId: string) => apply(current => deactivateSimulationTemplate(current, current.activeTenantId, templateId));

  return (
    <SimulationShell state={state} connected={connected} onReset={onReset} onConnect={() => setConnected(true)} onDisconnect={() => setConnected(false)} onNavigate={onNavigate} embedded={embedded}>
      <SimpleSimulationView
        state={state}
        tenant={activeTenant}
        conversations={activeTenant.conversations}
        templates={visibleTemplates}
        schedules={visibleSchedules}
        resolveTemplatePreview={renderTemplatePreview}
        connected={connected}
        resetVersion={viewKey}
        onNavigate={onNavigate}
        onSelectConversation={onSelectConversation}
        onCompositionChange={onCompositionChange}
        onDraftChange={onDraftChange}
        onUseTemplate={onUseTemplate}
        onPreviewMessage={onPreviewMessage}
        onConfirmMessage={onConfirmMessage}
        onConfirmSchedule={onConfirmSchedule}
        onCancelPreview={onCancelPreview}
        onCancelSchedule={onCancelSchedule}
        onEditSchedule={onEditSchedule}
        onRetrySchedule={onRetrySchedule}
        templateDraft={state.templateDraft}
        templateEditingId={state.templateEditingId}
        onBeginTemplate={onBeginTemplate}
        onEditTemplate={onEditTemplate}
        onTemplateDraftChange={onTemplateDraftChange}
        onSaveTemplate={onSaveTemplate}
        onCancelTemplate={onCancelTemplate}
        onActivateTemplate={onActivateTemplate}
        onDeactivateTemplate={onDeactivateTemplate}
      />
      {selectedConversation && state.activeView === 'new_message' && <span className="sr-only">Responsável selecionado: {selectedConversation.contact.displayName.replace(/fictício/gi, '').replace(/\s{2,}/g, ' ').trim()}</span>}
    </SimulationShell>
  );
}
