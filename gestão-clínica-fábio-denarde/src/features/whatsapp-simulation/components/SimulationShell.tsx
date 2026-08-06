import type { ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { SimulationHeader } from './SimulationHeader';
import { SimulationNavigation } from './SimulationNavigation';
import './simulationTheme.css';
import type { SimulationState, SimulationView } from '../simulationTypes';

interface SimulationShellProps {
  state: SimulationState;
  connected: boolean;
  onReset: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onNavigate: (view: SimulationView) => void;
  embedded?: boolean;
  children: ReactNode;
}

export function SimulationShell({ state, connected, onReset, onConnect, onDisconnect, onNavigate, children }: SimulationShellProps) {
  return (
    <section className="flex w-full flex-col gap-6 pb-24" data-testid="whatsapp-simulation-dashboard">
      <SimulationHeader connected={connected} onReset={onReset} onConnect={onConnect} onDisconnect={onDisconnect} />
      <section className="clinic-card overflow-hidden shadow-clinic" data-testid="simple-messages-card">
        <header className="flex items-start gap-3 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-clinic-primary/10 text-clinic-primary" aria-hidden="true"><MessageCircle size={20} /></span>
          <div><h2 className="text-lg font-black text-clinic-text sm:text-xl">Mensagens e agendamentos</h2><p className="mt-1 text-sm text-clinic-text-muted">Crie, agende e acompanhe mensagens.</p></div>
        </header>
        <SimulationNavigation activeView={state.activeView} onNavigate={onNavigate} />
        <div className="border-t border-clinic-border p-4 sm:p-5">
          <p className="rounded-xl border border-status-blue-text/20 bg-status-blue-bg px-4 py-3 text-sm font-semibold text-status-blue-text" role="note" data-testid="simulation-notice">Ambiente de demonstração — nenhuma mensagem será enviada.</p>
          {state.notice && <p className="mt-4 rounded-xl border border-status-orange-text/25 bg-status-orange-bg px-4 py-3 text-sm font-semibold text-status-orange-text" role="status">{state.notice}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </section>
    </section>
  );
}
