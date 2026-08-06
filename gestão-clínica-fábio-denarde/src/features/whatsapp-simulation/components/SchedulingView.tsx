import { CalendarClock, CheckCircle2, Clock3, Edit3, Play, RefreshCw, RotateCcw, Search, XCircle } from 'lucide-react';
import { hasSimulationPermission } from '../domain/permissionPolicy';
import { resolveTemplateContent } from '../domain/templateValidation';
import { addSimulationHours, formatSimulationDateTime, simulationDateTimeInputValue } from '../state/simulationScheduleActions';
import type { SimulationState, SimulationTenantData } from '../simulationTypes';
import type { SimulationSchedule, SimulationScheduleDraft, SimulationScheduleEdit, SimulationScheduleInput, SimulationSchedulePreview } from '../scheduleTypes';

const scheduleLabels: Record<SimulationSchedule['status'], string> = {
  draft: 'Rascunho na simulação',
  scheduled: 'Programado na simulação',
  queued: 'Enfileirado na simulação',
  completed: 'Processado na simulação',
  failed: 'Falhou na simulação',
  cancelled: 'Cancelado na simulação',
  expired: 'Expirado na simulação',
};

const sourceLabels = { manual: 'Mensagem manual', quick_reply: 'Resposta rápida', template: 'Template' } as const;

interface SchedulingViewProps {
  state: SimulationState;
  tenantId: SimulationState['activeTenantId'];
  tenant: SimulationTenantData;
  schedules: SimulationSchedule[];
  selectedSchedule: SimulationSchedule | null;
  preview: SimulationSchedulePreview | null;
  draft: SimulationScheduleDraft | null;
  onDraftChange: (draft: SimulationScheduleDraft) => void;
  onPreview: (input: SimulationScheduleInput) => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
  onSelect: (id: string) => void;
  onStartEdit: (schedule: SimulationSchedule) => void;
  onClearDraft: () => void;
  onEdit: (id: string, edit: SimulationScheduleEdit) => void;
  onCancel: (id: string) => void;
  onAdvance: (minutes: number) => void;
  onSetClock: (value: string) => void;
  onRestoreClock: () => void;
  onUpdateStates: () => void;
  onFiltersChange: (filters: Partial<SimulationState['scheduleFilters']>) => void;
  onClearFilters: () => void;
}

function defaultDraft(state: SimulationState, tenant: SimulationTenantData): SimulationScheduleDraft {
  const conversationId = state.selectedConversationId || tenant.conversations[0]?.id || '';
  const scheduledAt = addSimulationHours(state.clock.now, 1);
  return { conversationId, sourceType: 'manual', sourceId: '', contentSnapshot: 'Mensagem agendada fictícia para validação R2-C.', scheduledAt: simulationDateTimeInputValue(scheduledAt), expiresAt: simulationDateTimeInputValue(addSimulationHours(scheduledAt, 24)) };
}

export function SchedulingView({ state, tenantId, tenant, schedules, selectedSchedule, preview, draft, onDraftChange, onPreview, onConfirmPreview, onCancelPreview, onSelect, onStartEdit, onClearDraft, onEdit, onCancel, onAdvance, onSetClock, onRestoreClock, onUpdateStates, onFiltersChange, onClearFilters }: SchedulingViewProps) {
  const form = draft || defaultDraft(state, tenant);
  const profileId = state.profileId;
  const canCreate = hasSimulationPermission(profileId, 'create_schedule');
  const canEdit = hasSimulationPermission(profileId, 'edit_schedule');
  const canCancel = hasSimulationPermission(profileId, 'cancel_schedule');
  const canClock = hasSimulationPermission(profileId, 'advance_clock');
  const canUpdate = hasSimulationPermission(profileId, 'update_schedule_states');
  const selectedConversation = tenant.conversations.find(item => item.id === form.conversationId);

  const updateForm = (changes: Partial<SimulationScheduleDraft>) => onDraftChange({ ...form, ...changes });
  const changeSource = (sourceType: SimulationScheduleDraft['sourceType']) => {
    if (sourceType === 'manual') return updateForm({ sourceType, sourceId: '', templateVersion: undefined, contentSnapshot: 'Mensagem agendada fictícia para validação R2-C.' });
    if (sourceType === 'quick_reply') {
      const reply = tenant.quickReplies.find(item => item.status === 'active');
      return updateForm({ sourceType, sourceId: reply?.id || '', templateVersion: undefined, contentSnapshot: reply?.content || '' });
    }
    const template = tenant.templates.find(item => item.status === 'active');
    return updateForm({ sourceType, sourceId: template?.id || '', templateVersion: template?.version, contentSnapshot: template ? resolveTemplateContent(template, { contato_nome: selectedConversation?.contact.displayName || 'Contato Fictício', tenant_nome: tenant.tenant.label }) : '' });
  };
  const changeSourceId = (sourceId: string) => {
    if (form.sourceType === 'quick_reply') {
      const reply = tenant.quickReplies.find(item => item.id === sourceId);
      return updateForm({ sourceId, contentSnapshot: reply?.content || '' });
    }
    const template = tenant.templates.find(item => item.id === sourceId);
    return updateForm({ sourceId, templateVersion: template?.version, contentSnapshot: template ? resolveTemplateContent(template, { contato_nome: selectedConversation?.contact.displayName || 'Contato Fictício', tenant_nome: tenant.tenant.label }) : '' });
  };
  const input: SimulationScheduleInput = { tenantId, conversationId: form.conversationId, sourceType: form.sourceType, sourceId: form.sourceId || undefined, templateVersion: form.sourceType === 'template' ? form.templateVersion : undefined, contentSnapshot: form.contentSnapshot, scheduledAt: form.scheduledAt, expiresAt: form.expiresAt };
  const isEditing = Boolean(state.scheduleEditingId);

  return (
    <div className="space-y-5" data-testid="simulation-schedules-view">
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">R2-C · relógio determinístico</p><h1 className="mt-1 text-xl font-black text-clinic-text">Agendamentos simulados</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-clinic-text-muted">Tudo fica somente na memória local. O relógio não altera o computador e nenhum trabalho é processado automaticamente.</p></div>
          <div className="rounded-2xl border border-clinic-primary/20 bg-clinic-primary/5 p-4 text-right"><p className="text-[10px] font-black uppercase tracking-wide text-clinic-primary">Agora · {state.clock.timezone}</p><p className="mt-1 text-lg font-black text-clinic-text">{formatSimulationDateTime(state.clock.now)}</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" disabled={!canClock} onClick={() => onAdvance(15)} className="rounded-lg border border-clinic-primary/30 bg-white px-3 py-2 text-[10px] font-black text-clinic-primary disabled:opacity-40">+15 min</button><button type="button" disabled={!canClock} onClick={() => onAdvance(60)} className="rounded-lg border border-clinic-primary/30 bg-white px-3 py-2 text-[10px] font-black text-clinic-primary disabled:opacity-40">+1 hora</button><button type="button" disabled={!canClock} onClick={() => onAdvance(1440)} className="rounded-lg border border-clinic-primary/30 bg-white px-3 py-2 text-[10px] font-black text-clinic-primary disabled:opacity-40">+1 dia</button><button type="button" disabled={!canClock} onClick={onRestoreClock} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border bg-white px-3 py-2 text-[10px] font-black text-clinic-text-muted disabled:opacity-40"><RotateCcw size={12} /> Restaurar</button></div></div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-clinic-border pt-4"><label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Definir horário fictício</span><input type="datetime-local" disabled={!canClock} value={simulationDateTimeInputValue(state.clock.now)} onChange={event => onSetClock(event.target.value)} className="rounded-xl border border-clinic-border bg-white px-3 py-2 text-sm disabled:opacity-50" /></label><button type="button" disabled={!canUpdate} onClick={onUpdateStates} className="inline-flex items-center gap-2 rounded-xl border border-clinic-primary/30 bg-white px-4 py-2.5 text-xs font-black text-clinic-primary disabled:opacity-40"><RefreshCw size={14} /> Atualizar estados</button><span className="text-xs text-clinic-text-muted">Cada avanço registra um evento local no histórico do relógio.</span></div>
      </section>

      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">{isEditing ? 'Edição controlada' : 'Novo registro'}</p><h2 className="mt-1 text-lg font-black text-clinic-text">{isEditing ? `Editar ${state.scheduleEditingId}` : 'Agendar mensagem simulada'}</h2></div><span className="rounded-full bg-clinic-bg px-3 py-1.5 text-[10px] font-black text-clinic-text-muted">Tenant ativo: {tenantId}</span></div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Conversa fictícia</span><select disabled={!canCreate && !isEditing} value={form.conversationId} onChange={event => updateForm({ conversationId: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm">{tenant.conversations.map(item => <option key={item.id} value={item.id}>{item.contact.displayName} · {item.id}</option>)}</select></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Origem</span><select disabled={!canCreate && !isEditing} value={form.sourceType} onChange={event => changeSource(event.target.value as SimulationScheduleDraft['sourceType'])} className="w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm">{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {form.sourceType !== 'manual' && <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">{form.sourceType === 'template' ? 'Template ativo' : 'Resposta rápida ativa'}</span><select disabled={!canCreate && !isEditing} value={form.sourceId} onChange={event => changeSourceId(event.target.value)} className="w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm">{form.sourceType === 'quick_reply' ? tenant.quickReplies.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.title}</option>) : tenant.templates.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>}
          <label className="xl:col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Snapshot do conteúdo sintético</span><textarea disabled={!canCreate && !isEditing} value={form.contentSnapshot} onChange={event => updateForm({ contentSnapshot: event.target.value })} rows={3} className="w-full resize-none rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm disabled:opacity-50" /></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Data/hora programada</span><input type="datetime-local" disabled={!canCreate && !isEditing} value={form.scheduledAt} onChange={event => updateForm({ scheduledAt: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm disabled:opacity-50" /></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Validade · expiresAt</span><input type="datetime-local" disabled={!canCreate && !isEditing} value={form.expiresAt} onChange={event => updateForm({ expiresAt: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm disabled:opacity-50" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" disabled={(!canCreate && !isEditing) || !form.contentSnapshot.trim()} onClick={() => isEditing && selectedSchedule ? onEdit(selectedSchedule.id, input) : onPreview(input)} className="inline-flex items-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-40">{isEditing ? <Edit3 size={15} /> : <CalendarClock size={15} />}{isEditing ? 'Salvar edição simulada' : 'Pré-visualizar agendamento'}</button>{isEditing && <button type="button" onClick={onClearDraft} className="rounded-xl border border-clinic-border px-4 py-3 text-xs font-black text-clinic-text-muted">Cancelar edição</button>}<span className="text-xs text-clinic-text-muted">Timezone lógico: America/Sao_Paulo · validade padrão: +24 horas.</span></div>
        {preview && <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Pré-visualização · nada será enviado</p><div className="mt-2 grid gap-2 text-xs text-amber-950 sm:grid-cols-2"><p><strong>Origem:</strong> {preview.sourceLabel}</p><p><strong>Contato:</strong> {preview.contactName}</p><p><strong>Programado:</strong> {formatSimulationDateTime(preview.scheduledAt)}</p><p><strong>Validade:</strong> {formatSimulationDateTime(preview.resolvedExpiresAt)}</p></div><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-3 text-sm text-clinic-text">{preview.contentSnapshot}</pre><div className="mt-3 flex gap-2"><button type="button" onClick={onConfirmPreview} className="rounded-lg bg-clinic-primary px-3 py-2 text-[10px] font-black uppercase text-white">Confirmar registro simulado</button><button type="button" onClick={onCancelPreview} className="rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted">Cancelar</button></div></div>}
      </section>

      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Registros do tenant ativo</p><h2 className="mt-1 text-lg font-black text-clinic-text">Programações fictícias</h2></div><div className="flex flex-wrap gap-2"><select value={state.scheduleFilters.status} onChange={event => onFiltersChange({ status: event.target.value as SimulationState['scheduleFilters']['status'] })} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs"><option value="">Todos os estados</option>{Object.entries(scheduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={state.scheduleFilters.sourceType} onChange={event => onFiltersChange({ sourceType: event.target.value as SimulationState['scheduleFilters']['sourceType'] })} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs"><option value="">Todas as origens</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-clinic-text-faint" /><input value={state.scheduleFilters.search} onChange={event => onFiltersChange({ search: event.target.value })} placeholder="Pesquisar ID" className="rounded-lg border border-clinic-border bg-white py-2 pl-8 pr-3 text-xs" /></label><button type="button" onClick={onClearFilters} className="rounded-lg border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted">Limpar</button></div></div>
        <div className="mt-4 space-y-3">{schedules.map(schedule => { const conversation = tenant.conversations.find(item => item.id === schedule.conversationId); const active = schedule.id === selectedSchedule?.id; return <article key={schedule.id} onClick={() => onSelect(schedule.id)} className={`cursor-pointer rounded-2xl border p-4 transition ${active ? 'border-clinic-primary bg-clinic-primary/5' : 'border-clinic-border bg-white'}`}><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-black text-clinic-primary">{schedule.id}</span><span className="rounded-full bg-clinic-bg px-2 py-1 text-[10px] font-black text-clinic-text-muted">{scheduleLabels[schedule.status]}</span><span className="rounded-full bg-clinic-bg px-2 py-1 text-[10px] font-black text-clinic-text-muted">Tentativa {schedule.queueJobId ? state.queueJobs.find(item => item.id === schedule.queueJobId)?.attempt || 1 : '—'}</span></div><p className="mt-2 text-sm font-black text-clinic-text">{conversation?.contact.displayName} · {sourceLabels[schedule.sourceType]}</p><p className="mt-1 truncate text-xs text-clinic-text-muted">{schedule.contentSnapshot}</p><p className="mt-2 text-xs text-clinic-text-faint">Programado: {formatSimulationDateTime(schedule.scheduledAt)} · Validade: {formatSimulationDateTime(schedule.expiresAt)}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={!canEdit || schedule.status !== 'scheduled'} onClick={event => { event.stopPropagation(); onSelect(schedule.id); onStartEdit(schedule); }} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black text-clinic-text-muted disabled:opacity-40"><Edit3 size={12} /> Editar</button><button type="button" disabled={!canCancel || !['scheduled', 'queued'].includes(schedule.status)} onClick={event => { event.stopPropagation(); onCancel(schedule.id); }} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-[10px] font-black text-red-700 disabled:opacity-40"><XCircle size={12} /> Cancelar</button></div></div></article>; })}{schedules.length === 0 && <div className="rounded-xl border border-dashed border-clinic-border p-8 text-center text-sm text-clinic-text-muted">Nenhum agendamento sintético corresponde aos filtros.</div>}</div>
      </section>
      <p className="flex items-center gap-2 rounded-xl bg-clinic-bg px-4 py-3 text-xs text-clinic-text-muted"><CheckCircle2 size={15} className="text-clinic-primary" /> Agendamentos são snapshots imutáveis da intenção fictícia até uma edição explícita, sem provider e sem mensagem real.</p>
    </div>
  );
}
