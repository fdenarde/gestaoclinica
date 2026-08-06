import { ArrowDownLeft, Check, CheckCircle2, Clock3, History, MessageCircle, RefreshCw, RotateCcw, Send, XCircle } from 'lucide-react';
import { hasSimulationPermission } from '../../domain/permissionPolicy';
import { getLatestOutbound } from '../../state/simulationSelectors';
import type { SimulationComposerState, SimulationConversation, SimulationMessageStatus, SimulationPreview, SimulationProfessional, SimulationProfileId, SimulationQuickReply, SimulationTag, SimulationTemplate } from '../../simulationTypes';
import { InternalNotes } from './InternalNotes';

interface ConversationViewProps {
  conversation: SimulationConversation;
  profileId: SimulationProfileId;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  quickReplies: SimulationQuickReply[];
  templates: SimulationTemplate[];
  composition: SimulationComposerState;
  preview: SimulationPreview | null;
  shouldFail: boolean;
  noteDraft: string;
  onDraftChange: (value: string) => void;
  onModeChange: (mode: SimulationComposerState['mode']) => void;
  onQuickReplyChange: (quickReplyId: string) => void;
  onTemplateChange: (templateId: string) => void;
  onShouldFailChange: (value: boolean) => void;
  onNoteDraftChange: (value: string) => void;
  onPreview: () => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
  onAdvance: () => void;
  onCancel: () => void;
  onFinalize: () => void;
  onReopen: () => void;
  onSyntheticInbound: () => void;
  onCreateNote: () => void;
  onAssign: (professionalId: string | null) => void;
  onPriorityChange: (priority: 'normal' | 'alta') => void;
  onToggleTag: (tagId: string) => void;
}

const statusLabels: Record<SimulationMessageStatus, string> = {
  draft: 'Rascunho',
  simulated_queued: 'Simulada · enfileirada',
  simulated_processed: 'Simulada · processada',
  simulated_delivered: 'Simulada · entregue',
  simulated_read: 'Simulada · lida',
  simulated_failed: 'Simulada · falhou',
  simulated_cancelled: 'Simulada · cancelada',
};

const stateLabels: Record<SimulationConversation['state'], string> = {
  nova: 'Nova',
  aberta: 'Aberta',
  aguardando_equipe: 'Aguardando equipe',
  aguardando_contato: 'Aguardando contato',
  finalizada: 'Finalizada',
  reaberta: 'Reaberta',
};

function messageStatusClass(status: SimulationMessageStatus): string {
  if (status === 'simulated_failed') return 'bg-status-red-bg text-status-red-text';
  if (status === 'simulated_cancelled') return 'bg-clinic-bg text-clinic-text-muted';
  if (status === 'simulated_read') return 'bg-status-green-bg text-status-green-text';
  return 'bg-status-blue-bg text-status-blue-text';
}

export function ConversationView({ conversation, profileId, professionals, tags, quickReplies, templates, composition, preview, shouldFail, noteDraft, onDraftChange, onModeChange, onQuickReplyChange, onTemplateChange, onShouldFailChange, onNoteDraftChange, onPreview, onConfirmPreview, onCancelPreview, onAdvance, onCancel, onFinalize, onReopen, onSyntheticInbound, onCreateNote, onAssign, onPriorityChange, onToggleTag }: ConversationViewProps) {
  const latestOutbound = getLatestOutbound(conversation);
  const canRegister = hasSimulationPermission(profileId, 'register_message') && conversation.state !== 'finalizada';
  const canUseTemplate = hasSimulationPermission(profileId, 'use_template');
  const canFinalize = hasSimulationPermission(profileId, 'finalize_conversation');
  const canReopen = hasSimulationPermission(profileId, 'reopen_conversation');
  const canInbound = hasSimulationPermission(profileId, 'register_message') && conversation.state !== 'finalizada';
  const statusTerminal = !latestOutbound || ['simulated_read', 'simulated_failed', 'simulated_cancelled'].includes(latestOutbound.status);
  const canCancel = Boolean(latestOutbound) && !['simulated_delivered', 'simulated_read', 'simulated_failed', 'simulated_cancelled'].includes(latestOutbound?.status || '');

  return (
    <main className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-clinic-border bg-clinic-surface shadow-clinic">
      <div className="flex flex-col gap-3 border-b border-clinic-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">{conversation.id} · {conversation.tenantId}</p><h2 className="truncate text-lg font-black text-clinic-text">{conversation.contact.displayName}</h2><p className="text-xs text-clinic-text-muted">{conversation.contact.reference}</p></div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto"><span className="rounded-full bg-clinic-bg px-3 py-2 text-[10px] font-black uppercase tracking-wide text-clinic-text-muted">{stateLabels[conversation.state]}</span><span className="inline-flex items-center gap-1 rounded-full bg-status-green-bg px-3 py-2 text-[10px] font-black uppercase tracking-wide text-status-green-text"><CheckCircle2 size={13} /> Somente simulação</span></div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-clinic-bg/50 p-4 sm:p-6">
        {conversation.messages.map(message => <div key={message.id} className={message.direction === 'outbound' ? 'flex justify-end' : 'flex justify-start'}><article className={message.direction === 'outbound' ? 'max-w-[92%] rounded-2xl border border-clinic-primary/20 bg-clinic-primary/5 px-4 py-3 shadow-sm sm:max-w-[76%]' : 'max-w-[92%] rounded-2xl border border-clinic-border bg-white px-4 py-3 shadow-sm sm:max-w-[76%]'}><p className="text-sm leading-relaxed text-clinic-text">{message.body}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-clinic-text-faint"><span className="inline-flex items-center gap-1"><Clock3 size={12} /> {message.time}</span><span className={messageStatusClass(message.status) + ' rounded-full px-2 py-1 font-black'}>{statusLabels[message.status]}</span><span>{message.id}</span></div></article></div>)}

        <div className="rounded-2xl border border-clinic-border bg-white/70 p-4"><p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-clinic-text-faint"><History size={13} /> Histórico local da conversa</p><div className="space-y-2">{conversation.history.slice().reverse().map(entry => <div key={entry.id} className="flex items-start gap-2 text-xs"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-clinic-primary" /><p className="text-clinic-text-muted"><strong className="text-clinic-text">{entry.label}</strong> · {entry.actor} · {entry.time}</p></div>)}</div></div>
      </div>

      <div className="border-t border-clinic-border bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={onAdvance} disabled={statusTerminal} className="inline-flex items-center gap-2 rounded-xl border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted transition hover:bg-clinic-bg disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={14} /> Avançar status simulado</button>
          <button type="button" onClick={onCancel} disabled={!canCancel} className="inline-flex items-center gap-2 rounded-xl border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted transition hover:bg-clinic-bg disabled:cursor-not-allowed disabled:opacity-50"><XCircle size={14} /> Cancelar simulação</button>
          {conversation.state === 'finalizada' ? <button type="button" onClick={onReopen} disabled={!canReopen} className="inline-flex items-center gap-2 rounded-xl border border-status-green-text/30 px-3 py-2 text-xs font-black text-status-green-text disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={14} /> Reabrir conversa</button> : <button type="button" onClick={onFinalize} disabled={!canFinalize} className="inline-flex items-center gap-2 rounded-xl border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted transition hover:bg-clinic-bg disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 size={14} /> Finalizar conversa</button>}
          <button type="button" onClick={onSyntheticInbound} disabled={!canInbound} className="inline-flex items-center gap-2 rounded-xl border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted transition hover:bg-clinic-bg disabled:cursor-not-allowed disabled:opacity-50"><ArrowDownLeft size={14} /> Entrada sintética</button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1"><div className="mb-3 flex flex-wrap gap-2"><button type="button" disabled={!canRegister} onClick={() => onModeChange('manual')} className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase ${composition.mode === 'manual' ? 'bg-clinic-primary text-white' : 'border border-clinic-border text-clinic-text-muted'}`}>Mensagem manual</button><button type="button" disabled={!canRegister || !canUseTemplate} onClick={() => onModeChange('quick_reply')} className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase ${composition.mode === 'quick_reply' ? 'bg-violet-600 text-white' : 'border border-clinic-border text-clinic-text-muted'}`}>Resposta rápida</button><button type="button" disabled={!canRegister || !canUseTemplate} onClick={() => onModeChange('template')} className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase ${composition.mode === 'template' ? 'bg-amber-600 text-white' : 'border border-clinic-border text-clinic-text-muted'}`}>Template</button></div>{composition.mode === 'quick_reply' && <label className="mb-3 block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Resposta rápida ativa</span><select value={composition.quickReplyId} disabled={!canRegister || !canUseTemplate} onChange={event => onQuickReplyChange(event.target.value)} className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm"><option value="">Selecione uma resposta rápida</option>{quickReplies.filter(reply => reply.status === 'active').map(reply => <option key={reply.id} value={reply.id}>{reply.title}</option>)}</select></label>}{composition.mode === 'template' && <label className="mb-3 block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Template ativo</span><select value={composition.templateId} disabled={!canRegister || !canUseTemplate} onChange={event => onTemplateChange(event.target.value)} className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm"><option value="">Selecione um template ativo</option>{templates.filter(template => template.status === 'active').map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select></label>}<label className="block"><span className="mb-2 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">{composition.mode === 'template' ? 'Conteúdo resolvido e editável' : composition.mode === 'quick_reply' ? 'Conteúdo da resposta rápida e editável' : 'Mensagem fictícia'}</span><textarea value={composition.draft} disabled={!canRegister} onChange={event => onDraftChange(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onPreview(); }} rows={3} placeholder={conversation.state === 'finalizada' ? 'Conversa finalizada — reabra para compor.' : 'Digite uma mensagem exclusivamente simulada...'} className="w-full resize-none rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm text-clinic-text outline-none transition focus:border-clinic-primary focus:ring-2 focus:ring-clinic-primary/15 disabled:cursor-not-allowed disabled:opacity-60" /></label></div>
          <div className="flex flex-col gap-2 sm:w-56"><label className="flex items-center gap-2 text-xs font-bold text-clinic-text-muted"><input type="checkbox" checked={shouldFail} disabled={!canRegister} onChange={event => onShouldFailChange(event.target.checked)} className="h-4 w-4 rounded border-clinic-border text-clinic-primary disabled:opacity-60" /> Simular falha controlada</label><button type="button" onClick={onPreview} disabled={!canRegister || !composition.draft.trim() || (composition.mode === 'quick_reply' && !composition.quickReplyId) || (composition.mode === 'template' && !composition.templateId)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition hover:bg-clinic-primary-hover disabled:cursor-not-allowed disabled:opacity-50"><Send size={16} /> Pré-visualizar e Registrar mensagem</button></div>
        </div>
        {preview && preview.conversationId === conversation.id && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Pré-visualização · nada será enviado</p><p className="mt-2 text-xs text-amber-900">{preview.sourceLabel}{preview.templateVersion ? ` · versão ${preview.templateVersion}` : ''} · {preview.contactName}</p><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-clinic-text">{preview.content}</pre><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onConfirmPreview} className="rounded-lg bg-clinic-primary px-3 py-2 text-[10px] font-black uppercase text-white">Confirmar registro simulado</button><button type="button" onClick={onCancelPreview} className="rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted">Voltar e editar</button><button type="button" onClick={onCancelPreview} className="rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted">Cancelar</button></div></div>}
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-clinic-bg px-3 py-2 text-xs text-clinic-text-muted"><MessageCircle size={15} className="mt-0.5 shrink-0 text-clinic-primary" /> Ações manuais, respostas rápidas e templates são fictícios, idempotentes e mantidos somente na memória local.</div>
      </div>

      <div className="grid gap-4 border-t border-clinic-border bg-clinic-bg/40 p-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)] sm:p-5">
        <InternalNotes notes={conversation.notes} profileId={profileId} draft={noteDraft} onDraftChange={onNoteDraftChange} onCreate={onCreateNote} />
        <div className="rounded-2xl border border-clinic-border bg-white p-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-text-faint">Estado controlado</p><p className="mt-2 text-sm font-black text-clinic-text">{stateLabels[conversation.state]}</p><p className="mt-1 text-xs leading-relaxed text-clinic-text-muted">Finalização bloqueia a composição. Reabertura exige permissão simulada e registra histórico local.</p></div>
      </div>
    </main>
  );
}
