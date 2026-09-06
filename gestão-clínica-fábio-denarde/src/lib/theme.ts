export const APP_THEMES = [
  {
    id: 'current',
    name: 'Atual',
    description: 'Mantém a identidade visual original do sistema.',
    isDefault: true,
    preview: ['#F5EDE3', '#5C3D2E', '#C4603A', '#FFFAF7'],
  },
  {
    id: 'calm-tech',
    name: 'Calm & Tech',
    description: 'Visual moderno com foco em organização, confiança e tecnologia.',
    isDefault: false,
    preview: ['#F4F7F9', '#2B5B84', '#2B5B84', '#FFFFFF'],
  },
  {
    id: 'health-balance',
    name: 'Saúde & Equilíbrio',
    description: 'Identidade leve inspirada em saúde, cuidado e bem-estar.',
    isDefault: false,
    preview: ['#F5FAF8', '#1E7B56', '#1E7B56', '#FFFFFF'],
  },
  {
    id: 'soft-welcome',
    name: 'Acolhimento Suave',
    description: 'Ambiente acolhedor com tons neutros, nude e terracota.',
    isDefault: false,
    preview: ['#FAF7F4', '#795548', '#9E6D54', '#FFFCFA'],
  },
] as const;

export type AppTheme = (typeof APP_THEMES)[number]['id'];

export type VisualContext = 'DEFAULT' | 'PSICOLOGIA';

export const DEFAULT_APP_THEME: AppTheme = 'current';
export const THEME_STORAGE_KEY = 'fabio_denarde_visual_theme';

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && APP_THEMES.some(theme => theme.id === value);
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function readStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null;

  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(savedTheme) ? savedTheme : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: AppTheme): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The visual preference still applies for the current session.
  }
}

export function resolveTheme(
  settingsTheme?: unknown,
  localTheme: AppTheme | null = readStoredTheme(),
): AppTheme {
  if (isAppTheme(settingsTheme)) return settingsTheme;
  return localTheme ?? DEFAULT_APP_THEME;
}

export function initializeTheme(): AppTheme {
  const theme = resolveTheme(undefined);
  applyTheme(theme);
  return theme;
}
