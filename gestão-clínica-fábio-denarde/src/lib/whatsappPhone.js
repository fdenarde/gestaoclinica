import {
  buildWhatsappClickToChatUrl,
  formatPhoneDisplay,
  normalizePhone,
  normalizePhoneForIntegration,
} from '../../shared/phoneNormalization.js';

export { buildWhatsappClickToChatUrl, formatPhoneDisplay, normalizePhone, normalizePhoneForIntegration };

export function extractPhoneDigits(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u2066-\u2069\u3000\uFEFF]/gu, '')
    .replace(/['’]/gu, '')
    .replace(/\D/g, '');
}

export function normalizeBrazilianWhatsappPhone(value, { requiredAreaCode = '27' } = {}) {
  const normalized = normalizePhoneForIntegration(value, { defaultCountryCode: '55' });
  if (normalized.countryCode !== '55' || !/^\d{10,11}$/.test(normalized.nationalNumber)) {
    throw new Error('Telefone brasileiro inválido.');
  }
  if (requiredAreaCode && !normalized.nationalNumber.startsWith(requiredAreaCode)) {
    throw new Error(`DDD autorizado inválido. Esperado: ${requiredAreaCode}.`);
  }
  return {
    ...normalized,
    digits: normalized.canonicalPhone,
    nationalDigits: normalized.nationalNumber,
    chatId: `${normalized.canonicalPhone}@c.us`,
    maskedShort: maskPhoneShort(normalized.nationalNumber),
    maskedDisplay: maskBrazilianPhone(normalized.nationalNumber),
  };
}

export function maskPhoneShort(value) {
  const digits = extractPhoneDigits(value);
  if (!digits) return '(sem telefone)';
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}

export function maskBrazilianPhone(value) {
  const digits = extractPhoneDigits(value);
  const national = digits.startsWith('55') ? digits.slice(2) : digits;
  if (national.length < 4) return '***';
  const ddd = national.length >= 10 ? national.slice(0, 2) : '**';
  return `(${ddd}) *****-${national.slice(-4)}`;
}
