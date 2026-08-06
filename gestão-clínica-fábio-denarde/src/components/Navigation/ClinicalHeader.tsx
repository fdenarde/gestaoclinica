import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import BrandLogo from '../Common/BrandLogo';
import type { AppTheme } from '../../lib/theme';

interface ClinicalHeaderProps {
  activeLabel: string;
  clinicName?: string;
  clinicSubtitle?: string;
  theme?: AppTheme;
  currentDateLabel?: string;
  locationLabel?: string;
  userName?: string;
  userEmail?: string;
  userPhotoUrl?: string;
  onHome?: () => void;
  onOpenMobile?: () => void;
  onLogout?: () => void;
  actions?: ReactNode;
}

/** Shared visual header for the sidebar navigation mode. */
export default function ClinicalHeader({
  activeLabel,
  clinicName,
  clinicSubtitle,
  theme,
  currentDateLabel,
  locationLabel,
  userName,
  userEmail,
  userPhotoUrl,
  onHome,
  onOpenMobile,
  onLogout,
  actions,
}: ClinicalHeaderProps) {
  return (
    <header
      className="sticky top-0 z-50 flex min-h-[58px] shrink-0 items-center justify-between gap-3 bg-clinic-header px-3 py-2 text-white shadow-lg sm:px-5 lg:min-h-[66px] xl:px-7"
      data-testid="clinical-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white lg:hidden"
          aria-label="Abrir menu lateral"
        >
          <Menu size={21} />
        </button>
        <div className="min-w-0 flex-1 lg:hidden">
          <button type="button" onClick={onHome} className="block max-w-full rounded-lg text-left transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="Ir para a página inicial">
            <BrandLogo variant="mobile-header" theme={theme} name={clinicName} subtitle={clinicSubtitle} showSubtitle={false} className="max-w-full min-w-0" />
          </button>
          {activeLabel && <h1 className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.12em] text-white/80 sm:text-[11px]">{activeLabel}</h1>}
        </div>
        <div className="hidden min-w-0 lg:block">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/65">Gestão Clínica</p>
          {activeLabel && <h1 className="truncate text-base font-black sm:text-lg">{activeLabel}</h1>}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-4 xl:gap-6">
        {currentDateLabel && (
          <div className="hidden text-right md:block">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{currentDateLabel}</p>
            {locationLabel && <p className="text-xs font-medium">{locationLabel}</p>}
          </div>
        )}
        {actions}
        {(userName || userEmail) && (
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden flex-col text-right sm:flex">
              {userName && <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold uppercase tracking-wider opacity-80">{userName}</span>}
              {userEmail && <span className="max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-white/70">{userEmail}</span>}
              {onLogout && <button type="button" onClick={onLogout} className="text-xs font-bold text-clinic-nav-bg transition-colors hover:text-white">Sair</button>}
            </div>
            {userPhotoUrl && <img src={userPhotoUrl} alt="Usuário conectado" className="h-9 w-9 rounded-full border-2 border-white/20 shadow-md sm:h-10 sm:w-10" />}
          </div>
        )}
      </div>
    </header>
  );
}
