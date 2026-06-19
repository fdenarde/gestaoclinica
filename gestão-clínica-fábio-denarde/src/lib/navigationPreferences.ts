export type NavigationMode = 'sidebar' | 'top';

export const NAVIGATION_MODE_STORAGE_KEY = 'gestao-clinica:navigation-mode';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'gestao-clinica:sidebar-collapsed';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadNavigationMode(): NavigationMode {
  const stored = getStorage()?.getItem(NAVIGATION_MODE_STORAGE_KEY);
  return stored === 'top' ? 'top' : 'sidebar';
}

export function storeNavigationMode(mode: NavigationMode): void {
  getStorage()?.setItem(NAVIGATION_MODE_STORAGE_KEY, mode);
}

export function loadSidebarCollapsed(): boolean {
  return getStorage()?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  getStorage()?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
}
