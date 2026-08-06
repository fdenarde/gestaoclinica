import { CalendarDays, FileText, MessageCircle, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SimulationView } from '../simulationTypes';

interface NavigationItem {
  label: string;
  icon: LucideIcon;
  view: Extract<SimulationView, 'my_whatsapp' | 'new_message' | 'schedules' | 'ready_messages'>;
}

const items: NavigationItem[] = [
  { label: 'Meu WhatsApp', icon: Smartphone, view: 'my_whatsapp' },
  { label: 'Nova mensagem', icon: MessageCircle, view: 'new_message' },
  { label: 'Agendadas', icon: CalendarDays, view: 'schedules' },
  { label: 'Mensagens prontas', icon: FileText, view: 'ready_messages' },
];

interface SimulationNavigationProps {
  activeView: SimulationView;
  onNavigate: (view: SimulationView) => void;
}

export function SimulationNavigation({ activeView, onNavigate }: SimulationNavigationProps) {
  return (
    <nav aria-label="Áreas do WhatsApp" className="overflow-x-auto px-4 sm:px-5" data-testid="simple-simulation-navigation">
      <div className="flex min-w-max border-b border-clinic-border">
        {items.map(({ label, icon: Icon, view }) => {
          const selected = activeView === view;
          return (
            <button
              key={view}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onNavigate(view)}
              className={selected
                ? 'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 border-clinic-primary bg-clinic-primary/5 px-3 py-2 text-xs font-black text-clinic-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40 sm:px-4'
                : 'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-3 py-2 text-xs font-bold text-clinic-text-muted transition hover:bg-clinic-bg/70 hover:text-clinic-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40 sm:px-4'}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
