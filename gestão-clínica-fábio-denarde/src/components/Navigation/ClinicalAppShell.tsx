import type { ReactNode } from 'react';
import SidebarNavigation, { type AppNavigationItem } from './SidebarNavigation';
import ClinicalHeader from './ClinicalHeader';
import type { AppTheme } from '../../lib/theme';

interface ClinicalAppShellProps {
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
  activeLabel: string;
  currentDateLabel: string;
  locationLabel?: string;
  headerActions?: ReactNode;
  onSelect: (id: string) => void;
  onHome: () => void;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
  children: ReactNode;
}

/** Shell visual compartilhado pelas rotas em modo sidebar. */
export default function ClinicalAppShell({
  items,
  activeId,
  collapsed,
  mobileOpen,
  clinicName,
  clinicSubtitle,
  theme,
  userName,
  userEmail,
  userPhotoUrl,
  activeLabel,
  currentDateLabel,
  locationLabel,
  headerActions,
  onSelect,
  onHome,
  onToggleCollapsed,
  onOpenMobile,
  onCloseMobile,
  onLogout,
  children,
}: ClinicalAppShellProps) {
  return (
    <div className="min-h-screen bg-clinic-bg" data-testid="clinical-app-shell">
      <SidebarNavigation
        items={items}
        activeId={activeId}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        clinicName={clinicName}
        clinicSubtitle={clinicSubtitle}
        theme={theme}
        userName={userName}
        userEmail={userEmail}
        userPhotoUrl={userPhotoUrl}
        onSelect={onSelect}
        onHome={onHome}
        onToggleCollapsed={onToggleCollapsed}
        onCloseMobile={onCloseMobile}
        onLogout={onLogout}
      />
      <div className={`min-h-screen flex flex-col pb-10 transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-[320px]'}`}>
        <ClinicalHeader
          activeLabel={activeLabel}
          clinicName={clinicName}
          clinicSubtitle={clinicSubtitle}
          theme={theme}
          currentDateLabel={currentDateLabel}
          locationLabel={locationLabel}
          userName={userName}
          userEmail={userEmail}
          userPhotoUrl={userPhotoUrl}
          onOpenMobile={onOpenMobile}
          onHome={onHome}
          onLogout={onLogout}
          actions={headerActions}
        />
        <main className="app-main flex-1 w-full mx-auto px-3 sm:px-4 lg:px-5 xl:px-6 2xl:px-8 overflow-x-hidden relative">
          {children}
        </main>
      </div>
    </div>
  );
}
