import { Filter, Search, X } from 'lucide-react';
import type { SimulationFilters, SimulationConversationState, SimulationProfessional, SimulationTag } from '../../simulationTypes';

interface ConversationFiltersProps {
  filters: SimulationFilters;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  onChange: (filters: Partial<SimulationFilters>) => void;
  onClear: () => void;
}

const statuses: Array<{ value: SimulationConversationState; label: string }> = [
  { value: 'nova', label: 'Nova' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'aguardando_equipe', label: 'Aguardando equipe' },
  { value: 'aguardando_contato', label: 'Aguardando contato' },
  { value: 'finalizada', label: 'Finalizada' },
  { value: 'reaberta', label: 'Reaberta' },
];

export function ConversationFilters({ filters, professionals, tags, onChange, onClear }: ConversationFiltersProps) {
  const hasFilters = Boolean(filters.search || filters.status || filters.professionalId || filters.tagId);
  return (
    <div className="space-y-3 border-t border-clinic-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-clinic-text-faint"><Filter size={13} /> Filtros</p>
        {hasFilters && <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-clinic-primary"><X size={12} /> Limpar</button>}
      </div>
      <label className="relative block">
        <span className="sr-only">Pesquisar por nome ou identificador sintético</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-3 text-clinic-text-faint" />
        <input value={filters.search} onChange={event => onChange({ search: event.target.value })} placeholder="Nome ou identificador sintético" className="w-full rounded-xl border border-clinic-border bg-clinic-bg py-2.5 pl-9 pr-3 text-xs text-clinic-text outline-none focus:border-clinic-primary focus:ring-2 focus:ring-clinic-primary/15" />
      </label>
      <select value={filters.status} onChange={event => onChange({ status: event.target.value as SimulationConversationState | '' })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-bold text-clinic-text-muted outline-none focus:border-clinic-primary">
        <option value="">Todos os status</option>
        {statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
      </select>
      <select value={filters.professionalId} onChange={event => onChange({ professionalId: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-bold text-clinic-text-muted outline-none focus:border-clinic-primary">
        <option value="">Todos os profissionais</option>
        {professionals.map(professional => <option key={professional.id} value={professional.id}>{professional.displayName}</option>)}
      </select>
      <select value={filters.tagId} onChange={event => onChange({ tagId: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-bold text-clinic-text-muted outline-none focus:border-clinic-primary">
        <option value="">Todas as etiquetas</option>
        {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
      </select>
    </div>
  );
}
