import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
} from 'lucide-react';
import BrandLogo from '../Common/BrandLogo';
import type { AppTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';

export interface AppNavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  badgeTone?: 'danger' | 'warning';
}

interface SidebarNavigationProps {
  items: AppNavigationItem[];
  activeId: string;
  collapsed: boolean;
  mobileOpen: boolean;
  clinicName?: string;
  clinicSubtitle?: string;
  theme?: AppTheme;
  userName?: string | null;
  userEmail?: string | null;
  userPhotoUrl?: string | null;
  onSelect: (id: string) => void;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
}

const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Principal', ids: ['dashboard', 'agenda', 'agenda-pessoal'] },
  { label: 'Atendimento', ids: ['atendentes', 'galeria-atividades', 'pre-cadastros'] },
  { label: 'Gestão', ids: ['pagamentos', 'relatorios'] },
  { label: 'Sistema', ids: ['ajustes'] },
];

function SidebarBody({
  items,
  activeId,
  collapsed,
  clinicName,
  clinicSubtitle,
  theme,
  userName,
  userEmail,
  userPhotoUrl,
  onSelect,
  onToggleCollapsed,
  onCloseMobile,
  onLogout,
  mobile,
}: SidebarNavigationProps & { mobile: boolean }) {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const effectiveCollapsed = mobile ? false : collapsed;
  const displayName = userName || userEmail || 'Usuário';
  const avatar = userPhotoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-clinic-border-dark bg-clinic-nav-bg text-clinic-text shadow-xl transition-[width] duration-200',
        effectiveCollapsed ? 'w-[76px]' : 'w-[380px]',
      )}
      aria-label="Menu principal"
    >
      <div
        className={cn(
          'flex min-h-[88px] items-center border-b border-white/15 bg-clinic-header px-3 text-white shadow-sm',
          effectiveCollapsed ? 'justify-center' : 'justify-between gap-2',
        )}
      >
        {effectiveCollapsed ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 text-white shadow-sm ring-1 ring-white/20" title={clinicName || 'Gestão Clínica'}>
            <BrainCircuit size={27} />
          </div>
        ) : (
          <BrandLogo
            variant="horizontal"
            theme={theme}
            name={clinicName}
            subtitle={clinicSubtitle}
            className="min-w-0 flex-1 whitespace-nowrap"
          />
        )}
        {mobile ? (
          <button type="button" onClick={onCloseMobile} className="rounded-xl p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Fechar menu lateral">
            <X size={20} />
          </button>
        ) : !effectiveCollapsed ? (
          <button type="button" onClick={onToggleCollapsed} className="rounded-xl p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Recolher menu lateral" title="Recolher menu">
            <ChevronLeft size={19} />
          </button>
        ) : null}
      </div>

      <nav className="custom-scrollbar flex-1 overflow-y-auto px-2 py-4">
        {GROUPS.map(group => {
          const groupItems = group.ids.map(id => itemMap.get(id)).filter(Boolean) as AppNavigationItem[];
          if (groupItems.length === 0) return null;
          return (
            <section key={group.label} className="mb-4 last:mb-0">
              {!effectiveCollapsed && (
                <p className="mb-1.5 px-3 text-[9px] font-black uppercase tracking-[0.18em] text-clinic-text-faint">
                  {group.label}
                </p>
              )}
              {effectiveCollapsed && <div className="mx-3 mb-2 border-t border-clinic-border-dark/70" aria-hidden="true" />}
              <div className="space-y-1">
                {groupItems.map(item => {
                  const active = item.id === activeId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      title={effectiveCollapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex w-full items-center rounded-xl py-2.5 text-left text-xs font-black uppercase tracking-wide transition-colors',
                        effectiveCollapsed ? 'justify-center px-2' : 'gap-3 px-3',
                        active
                          ? 'bg-clinic-surface text-clinic-header shadow-sm'
                          : 'text-clinic-text-muted hover:bg-clinic-bg/70 hover:text-clinic-text',
                      )}
                    >
                      <item.icon size={18} className={cn('shrink-0', active && 'text-clinic-primary')} />
                      {!effectiveCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      {!!item.badge && (
                        <span className={cn(
                          'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black text-white',
                          effectiveCollapsed && 'absolute right-1 top-1',
                          item.badgeTone === 'danger' ? 'bg-status-red-text' : 'bg-status-orange-text',
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      <footer className="border-t border-clinic-border-dark p-2.5">
        <div className={cn('rounded-2xl bg-clinic-surface/80 p-2', effectiveCollapsed ? 'space-y-2' : 'flex items-center gap-2.5')}>
          <img src={avatar} alt="Usuário conectado" className="h-10 w-10 shrink-0 rounded-full border-2 border-clinic-border object-cover" />
          {!effectiveCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-clinic-text">{displayName}</p>
              <p className="truncate text-[10px] text-clinic-text-muted">{userEmail || 'Acesso profissional'}</p>
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            title="Sair"
            aria-label="Sair do sistema"
            className={cn('flex items-center justify-center rounded-xl text-status-red-text hover:bg-status-red-bg', effectiveCollapsed ? 'h-10 w-10' : 'h-9 w-9')}
          >
            <LogOut size={17} />
          </button>
        </div>
        {!mobile && effectiveCollapsed && (
          <button type="button" onClick={onToggleCollapsed} className="mt-2 flex w-full items-center justify-center rounded-xl py-2 text-clinic-primary hover:bg-clinic-bg" aria-label="Expandir menu lateral" title="Expandir menu">
            <ChevronRight size={19} />
          </button>
        )}
      </footer>
    </aside>
  );
}

export default function SidebarNavigation(props: SidebarNavigationProps) {
  return (
    <>
      <div className={cn('fixed inset-y-0 left-0 z-[70] hidden lg:block', props.collapsed ? 'w-[76px]' : 'w-[380px]')}>
        <SidebarBody {...props} mobile={false} />
      </div>
      {props.mobileOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu lateral">
          <button type="button" onClick={props.onCloseMobile} className="absolute inset-0 bg-black/55 backdrop-blur-sm" aria-label="Fechar menu" />
          <div className="relative h-full w-[min(92vw,380px)]">
            <SidebarBody {...props} mobile />
          </div>
        </div>
      )}
    </>
  );
}
