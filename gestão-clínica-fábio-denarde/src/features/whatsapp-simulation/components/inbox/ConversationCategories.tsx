import { CalendarClock, CheckCircle2, CircleAlert, Inbox, MessageCircle, UsersRound } from 'lucide-react';
import type { SimulationCategory } from '../../simulationTypes';

interface ConversationCategoriesProps {
  activeCategory: SimulationCategory;
  counts: Record<SimulationCategory, number>;
  onChange: (category: SimulationCategory) => void;
}

const categories: Array<{ id: SimulationCategory; label: string; icon: typeof Inbox }> = [
  { id: 'all', label: 'Todas', icon: Inbox },
  { id: 'unread', label: 'Não lidas', icon: MessageCircle },
  { id: 'awaiting_team', label: 'Aguardando equipe', icon: UsersRound },
  { id: 'awaiting_contact', label: 'Aguardando contato', icon: MessageCircle },
  { id: 'scheduled', label: 'Agendadas', icon: CalendarClock },
  { id: 'failed', label: 'Falhas', icon: CircleAlert },
  { id: 'finished', label: 'Finalizadas', icon: CheckCircle2 },
];

export function ConversationCategories({ activeCategory, counts, onChange }: ConversationCategoriesProps) {
  return (
    <div className="space-y-1">
      <p className="px-2 text-[10px] font-black uppercase tracking-[0.16em] text-clinic-text-faint">Categorias</p>
      {categories.map(category => {
        const Icon = category.icon;
        const active = activeCategory === category.id;
        return (
          <button key={category.id} type="button" onClick={() => onChange(category.id)} className={active ? 'flex w-full items-center justify-between rounded-xl bg-clinic-primary/10 px-3 py-2.5 text-left text-xs font-black text-clinic-primary' : 'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold text-clinic-text-muted transition hover:bg-clinic-bg'}>
            <span className="flex items-center gap-2"><Icon size={15} /> {category.label}</span>
            <span className={active ? 'rounded-full bg-clinic-primary px-2 py-0.5 text-[10px] font-black text-white' : 'rounded-full bg-clinic-bg px-2 py-0.5 text-[10px] font-black text-clinic-text-muted'}>{counts[category.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
