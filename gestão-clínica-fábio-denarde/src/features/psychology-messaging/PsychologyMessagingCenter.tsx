import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, Copy, Eye, MessageSquare, Pencil, Plus, Power, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { PsychologySettings } from '../psychology-pilot/psychologyR2a';
import { createPsychologyPersistenceScope } from '../psychology-persistence';
import { createMemoryStorage, type LocalStorageLike } from '../psychology-persistence/repositories/local';
import {
  MESSAGE_VARIABLE_LABELS,
  MESSAGE_VARIABLE_TOKENS,
  countMetaTemplateCategories,
  countMetaTemplateStatuses,
  extractSemanticVariables,
  messageModalityLabel,
  messageReminderTypeLabel,
  messageRuleOffsetDays,
  messageStatusLabel,
  renderMessagePreview,
  validateMessageTemplate,
  type MessageCenterState,
  type MessageModalityScope,
  type MessageReminderRule,
  type MessageReminderType,
  type MessageSemanticVariable,
  type MessageTemplateDraft,
} from './messagingDomain';
import { createRemoteMetaTemplateProvider, type MetaTemplateSnapshot } from './metaBffClient';
import { createLocalMessageCenterRepository, ensurePsychologyR2f3LocalState, type MessageCenterRepository } from './repository';
import { compileMetaTemplateDraft, invalidateTemplateApproval, prepareTemplateDraft } from './templatePreparation';

type MessagingPanel = 'messages' | 'rules' | 'meta';
type PreviewModality = 'ONLINE' | 'PRESENCIAL';
type MessageStatusFilter = 'ALL' | 'DRAFT' | 'READY_FOR_META';
type MessageReminderFilter = 'ALL' | MessageReminderType;
type MessageModalityFilter = 'ALL' | 'ONLINE' | 'PRESENCIAL';

const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-3.5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-violet-800 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-50';

export default function PsychologyMessagingCenter({ settings }: { settings: PsychologySettings }) {
  const scope = useMemo(() => createPsychologyPersistenceScope(settings.scope.professionalId), [settings.scope.professionalId]);
  const storage = useMemo<LocalStorageLike>(() => typeof window === 'undefined' ? createMemoryStorage() : window.localStorage, []);
  const repository = useMemo(() => createLocalMessageCenterRepository({ scope, storage }), [scope, storage]);
  const [state, setState] = useState<MessageCenterState>(() => repository.load());
  const [panel, setPanel] = useState<MessagingPanel>('messages');
  const [editing, setEditing] = useState<MessageTemplateDraft | null>(null);
  const [previewing, setPreviewing] = useState<MessageTemplateDraft | null>(null);
  const [notice, setNotice] = useState('');
  const metaProvider = useMemo(() => createRemoteMetaTemplateProvider(), []);
  const [metaSnapshot, setMetaSnapshot] = useState<MetaTemplateSnapshot | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState('');
  const metaRequestStarted = useRef(false);

  useEffect(() => {
    const seeded = ensurePsychologyR2f3LocalState({ repository, scope });
    setState(seeded);
    setEditing(null);
    setPreviewing(null);
  }, [repository, scope]);

  const refreshMeta = async () => {
    metaRequestStarted.current = true;
    setMetaLoading(true);
    setMetaError('');
    try {
      const snapshot = await metaProvider.readSnapshot();
      setMetaSnapshot(snapshot);
      setState(ensurePsychologyR2f3LocalState({ repository, scope, metaTemplates: snapshot.templates, metaCollisionChecks: snapshot.collisionChecks }));
    } catch (error) {
      setMetaError(error instanceof Error ? error.message : 'Não foi possível consultar a integração Meta agora.');
    } finally {
      setMetaLoading(false);
    }
  };

  useEffect(() => {
    if (!metaRequestStarted.current) void refreshMeta();
  }, [metaProvider, repository, scope]);

  const commit = (next: MessageCenterState, message?: string) => {
    repository.save(next);
    setState(repository.load());
    if (message) setNotice(message);
  };
  const refreshFromRepository = () => setState(repository.load());
  const saveTemplate = (draft: MessageTemplateDraft, ready: boolean) => {
    const validation = validateMessageTemplate(draft);
    if (validation.errors.length || (ready && !validation.canMarkReady)) {
      setNotice(validation.errors[0] || validation.warnings[0] || 'Revise a mensagem antes de marcar como pronta.');
      return;
    }
    const previous = state.templates.find(item => item.id === draft.id);
    const preparationOptions = { existingMetaTemplates: metaSnapshot?.templates, collisionChecks: metaSnapshot?.collisionChecks, metaLookupComplete: Boolean(metaSnapshot), existingLocalDrafts: state.templates };
    let normalized = prepareTemplateDraft({ ...draft, semanticVariables: validation.semanticVariables, draftVersion: draft.draftVersion || previous?.draftVersion || 1, updatedAt: new Date().toISOString() }, preparationOptions);
    const contentChanged = Boolean(previous && previous.contentHash && normalized.contentHash !== previous.contentHash);
    if (contentChanged) {
      normalized = prepareTemplateDraft(invalidateTemplateApproval({ ...draft, semanticVariables: validation.semanticVariables, updatedAt: new Date().toISOString() }, (previous?.draftVersion || 1) + 1), preparationOptions);
      normalized = { ...normalized, localStatus: ready ? 'READY_FOR_META' : 'DRAFT', localContentApproval: ready ? 'CONTENT_APPROVED_LOCALLY' : 'NOT_APPROVED' };
    }
    if (ready && normalized.preflightStatus === 'BLOCKED') {
      setNotice(normalized.preflightBlockers?.[0] || 'O preflight ainda está bloqueado.');
      return;
    }
    if (state.templates.some(item => item.id === draft.id)) repository.updateTemplate(draft.id, normalized);
    else repository.createTemplate(normalized);
    refreshFromRepository();
    setEditing(null);
    setNotice(ready || normalized.localContentApproval === 'CONTENT_APPROVED_LOCALLY' ? 'Conteúdo aprovado localmente; nenhuma submissão foi feita à Meta.' : 'Rascunho salvo neste navegador.');
  };
  const deleteTemplate = (template: MessageTemplateDraft) => {
    try { repository.deleteTemplate(template.id); refreshFromRepository(); setNotice('Rascunho local excluído neste navegador.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível excluir o rascunho.'); }
  };
  const openPanel = (nextPanel: MessagingPanel) => { setPanel(nextPanel); setEditing(null); setPreviewing(null); };
  const activeRules = state.rules.filter(rule => rule.enabled).length;
  const readyTemplates = state.templates.filter(template => template.localStatus === 'READY_FOR_META' && template.preflightStatus === 'READY').length; const submissionReadyTemplates = state.templates.filter(template => template.submissionState === 'SUBMISSION_READY' && template.publicRouteStatus === 'READY').length; const readyDetail = submissionReadyTemplates > 0 ? String(submissionReadyTemplates) + ' prontas para Meta' : String(readyTemplates) + ' validação concluída';
  const metaSummary = metaSnapshot ? 'Conectado' : metaError ? 'Falha de conexão' : 'Não conectado';
  const metaSummaryDetail = metaSnapshot ? 'leitura server-side' : metaError ? 'Tentar novamente' : 'aguardando leitura';

  return <div className="w-full space-y-4" data-testid="psychology-messaging-center">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · Psicologia</p><h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Mensagens e Lembretes</h2><p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">Configure os lembretes e acompanhe a integração com o WhatsApp.</p></div><div className="grid w-full gap-2 sm:mt-0 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:justify-end" data-testid="psychology-messaging-summary"><SummaryMetric label="Mensagens" value={String(state.templates.length)} detail={`${readyTemplates} prontas para Meta`} /><SummaryMetric label="Regras ativas" value={String(activeRules)} detail="somente local" /><SummaryMetric label="Meta" value={metaSummary} detail={metaSummaryDetail} tone="neutral" /></div></div></section>
    <nav className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-sm" role="tablist" aria-label="Áreas de Mensagens e Lembretes" data-testid="psychology-messaging-tabs"><MessagingTab id="messages" active={panel === 'messages'} onClick={() => openPanel('messages')}>Mensagens</MessagingTab><MessagingTab id="rules" active={panel === 'rules'} onClick={() => openPanel('rules')}>Regras de Envio</MessagingTab><MessagingTab id="meta" active={panel === 'meta'} onClick={() => openPanel('meta')}>Integração Meta</MessagingTab></nav>
    {notice && <div role="status" className="flex w-full items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><span>{notice}</span><button type="button" aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {panel === 'messages' && <MessagesPanel state={state} editing={editing} previewing={previewing} onStartNew={() => setEditing(createNewTemplate(scope.workspaceId, scope.contextId, scope.professionalId))} onEdit={setEditing} onPreview={setPreviewing} onCloseEditor={() => setEditing(null)} onClosePreview={() => setPreviewing(null)} onSave={saveTemplate} onDuplicate={template => { repository.duplicateTemplate(template.id); refreshFromRepository(); setNotice('Rascunho duplicado neste navegador.'); }} onToggle={template => { repository.setTemplateEnabled(template.id, !template.enabled); refreshFromRepository(); setNotice(template.enabled ? 'Mensagem desativada localmente.' : 'Mensagem ativada localmente.'); }} onDelete={deleteTemplate} />}
    {panel === 'rules' && <RulesPanel state={state} repository={repository} onChange={commit} />}
    {panel === 'meta' && <MetaIntegrationPanel snapshot={metaSnapshot} loading={metaLoading} error={metaError} onRetry={refreshMeta} />}
  </div>;
}

function SummaryMetric({ label, value, detail, tone = 'violet' }: { label: string; value: string; detail: string; tone?: 'violet' | 'neutral' }) {
  return <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-center ${tone === 'violet' ? 'border-violet-100 bg-violet-50/70' : 'border-slate-200 bg-slate-50'}`}><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-0.5 text-sm font-black text-slate-900">{value}</p><p className="mt-0.5 text-[10px] font-bold text-slate-500">{detail}</p></div>;
}

function MessagingTab({ id, active, onClick, children }: { id: MessagingPanel; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} data-testid={`psychology-messaging-tab-${id}`} onClick={onClick} className={`min-h-11 min-w-0 rounded-xl border px-2 py-2.5 text-center text-[11px] font-black leading-tight transition focus:outline-none focus:ring-2 focus:ring-violet-300 sm:px-3 sm:text-sm ${active ? 'border-violet-400 bg-violet-50 text-violet-900 ring-1 ring-violet-100' : 'border-transparent text-slate-600 hover:border-violet-200 hover:bg-white hover:text-violet-800'}`}>{children}</button>;
}

function MessagesPanel({ state, editing, previewing, onStartNew, onEdit, onPreview, onCloseEditor, onClosePreview, onSave, onDuplicate, onToggle, onDelete }: {
  state: MessageCenterState; editing: MessageTemplateDraft | null; previewing: MessageTemplateDraft | null; onStartNew: () => void; onEdit: (template: MessageTemplateDraft) => void; onPreview: (template: MessageTemplateDraft) => void; onCloseEditor: () => void; onClosePreview: () => void; onSave: (template: MessageTemplateDraft, ready: boolean) => void; onDuplicate: (template: MessageTemplateDraft) => void; onToggle: (template: MessageTemplateDraft) => void; onDelete: (template: MessageTemplateDraft) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<MessageStatusFilter>('ALL');
  const [reminder, setReminder] = useState<MessageReminderFilter>('ALL');
  const [modality, setModality] = useState<MessageModalityFilter>('ALL');
  const filtered = useMemo(() => state.templates.filter(template => {
    const matchesQuery = !query.trim() || template.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const matchesStatus = status === 'ALL' || template.localStatus === status;
    const matchesReminder = reminder === 'ALL' || template.reminderType === reminder;
    const matchesModality = modality === 'ALL' || template.modalityScope === 'ALL' || template.modalityScope === modality;
    return matchesQuery && matchesStatus && matchesReminder && matchesModality;
  }), [modality, query, reminder, state.templates, status]);
  const hasFilters = Boolean(query || status !== 'ALL' || reminder !== 'ALL' || modality !== 'ALL');
  return <section className="w-full space-y-4" data-testid="psychology-messaging-panel-messages">
    {!editing && <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black tracking-[0.14em] text-slate-500">Mensagens</p><h3 className="mt-1 text-lg font-black text-slate-900">Rascunhos locais</h3></div><button type="button" className={primaryButton} onClick={onStartNew}><Plus size={15} /> Nova mensagem</button></div>}
    {!editing && <MessageFilters query={query} status={status} reminder={reminder} modality={modality} hasFilters={hasFilters} onQuery={setQuery} onStatus={setStatus} onReminder={setReminder} onModality={setModality} onClear={() => { setQuery(''); setStatus('ALL'); setReminder('ALL'); setModality('ALL'); }} />}
    {editing && <MessageEditor initial={editing} onClose={onCloseEditor} onSave={onSave} />}
    {!editing && state.templates.length === 0 && <EmptyPanel icon={<MessageSquare size={22} />} title="Nenhuma mensagem local" description="Crie um rascunho para configurar um lembrete. Nenhuma mensagem operacional foi pré-carregada." />}
    {!editing && state.templates.length > 0 && filtered.length === 0 && <EmptyPanel icon={<Search size={22} />} title="Nenhum resultado" description="Ajuste ou limpe os filtros para encontrar uma mensagem local." />}
    {!editing && filtered.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{filtered.map(template => <MessageCard key={template.id} template={template} onEdit={() => onEdit(template)} onPreview={() => onPreview(template)} onDuplicate={() => onDuplicate(template)} onToggle={() => onToggle(template)} onDelete={() => onDelete(template)} />)}</div>}
    {!editing && previewing && <MessagePreviewCard template={previewing} onClose={onClosePreview} />}
  </section>;
}

function MessageFilters({ query, status, reminder, modality, hasFilters, onQuery, onStatus, onReminder, onModality, onClear }: { query: string; status: MessageStatusFilter; reminder: MessageReminderFilter; modality: MessageModalityFilter; hasFilters: boolean; onQuery: (value: string) => void; onStatus: (value: MessageStatusFilter) => void; onReminder: (value: MessageReminderFilter) => void; onModality: (value: MessageModalityFilter) => void; onClear: () => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-testid="psychology-message-filters"><div className="grid gap-2 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto] md:items-end"><label className="text-xs font-bold text-slate-600">Buscar por nome<div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input aria-label="Buscar mensagens" value={query} onChange={event => onQuery(event.target.value)} className={`${inputClass} pl-9`} placeholder="Buscar mensagem" /></div></label><FilterSelect label="Status" value={status} onChange={value => onStatus(value as MessageStatusFilter)} options={[['ALL', 'Todos os status'], ['DRAFT', 'Rascunhos'], ['READY_FOR_META', 'Prontas para Meta']]} /><FilterSelect label="Momento" value={reminder} onChange={value => onReminder(value as MessageReminderFilter)} options={[['ALL', 'Todos os momentos'], ['EVE_OF_APPOINTMENT', 'Véspera'], ['DAY_OF_APPOINTMENT', 'No dia'], ['CUSTOM', 'Personalizado']]} /><FilterSelect label="Modalidade" value={modality} onChange={value => onModality(value as MessageModalityFilter)} options={[['ALL', 'Todas'], ['ONLINE', 'Online'], ['PRESENCIAL', 'Presencial']]} />{hasFilters && <button type="button" className={`${secondaryButton} h-11`} onClick={onClear}>Limpar</button>}</div></section>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="text-xs font-bold text-slate-600">{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className={inputClass}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}

function MessageCard({ template, onEdit, onPreview, onDuplicate, onToggle, onDelete }: { key?: React.Key; template: MessageTemplateDraft; onEdit: () => void; onPreview: () => void; onDuplicate: () => void; onToggle: () => void; onDelete: () => void }) {
  const preflightStatus = template.preflightStatus || 'READY';
  const submissionReady = template.submissionState === 'SUBMISSION_READY' && template.publicRouteStatus === 'READY';
  const badgeLabel = submissionReady ? messageStatusLabel(template.localStatus) : template.publicRouteStatus === 'DEPLOYMENT_PENDING' ? 'AGUARDANDO PUBLICAÇÃO' : 'VALIDAÇÃO CONCLUÍDA';
  const badgeClass = submissionReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800';
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200" data-testid="psychology-message-card"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-base font-black text-slate-900">{template.displayName || 'Mensagem sem nome'}</h4><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{messageReminderTypeLabel(template.reminderType)}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{messageModalityLabel(template.modalityScope)}</span></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${badgeClass}`}>{badgeLabel}</span></div><div className="mt-3 grid gap-1 text-[11px] font-bold text-slate-500 sm:grid-cols-2 lg:grid-cols-4"><span>Modalidade: {messageModalityLabel(template.modalityScope)}</span><span>Versão: v{template.draftVersion || 1}</span><span className={preflightStatus === 'READY' ? 'text-emerald-700' : 'text-amber-700'}>Validação: {preflightStatus}</span><span className={template.publicRouteStatus === 'READY' ? 'text-emerald-700' : 'text-amber-700'}>Rota pública: {template.publicRouteStatus || 'DEPLOYMENT_PENDING'}</span></div><p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{template.body || 'Sem texto ainda.'}</p><div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" className={secondaryButton} onClick={onEdit}><Pencil size={14} /> Editar</button><button type="button" className={secondaryButton} onClick={onPreview}><Eye size={14} /> Visualizar</button><details className="relative"><summary className={`${secondaryButton} cursor-pointer list-none`}><ChevronDown size={14} /> Mais ações</summary><div className="absolute right-0 z-10 mt-1 min-w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"><button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-black text-slate-700 hover:bg-slate-50" onClick={onDuplicate}><Copy size={14} /> Duplicar</button><button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-black text-slate-700 hover:bg-slate-50" onClick={onToggle}><Power size={14} /> {template.enabled ? 'Desativar' : 'Ativar'}</button>{!template.metaTemplateId && template.localStatus === 'DRAFT' && <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-black text-rose-700 hover:bg-rose-50" onClick={onDelete}><Trash2 size={14} /> Excluir rascunho</button>}</div></details></div><p className="mt-3 text-[11px] font-bold text-slate-400">{template.enabled ? 'Ativada' : 'Desativada'} · origem local · {template.submissionState || 'BLOCKED'}</p></article>;
}

function MessageEditor({ initial, onClose, onSave }: { initial: MessageTemplateDraft; onClose: () => void; onSave: (template: MessageTemplateDraft, ready: boolean) => void }) {
  const [draft, setDraft] = useState(initial);
  const [previewModality, setPreviewModality] = useState<PreviewModality>(initial.modalityScope === 'PRESENCIAL' ? 'PRESENCIAL' : 'ONLINE');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const lastInsertionRef = useRef<{ token: string; at: number } | null>(null);
  const validation = validateMessageTemplate(draft);
  const issueCount = validation.errors.length + validation.warnings.length;
  const livePreview = renderMessagePreview(draft, previewModality);
  const technicalPreview = draft.technicalName ? compileMetaTemplateDraft(draft) : null;
  const insertVariable = (variable: MessageSemanticVariable) => {
    const token = MESSAGE_VARIABLE_TOKENS[variable]; const now = Date.now();
    if (lastInsertionRef.current?.token === token && now - lastInsertionRef.current.at < 250) return;
    lastInsertionRef.current = { token, at: now };
    const textarea = textareaRef.current; const start = textarea?.selectionStart ?? draft.body.length; const end = textarea?.selectionEnd ?? draft.body.length;
    const body = `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`;
    setDraft({ ...draft, body, semanticVariables: extractSemanticVariables(body) });
    globalThis.setTimeout(() => { textarea?.focus(); const cursor = start + token.length; textarea?.setSelectionRange(cursor, cursor); }, 0);
  };
  return <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm" data-testid="psychology-message-editor"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Editor local</p><h3 className="mt-1 text-lg font-black">{initial.id.startsWith('message-new') ? 'Nova mensagem' : 'Editar mensagem'}</h3><p className="mt-1 text-xs font-semibold text-slate-500">A prévia acompanha o texto e a modalidade escolhida.</p></div><button type="button" className={secondaryButton} onClick={onClose}><X size={15} /> Cancelar</button></div><div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-start"><div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Nome da mensagem<input aria-label="Nome da mensagem" value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} className={inputClass} placeholder="Ex.: Lembrete de véspera" /></label><label className="text-xs font-bold text-slate-600">Finalidade<input aria-label="Finalidade da mensagem" value={draft.purpose} onChange={event => setDraft({ ...draft, purpose: event.target.value })} className={inputClass} placeholder="Lembrete administrativo" /></label><label className="text-xs font-bold text-slate-600">Tipo de lembrete<select aria-label="Tipo de lembrete" value={draft.reminderType} onChange={event => setDraft({ ...draft, reminderType: event.target.value as MessageReminderType })} className={inputClass}><option value="EVE_OF_APPOINTMENT">Véspera</option><option value="DAY_OF_APPOINTMENT">No dia</option><option value="CUSTOM">Personalizado</option></select></label><label className="text-xs font-bold text-slate-600">Modalidade aplicável<select aria-label="Modalidade aplicável" value={draft.modalityScope} onChange={event => { const modalityScope = event.target.value as MessageModalityScope; setDraft({ ...draft, modalityScope }); setPreviewModality(modalityScope === 'PRESENCIAL' ? 'PRESENCIAL' : 'ONLINE'); }} className={inputClass}><option value="ALL">Online e presencial</option><option value="ONLINE">Somente online</option><option value="PRESENCIAL">Somente presencial</option></select></label></div><label className="block text-xs font-bold text-slate-600">Texto normal<textarea ref={textareaRef} aria-label="Texto da mensagem" value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value, semanticVariables: extractSemanticVariables(event.target.value) })} className={`${inputClass} min-h-36 resize-y`} placeholder="Olá! Este é um lembrete administrativo sobre seu atendimento." /></label><VariableGroups onInsert={insertVariable} /><ValidationNotice validation={validation} issueCount={issueCount} /></div><div ref={previewRef} className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4" data-testid="psychology-message-live-preview"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">Prévia ao vivo</p><h4 className="mt-1 text-base font-black text-sky-950">Mensagem sintética</h4></div><div className="flex gap-1"><button type="button" className={`${previewModality === 'ONLINE' ? primaryButton : secondaryButton} !px-2.5 !py-1.5`} onClick={() => setPreviewModality('ONLINE')}>Online</button><button type="button" className={`${previewModality === 'PRESENCIAL' ? primaryButton : secondaryButton} !px-2.5 !py-1.5`} onClick={() => setPreviewModality('PRESENCIAL')}>Presencial</button></div></div>{livePreview.warnings.length > 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{livePreview.warnings.join(' ')}</p>}<div className="mt-4 rounded-2xl rounded-tl-sm bg-white p-4 text-sm font-semibold leading-6 text-slate-700 shadow-sm"><p className="whitespace-pre-line">{livePreview.text || 'Sem conteúdo para visualizar.'}</p></div><div className="mt-3 flex flex-wrap gap-2">{livePreview.actions.map(action => <button key={action.label} type="button" disabled={!action.enabled} title={action.reason} className={action.enabled ? primaryButton : secondaryButton}>{action.label}</button>)}</div><p className="mt-3 text-[11px] font-bold text-slate-500">Exemplo local · nenhum dado real é consultado.</p></div></div>{technicalPreview && <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-black text-slate-700">Ver detalhes técnicos</summary><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="font-bold text-slate-500">Nome técnico</dt><dd className="font-black text-slate-800">{technicalPreview.technicalName}</dd></div><div><dt className="font-bold text-slate-500">Versão / hash</dt><dd className="break-all font-black text-slate-800">v{draft.draftVersion || 1} · {technicalPreview.contentHash}</dd></div><div><dt className="font-bold text-slate-500">Preflight</dt><dd className="font-black text-slate-800">{draft.preflightStatus || 'UNVERIFIED'}</dd></div><div><dt className="font-bold text-slate-500">Payload dry-run</dt><dd className="font-black text-slate-800">{technicalPreview.payload.components.length} componentes; sem POST</dd></div></dl><pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-slate-100">{JSON.stringify(technicalPreview.payload, null, 2)}</pre></details>}<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><button type="button" className={primaryButton} onClick={() => onSave(draft, false)}>Salvar rascunho</button><button type="button" className={secondaryButton} onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}><Eye size={14} /> Visualizar</button><button type="button" className={secondaryButton} disabled={!validation.canMarkReady} onClick={() => onSave(draft, true)}>Marcar como pronta para Meta</button><span className={`ml-auto text-xs font-black ${issueCount ? 'text-amber-700' : 'text-emerald-700'}`}>{issueCount ? `Revise ${issueCount} ${issueCount === 1 ? 'item' : 'itens'}` : 'Pronta para configurar'}</span></div></section>;
}

function VariableGroups({ onInsert }: { onInsert: (variable: MessageSemanticVariable) => void }) {
  const groups: Array<[string, MessageSemanticVariable[]]> = [['Dados do atendimento', ['PROFESSIONAL', 'DATE', 'TIME', 'APPOINTMENT_TYPE']], ['Local presencial', ['LOCATION', 'ADDRESS', 'MAPS']], ['Gerenciamento', ['MANAGE_APPOINTMENT']]];
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Variáveis semânticas</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{groups.map(([label, variables]) => <div key={label}><p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{variables.map(variable => <button key={variable} type="button" data-testid={`psychology-message-variable-${variable.toLowerCase()}`} className="rounded-full border border-violet-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-violet-700 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-200" onClick={() => onInsert(variable)}>{MESSAGE_VARIABLE_TOKENS[variable]}</button>)}</div></div>)}</div><p className="mt-3 text-[11px] font-semibold text-slate-500">Somente dados administrativos seguros. Variáveis clínicas, financeiras e IDs internos não estão disponíveis.</p></section>;
}

function ValidationNotice({ validation, issueCount }: { validation: ReturnType<typeof validateMessageTemplate>; issueCount: number }) {
  if (!issueCount) return <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><CheckCircle2 size={16} /> Pronta para configurar localmente</div>;
  return <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800" role="alert"><p className="font-black">Revise {issueCount} {issueCount === 1 ? 'item' : 'itens'} antes de marcar como pronta.</p>{[...validation.errors, ...validation.warnings].map(item => <p key={item} className="mt-1">{item}</p>)}</div>;
}

function MessagePreviewCard({ template, onClose }: { template: MessageTemplateDraft; onClose: () => void }) {
  const [modality, setModality] = useState<PreviewModality>(template.modalityScope === 'PRESENCIAL' ? 'PRESENCIAL' : 'ONLINE');
  const preview = renderMessagePreview(template, modality);
  return <section className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4 shadow-sm" data-testid="psychology-message-preview"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">Prévia</p><h3 className="mt-1 text-lg font-black text-sky-950">{template.displayName || 'Mensagem'}</h3><p className="mt-1 text-xs font-semibold text-sky-800">Exemplo local; nenhum paciente ou atendimento real é consultado.</p></div><button type="button" className={secondaryButton} onClick={onClose}><X size={15} /> Fechar</button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-black text-slate-600">Prévia para:</span><button type="button" className={`${modality === 'ONLINE' ? primaryButton : secondaryButton} !py-1.5`} onClick={() => setModality('ONLINE')}>Online</button><button type="button" className={`${modality === 'PRESENCIAL' ? primaryButton : secondaryButton} !py-1.5`} onClick={() => setModality('PRESENCIAL')}>Presencial</button></div>{preview.warnings.length > 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{preview.warnings.join(' ')}</p>}<div className="mt-3 max-w-2xl rounded-2xl rounded-tl-sm bg-white p-4 text-sm font-semibold leading-6 text-slate-700 shadow-sm"><p className="whitespace-pre-line">{preview.text || 'Sem conteúdo para visualizar.'}</p></div><div className="mt-3 flex flex-wrap gap-2">{preview.actions.map(action => <button key={action.label} type="button" disabled={!action.enabled} title={action.reason} className={action.enabled ? primaryButton : secondaryButton}>{action.label}</button>)}</div>{preview.actions.some(action => !action.enabled) && <p className="mt-2 text-[11px] font-bold text-amber-700">O botão Maps está explicitamente bloqueado no dry-run por incompatibilidade de URL dinâmica; nenhum link bruto foi inserido.</p>}</section>;
}

function RulesPanel({ state, repository, onChange }: { state: MessageCenterState; repository: MessageCenterRepository; onChange: (next: MessageCenterState, message?: string) => void }) {
  const [editing, setEditing] = useState<MessageReminderRule | null>(null);
  const start = () => { const template = state.templates[0]; if (!template) return; const timestamp = new Date().toISOString(); setEditing({ id: `rule-new-${Date.now()}`, workspaceId: template.workspaceId, contextId: template.contextId, professionalId: template.professionalId, templateId: template.id, reminderType: 'EVE_OF_APPOINTMENT', offsetDays: 1, sendTime: '', scheduleStatus: 'PENDING_USER_TIME', modalityScope: 'ALL', enabled: false, createdAt: timestamp, updatedAt: timestamp }); };
  const save = () => { if (!editing) return; if (editing.id.startsWith('rule-new')) repository.createRule(editing); else repository.updateRule(editing.id, editing); onChange(repository.load(), 'Regra de envio salva localmente.'); setEditing(null); };
  return <section className="w-full space-y-4" data-testid="psychology-messaging-panel-rules"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black tracking-[0.14em] text-slate-500">Regras de Envio</p><h3 className="mt-1 text-lg font-black">Lembretes administrativos</h3><p className="mt-1 text-sm font-semibold text-slate-500">Véspera e no dia ficam preparados localmente; não há scheduler, cron ou disparo.</p></div><button type="button" className={primaryButton} onClick={start} disabled={state.templates.length === 0}><Plus size={15} /> Nova regra</button></div>{state.templates.length === 0 && <EmptyPanel icon={<Clock3 size={22} />} title="Crie uma mensagem antes da regra" description="A regra sempre aponta para uma mensagem local e para a Agenda como fonte futura." />}{editing && <RuleEditor rule={editing} templates={state.templates} onChange={setEditing} onClose={() => setEditing(null)} onSave={save} />}{state.rules.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{state.rules.map(rule => { const template = state.templates.find(item => item.id === rule.templateId); const timeLabel = rule.scheduleStatus === 'PENDING_USER_TIME' || !rule.sendTime ? 'Horário pendente' : rule.sendTime; return <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h4 className="font-black">{template?.displayName || 'Mensagem não encontrada'}</h4><p className="mt-1 text-xs font-bold text-slate-500">{messageReminderTypeLabel(rule.reminderType)} · {timeLabel} · {messageModalityLabel(rule.modalityScope)}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${rule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{rule.enabled ? 'Ativa' : 'Inativa'}</span></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => setEditing(rule)}><Pencil size={14} /> Editar regra</button><button type="button" className={secondaryButton} onClick={() => { repository.setRuleEnabled(rule.id, !rule.enabled); onChange(repository.load(), rule.enabled ? 'Regra desativada localmente.' : 'Regra ativada localmente.'); }}><Power size={14} /> {rule.enabled ? 'Desativar' : 'Ativar'}</button></div>{rule.enabled && <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] font-bold text-amber-800">Meta não conectada: esta regra está apenas preparada localmente.</p>}<p className="mt-3 text-[11px] font-bold text-slate-400">{rule.offsetDays === 1 ? '1 dia antes' : rule.offsetDays === 0 ? 'No dia' : `${rule.offsetDays} dias antes`} · sessão cancelada não é elegível.</p><p className="mt-1 text-[11px] font-bold text-slate-400">Janela civil America/Sao_Paulo · atraso fora da janela: SKIPPED_OUTSIDE_WINDOW.</p></article>; })}</div>}</section>;
}

function RuleEditor({ rule, templates, onChange, onClose, onSave }: { rule: MessageReminderRule; templates: MessageTemplateDraft[]; onChange: (rule: MessageReminderRule) => void; onClose: () => void; onSave: () => void }) {
  return <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm" data-testid="psychology-message-rule-editor"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Regra local</p><h3 className="mt-1 text-base font-black">Configurar lembrete</h3></div><button type="button" className={secondaryButton} onClick={onClose}><X size={15} /> Fechar</button></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Mensagem<select aria-label="Mensagem da regra" value={rule.templateId} onChange={event => onChange({ ...rule, templateId: event.target.value })} className={inputClass}>{templates.map(template => <option key={template.id} value={template.id}>{template.displayName || 'Mensagem sem nome'}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Momento<select aria-label="Momento do lembrete" value={rule.reminderType} onChange={event => { const reminderType = event.target.value as MessageReminderType; onChange({ ...rule, reminderType, offsetDays: messageRuleOffsetDays(reminderType) }); }} className={inputClass}><option value="EVE_OF_APPOINTMENT">Véspera do atendimento</option><option value="DAY_OF_APPOINTMENT">No dia do atendimento</option><option value="CUSTOM">Personalizado</option></select></label><label className="text-xs font-bold text-slate-600">Horário administrativo<input aria-label="Horário administrativo" type="time" value={rule.sendTime} onChange={event => onChange({ ...rule, sendTime: event.target.value })} className={inputClass} /></label><label className="text-xs font-bold text-slate-600">Modalidade aplicável<select aria-label="Modalidade da regra" value={rule.modalityScope} onChange={event => onChange({ ...rule, modalityScope: event.target.value as MessageModalityScope })} className={inputClass}><option value="ALL">Online e presencial</option><option value="ONLINE">Somente online</option><option value="PRESENCIAL">Somente presencial</option></select></label></div><label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={rule.enabled} onChange={event => onChange({ ...rule, enabled: event.target.checked })} /> Regra habilitada localmente</label><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primaryButton} onClick={onSave}>Salvar regra</button><button type="button" className={secondaryButton} onClick={onClose}>Cancelar</button></div></section>;
}

function MetaIntegrationPanel({ snapshot, loading, error, onRetry }: { snapshot: MetaTemplateSnapshot | null; loading: boolean; error: string; onRetry: () => void }) {
  return <section className="w-full space-y-4" data-testid="psychology-messaging-panel-meta"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Integração Meta</p><h3 className="mt-1 text-lg font-black">Conexão institucional</h3><p className="mt-1 text-sm font-semibold text-slate-500">Leitura server-side; operações de escrita permanecem bloqueadas.</p></div>{error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800" role="alert"><span>Falha de conexão: {error}</span><button type="button" className={secondaryButton} onClick={onRetry} disabled={loading}>Tentar novamente</button></div>}<div className="grid gap-4 lg:grid-cols-3"><MetaConnectionBlock snapshot={snapshot} loading={loading} onRetry={onRetry} /><MetaTemplatesBlock snapshot={snapshot} loading={loading} /><MetaSecurityBlock snapshot={snapshot} /></div></section>;
}

function MetaConnectionBlock({ snapshot, loading, onRetry }: { snapshot: MetaTemplateSnapshot | null; loading: boolean; onRetry: () => void }) {
  const connected = snapshot?.connectionStatus === 'CONNECTED';
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="psychology-meta-connection"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Conexão</p><h4 className="mt-1 text-lg font-black text-slate-900">{connected ? 'Conectado' : loading ? 'Consultando…' : 'Falha de conexão'}</h4></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{connected ? 'Somente leitura' : 'Indisponível'}</span></div><dl className="mt-4 space-y-2 text-sm"><SafeMetaRow label="Remetente" value="Institucional compartilhado" /><SafeMetaRow label="Can read" value={connected ? 'YES' : '—'} /><SafeMetaRow label="Can write" value="NO" /><SafeMetaRow label="Última sincronização" value={snapshot ? formatMetaSync(snapshot.lastSyncAt) : '—'} /></dl><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={onRetry} disabled={loading}>{loading ? 'Verificando…' : 'Verificar conexão'}</button><button type="button" className={secondaryButton} onClick={onRetry} disabled={loading}>{loading ? 'Sincronizando…' : 'Sincronizar templates'}</button></div></section>;
}

function MetaTemplatesBlock({ snapshot, loading }: { snapshot: MetaTemplateSnapshot | null; loading: boolean }) {
  const templates = snapshot?.templates || [];
  const statusCounts = countMetaTemplateStatuses(templates);
  const categoryCounts = countMetaTemplateCategories(templates);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2" data-testid="psychology-meta-templates"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Templates Meta da Psicologia</p><h4 className="mt-1 text-lg font-black text-slate-900">{loading && !snapshot ? 'Carregando leitura…' : `${templates.length} templates contextuais`}</h4><p className="mt-2 text-sm font-semibold text-slate-500">Somente vínculos explícitos de Psicologia; o inventário institucional não é enviado ao browser.</p>{snapshot && <p className="mt-1 text-xs font-bold text-slate-400">Inventário institucional consultado: {snapshot.institutionalTemplateCount ?? '—'} · visíveis neste contexto: {templates.length}</p>}</div>{snapshot && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">Atualizado</span>}</div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"><SafeMetaCounter label="Total" value={templates.length} /><SafeMetaCounter label="Aprovados" value={statusCounts.approved} /><SafeMetaCounter label="Em análise" value={statusCounts.pending} /><SafeMetaCounter label="Rejeitados" value={statusCounts.rejected} /><SafeMetaCounter label="Utility" value={categoryCounts.utility} /><SafeMetaCounter label="Marketing" value={categoryCounts.marketing} /></div>{snapshot && templates.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[36rem] w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Idioma</th><th className="px-3 py-2">Categoria</th><th className="px-3 py-2">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{templates.map(template => <tr key={`${template.id}:${template.language}`}><td className="max-w-[16rem] truncate px-3 py-2 font-bold text-slate-800">{template.name}</td><td className="px-3 py-2 font-semibold text-slate-600">{template.language}</td><td className="px-3 py-2 font-semibold text-slate-600">{template.category}</td><td className="px-3 py-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{metaStatusLabel(template.status)}</span></td></tr>)}</tbody></table></div>}{snapshot && templates.length === 0 && <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><p className="font-black text-slate-800">Nenhum template Meta da Psicologia.</p><p className="mt-1 text-xs font-semibold text-slate-500">A conexão está ativa; templates de outros contextos e legacy permanecem ocultos.</p></div>}</section>;
}

function MetaSecurityBlock({ snapshot }: { snapshot: MetaTemplateSnapshot | null }) {
  return <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm lg:col-span-3" data-testid="psychology-meta-security"><p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Segurança / Estado</p><h4 className="mt-1 text-lg font-black text-amber-950">Escrita bloqueada</h4><p className="mt-2 text-sm font-semibold text-amber-900">Envio à Meta será habilitado após autorização.</p><dl className="mt-4 grid gap-2 sm:grid-cols-3 text-sm"><SafeMetaRow label="META_WRITE_ENABLED" value="NO" /><SafeMetaRow label="Browser → VPS" value="Não permitido" /><SafeMetaRow label="Browser → Graph API" value="Não permitido" /><SafeMetaRow label="Segredos no frontend" value="Não" /><SafeMetaRow label="canRead" value={snapshot?.canRead ? 'true' : '—'} /><SafeMetaRow label="canWrite" value="false" /></dl><button type="button" disabled className={`${secondaryButton} mt-4`} title="META_WRITE_ENABLED=false">Enviar para análise da Meta</button></section>;
}

function SafeMetaRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="text-right text-xs font-black text-slate-800">{value}</dd></div>;
}

function SafeMetaCounter({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-slate-50 px-2 py-2 text-center"><p className="text-[10px] font-black text-slate-500">{label}</p><p className="mt-1 text-base font-black text-slate-800">{value}</p></div>;
}

function metaStatusLabel(status: MetaTemplateSnapshot['templates'][number]['status']): string {
  if (status === 'APPROVED') return 'Aprovado';
  if (status === 'PENDING') return 'Em análise';
  if (status === 'REJECTED') return 'Rejeitado';
  if (status === 'PAUSED') return 'Pausado';
  if (status === 'DISABLED') return 'Desativado';
  return 'Desconhecido';
}

function formatMetaSync(value: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return 'Disponível'; }
}

function EmptyPanel({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-violet-700 shadow-sm">{icon}</div><h4 className="mt-3 font-black text-slate-900">{title}</h4><p className="mx-auto mt-1 max-w-xl text-sm font-semibold text-slate-500">{description}</p></div>;
}

function createNewTemplate(workspaceId: string, contextId: MessageTemplateDraft['contextId'], professionalId: string): MessageTemplateDraft {
  const timestamp = new Date().toISOString();
  return { id: `message-new-${Date.now()}`, workspaceId, contextId, professionalId, displayName: '', purpose: 'Lembrete administrativo', reminderType: 'EVE_OF_APPOINTMENT', modalityScope: 'ALL', body: '', semanticVariables: [], language: 'pt_BR', requestedCategory: 'UTILITY', localStatus: 'DRAFT', enabled: true, metaTemplateId: null, metaTemplateName: null, metaStatus: null, createdAt: timestamp, updatedAt: timestamp };
}
