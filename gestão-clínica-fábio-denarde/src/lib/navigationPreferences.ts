export type NavigationMode = 'sidebar' | 'top';

export const NAVIGATION_MODE_STORAGE_KEY = 'gestao-clinica:navigation-mode';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'gestao-clinica:sidebar-collapsed';

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadNavigationMode(): NavigationMode {
  const stored = getLocalStorage()?.getItem(NAVIGATION_MODE_STORAGE_KEY);
  return stored === 'top' ? 'top' : 'sidebar';
}

export function storeNavigationMode(mode: NavigationMode): void {
  getLocalStorage()?.setItem(NAVIGATION_MODE_STORAGE_KEY, mode);
}

export function loadSidebarCollapsed(): boolean {
  return getSessionStorage()?.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  getSessionStorage()?.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
}
