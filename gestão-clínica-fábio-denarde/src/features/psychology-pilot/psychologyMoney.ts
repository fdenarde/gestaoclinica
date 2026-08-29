const psychologyCurrency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function numericFromText(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^0-9,.-]/g, '');
  if (!compact || !/[0-9]/.test(compact)) return null;
  const sign = compact.startsWith('-') ? -1 : 1;
  const unsigned = compact.replace(/-/g, '');
  const commaIndex = unsigned.lastIndexOf(',');
  const dotIndex = unsigned.lastIndexOf('.');
  let normalized: string;
  if (commaIndex >= 0) {
    normalized = `${unsigned.slice(0, commaIndex).replace(/[.]/g, '')}.${unsigned.slice(commaIndex + 1).replace(/[,]/g, '')}`;
  } else if (dotIndex >= 0 && unsigned.indexOf('.') !== dotIndex) {
    normalized = unsigned.replace(/[.]/g, '');
  } else if (dotIndex >= 0 && unsigned.slice(dotIndex + 1).length === 3 && unsigned.slice(0, dotIndex).length <= 3) {
    normalized = unsigned.replace('.', '');
  } else {
    normalized = unsigned;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100 * sign;
}

/** Converts typed, pasted, Brazilian, or existing numeric values to cents-safe BRL numbers. */
export function parsePsychologyMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value === 'string') return numericFromText(value);
  return null;
}

export function formatPsychologyMoneyInput(value: unknown): string {
  const parsed = parsePsychologyMoney(value);
  return parsed === null ? '' : psychologyCurrency.format(Math.max(0, parsed));
}

export function formatPsychologyMoney(value: unknown): string {
  const parsed = parsePsychologyMoney(value) ?? 0;
  return psychologyCurrency.format(Math.max(0, parsed));
}
