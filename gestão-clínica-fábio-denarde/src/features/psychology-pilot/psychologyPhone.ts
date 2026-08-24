import {
  formatPhoneDisplay,
  normalizePhone,
  normalizePhoneForComparison,
} from '../../../shared/phoneNormalization.js';

const PHONE_APOSTROPHES = /['’]/gu;
const PHONE_INVISIBLE = /[\u0000-\u001F\u007F\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u2066-\u2069\u3000\uFEFF]/gu;

function cleanPhoneInput(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(PHONE_APOSTROPHES, '')
    .replace(PHONE_INVISIBLE, '')
    .trim();
}

function removeBrazilianCountryCodeFromFallback(value: string): string {
  if (/^\+55(?:\D|$)/u.test(value)) return value.replace(/^\+55\s*/u, '').trim();
  return value;
}

/** Display formatter for the Psychology UI: Brazil is intentionally local. */
export function formatPsychologyPhoneDisplay(value: unknown): string {
  const raw = cleanPhoneInput(value);
  if (!raw) return '';
  try {
    return formatPhoneDisplay(raw, { defaultCountryCode: '55', includeCountryCode: false });
  } catch {
    return removeBrazilianCountryCodeFromFallback(raw);
  }
}

/** Safe controlled-input formatter: strips import residue without exposing +55. */
export function formatPsychologyPhoneInput(value: unknown): string {
  return formatPsychologyPhoneDisplay(value);
}

/** Canonical write boundary for local/synthetic Psychology persistence. */
export function normalizePsychologyPhoneForWrite(value: unknown): string {
  return normalizePhone(cleanPhoneInput(value), { defaultCountryCode: '55' }).canonicalPhone;
}

/** Canonical comparison key for complete phone values. */
export function normalizePsychologyPhoneForComparison(value: unknown): string {
  try {
    return normalizePhoneForComparison(cleanPhoneInput(value), { defaultCountryCode: '55' });
  } catch {
    return '';
  }
}

/** Search key also supports a partial, formatted phone query. */
export function normalizePsychologyPhoneForSearch(value: unknown): string {
  const raw = cleanPhoneInput(value);
  const digits = raw.replace(/\D/gu, '');
  if (digits.length < 4) return '';
  return normalizePsychologyPhoneForComparison(raw) || digits;
}
