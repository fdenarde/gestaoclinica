import { Activity, CheckCircle2, CircleAlert, Play, RotateCcw, Search, XCircle } from 'lucide-react';
import { hasSimulationPermission } from '../domain/permissionPolicy';
import { formatSimulationDateTime, FAILURE_REASONS } from '../state/simulationScheduleActions';
import type { SimulationState, SimulationTenantData } from '../simulationTypes';
import type { SimulationFailureReason, SimulationQueueJob, SimulationQueueOutcome } from '../scheduleTypes';

const jobLabels: Record<SimulationQueueJob['status'], string> = {
  pending: 'Pendente na simulação',
  scheduled: 'Programado na simulação',
  processing: 'Processando na simulação',
  completed: 'Concluído na simulação',
  failed: 'Falhou na simulação',
  cancelled: 'Cancelado na simulação',
  expired: 'Expirado na simulação',
};

const sourceLabels = { manual: 'Manual', quick_reply: 'Resposta rápida', template: 'Template' } as const;

interface QueueViewProps {
  state: SimulationState;
  tenant: SimulationTenantData;
  jobs: SimulationQueueJob[];
  onSelect: (id: string) => void;
  onFiltersChange: (filters: Partial<SimulationState['queueFilters']>) => void;
  onClearFilters: () => void;
  onUpdateStates: () => void;
  onProcessNext: (outcome: SimulationQueueOutcome, reason: SimulationFailureReason) => void;
  onProcessSelected: (jobId: string, outcome: SimulationQueueOutcome, reason: SimulationFailureReason) => void;
  onCancel: (scheduleId: string) => void;
  onReprocess: (jobId: string) => void;
}

export function QueueView({ state, tenant, jobs, onSelect, onFiltersChange, onClearFilters, onUpdateStates, onProcessNext, onProcessSelected, onCancel, onReprocess }: QueueViewProps) {
  const canProcess = hasSimulationPermission(state.profileId, 'process_queue');
  const canReprocess = hasSimulationPermission(state.profileId, 'reprocess_queue');
  const [failureReason] = FAILURE_REASONS;
  const process = (jobId: string | undefined, outcome: SimulationQueueOutcome, reason: SimulationFailureReason = failureReason) => jobId ? onProcessSelected(jobId, outcome, reason) : onProcessNext(outcome, reason);

  return (
    <div className="space-y-5" data-testid="simulation-queue-view">
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">R2-C · sem worker</p><h1 className="mt-1 text-xl font-black text-clinic-text">Fila operacional simulada</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-clinic-text-muted">Os trabalhos só mudam de estado por ações explícitas. Não existe execução automática, provider ou envio.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={onUpdateStates} className="inline-flex items-center gap-2 rounded-xl border border-clinic-primary/30 bg-white px-4 py-3 text-xs font-black text-clinic-primary"><Activity size={15} /> Atualizar estados</button><button type="button" disabled={!canProcess} onClick={() => onProcessNext('success', failureReason)} className="inline-flex items-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black text-white disabled:opacity-40"><Play size={15} /> Processar próximo</button></div></div></section>
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic"><div className="flex flex-wrap items-center gap-2"><select value={state.queueFilters.status} onChange={event => onFiltersChange({ status: event.target.value as SimulationState['queueFilters']['status'] })} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs"><option value="">Todos os estados</option>{Object.entries(jobLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={state.queueFilters.sourceType} onChange={event => onFiltersChange({ sourceType: event.target.value as SimulationState['queueFilters']['sourceType'] })} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs"><option value="">Todas as origens</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={state.queueFilters.period} onChange={event => onFiltersChange({ period: event.target.value as SimulationState['queueFilters']['period'] })} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs"><option value="all">Todo período</option><option value="past">Antes do relógio</option><option value="today">Janela de 24h</option><option value="future">Depois do relógio</option></select><label className="relative"><Search size={14} className="absolute left-3 top-2.5 text-clinic-text-faint" /><input value={state.queueFilters.search} onChange={event => onFiltersChange({ search: event.target.value })} placeholder="Pesquisar ID" className="rounded-lg border border-clinic-border bg-white py-2 pl-8 pr-3 text-xs" /></label><button type="button" onClick={onClearFilters} className="rounded-lg border border-clinic-border px-3 py-2 text-xs font-black text-clinic-text-muted">Limpar filtros</button></div></section>
      <section className="space-y-3">{jobs.map(job => { const schedule = state.schedules.find(item => item.id === job.scheduleId); const conversation = tenant.conversations.find(item => item.id === job.conversationId); const active = job.id === state.selectedQueueJobId; return <article key={job.id} onClick={() => onSelect(job.id)} className={`rounded-2xl border bg-clinic-surface p-4 shadow-clinic ${active ? 'border-clinic-primary' : 'border-clinic-border'}`}><div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-black text-clinic-primary">{job.id}</span><span className="rounded-full bg-clinic-bg px-2 py-1 text-[10px] font-black text-clinic-text-muted">{jobLabels[job.status]}</span><span className="rounded-full bg-clinic-bg px-2 py-1 text-[10px] font-black text-clinic-text-muted">Tentativa {job.attempt}</span></div><p className="mt-2 text-sm font-black text-clinic-text">{conversation?.contact.displayName || 'Contato sintético'} · {schedule ? sourceLabels[schedule.sourceType] : 'Origem sintética'}</p><p className="mt-1 truncate text-xs text-clinic-text-muted">{schedule?.contentSnapshot || 'Snapshot indisponível'}</p><div className="mt-2 grid gap-1 text-[11px] text-clinic-text-faint sm:grid-cols-2"><span>Programado: {formatSimulationDateTime(job.scheduledAt)}</span><span>Validade: {formatSimulationDateTime(job.expiresAt)}</span><span>Responsável: {job.createdBy}</span><span>Idempotência: {job.idempotencyKey.slice(0, 28)}…</span><span>Atualizado: {formatSimulationDateTime(job.updatedAt)}</span>{job.failureReason && <span className="text-red-700">Motivo: {job.failureReason}</span>}</div></div><div className="flex flex-wrap gap-2 xl:max-w-[310px] xl:justify-end"><button type="button" disabled={!canProcess || !['pending', 'scheduled'].includes(job.status)} onClick={event => { event.stopPropagation(); onSelect(job.id); process(job.id, 'success'); }} className="inline-flex items-center gap-1 rounded-lg bg-clinic-primary px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-40">Sucesso</button><button type="button" disabled={!canProcess || !['pending', 'scheduled'].includes(job.status)} onClick={event => { event.stopPropagation(); onSelect(job.id); process(job.id, 'failure'); }} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-[10px] font-black uppercase text-red-700 disabled:opacity-40"><CircleAlert size={12} /> Falha</button><button type="button" disabled={!canReprocess || job.status !== 'failed'} onClick={event => { event.stopPropagation(); onReprocess(job.id); }} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-3 py-2 text-[10px] font-black uppercase text-amber-800 disabled:opacity-40"><RotateCcw size={12} /> Reprocessar</button><button type="button" disabled={!['pending', 'scheduled'].includes(job.status)} onClick={event => { event.stopPropagation(); if (schedule) onCancel(schedule.id); }} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted disabled:opacity-40"><XCircle size={12} /> Cancelar</button></div></div></article>; })}{jobs.length === 0 && <div className="rounded-2xl border border-dashed border-clinic-border bg-clinic-surface p-10 text-center text-sm text-clinic-text-muted">Nenhum trabalho sintético nesta categoria. Avance o relógio e selecione Atualizar estados.</div>}</section>
      <p className="flex items-center gap-2 rounded-xl bg-clinic-bg px-4 py-3 text-xs text-clinic-text-muted"><CheckCircle2 size={15} className="text-clinic-primary" /> A fila é isolada pelo tenant ativo; os estados são pendente, processing, concluído, falha, cancelado ou expirado na simulação.</p>
    </div>
  );
}
