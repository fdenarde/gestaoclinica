const PHONE_APOSTROPHES = /['’]/gu;
const PHONE_INVISIBLE = /[\u0000-\u001F\u007F\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u2066-\u2069\u3000\uFEFF]/gu;
const PHONE_FORMATTING = /[\s().,\-–—‑−/]/u;

// Used only to decide whether an explicit international prefix is plausible.
// The normalizer never guesses a country from a national-looking number.
const KNOWN_COUNTRY_CODES = new Set([
  '1', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86',
  '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '216', '218', '220', '221', '222', '223', '224',
  '225', '226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
  '241', '242', '243', '244', '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257',
  '258', '260', '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375',
  '376', '377', '378', '379', '380', '381', '382', '383', '385', '386', '387', '389', '420', '421', '423', '500',
  '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592', '593', '594', '595', '596',
  '597', '598', '599', '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683',
  '685', '686', '687', '688', '689', '690', '691', '692', '850', '852', '853', '855', '856', '880', '886', '960',
  '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977',
  '992', '993', '994', '995', '996', '998',
]);

export class PhoneNormalizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhoneNormalizationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhoneNormalizationError(code, message);
}

function rawText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function anomalyFlags(raw, cleaned) {
  const anomalies = [];
  if (raw.includes("'")) anomalies.push('ASCII_APOSTROPHE');
  if (raw.includes('’')) anomalies.push('TYPOGRAPHIC_APOSTROPHE');
  if (/[\u00A0\u202F\u2000-\u200D\u2060\u3000\uFEFF]/u.test(raw)) anomalies.push('UNICODE_SPACE_OR_INVISIBLE');
  if (cleaned.includes('++') || (cleaned.match(/\+/gu) || []).length > 1) anomalies.push('DOUBLE_PLUS');
  if (/[()\-–—‑−./\s]/u.test(cleaned)) anomalies.push('DISPLAY_MASK');
  return anomalies;
}

function cleanPhoneText(value) {
  const rawImportedPhone = rawText(value);
  const cleaned = rawImportedPhone
    .normalize('NFKC')
    .replace(PHONE_APOSTROPHES, '')
    .replace(PHONE_INVISIBLE, '')
    .trim();
  return { rawImportedPhone, cleaned, anomalies: anomalyFlags(rawImportedPhone, cleaned) };
}

function findExplicitCountryCode(digits) {
  for (const length of [3, 2, 1]) {
    const candidate = digits.slice(0, length);
    const nationalLength = digits.length - length;
    if (KNOWN_COUNTRY_CODES.has(candidate) && nationalLength >= 7 && nationalLength <= 12) return candidate;
  }
  return null;
}

function ensureCountryCode(value) {
  const code = String(value || '').replace(/\D/g, '');
  if (!KNOWN_COUNTRY_CODES.has(code)) fail('INVALID_COUNTRY_CODE', 'Código do país inválido.');
  return code;
}

function validateStructure(cleaned) {
  const withoutFormatting = [...cleaned].filter(character => !PHONE_FORMATTING.test(character)).join('');
  const plusCount = (withoutFormatting.match(/\+/gu) || []).length;
  if (plusCount > 1) fail('DOUBLE_PLUS', 'Telefone possui mais de um sinal de +.');
  if (plusCount === 1 && !withoutFormatting.startsWith('+')) fail('PLUS_POSITION', 'O sinal de + deve estar no início do telefone.');
  if (/[^\d+]/u.test(withoutFormatting)) fail('INVALID_CHARACTERS', 'Telefone possui caracteres não permitidos.');
  const digits = withoutFormatting.replace(/\D/g, '');
  if (!digits) fail('EMPTY_PHONE', 'Telefone vazio.');
  if (digits.length < 8 || digits.length > 15) fail('INVALID_LENGTH', 'Telefone fora do comprimento permitido.');
  return { digits, explicitPlus: plusCount === 1 };
}

/**
 * Removes import artifacts without changing the persisted value. The returned
 * displayPhone is safe to show; canonicalPhone is reserved for integrations.
 */
export function normalizePhone(value, { defaultCountryCode = null, requireCountryCode = false } = {}) {
  const { rawImportedPhone, cleaned, anomalies } = cleanPhoneText(value);
  const { digits, explicitPlus } = validateStructure(cleaned);
  let countryCode = null;
  let nationalNumber = digits;

  if (explicitPlus) {
    countryCode = findExplicitCountryCode(digits);
    if (!countryCode) fail('INVALID_COUNTRY_CODE', 'Não foi possível validar o código do país.');
    nationalNumber = digits.slice(countryCode.length);
  } else if (digits.startsWith('55') && /^55\d{10,11}$/.test(digits)) {
    countryCode = '55';
    nationalNumber = digits.slice(2);
  } else if ((digits.length > 11 || (digits.length === 11 && digits.startsWith('1'))) && findExplicitCountryCode(digits)) {
    // Digits-only canonical international values are accepted when their
    // length removes the ambiguity with a Brazilian national number.
    countryCode = findExplicitCountryCode(digits);
    if (countryCode) nationalNumber = digits.slice(countryCode.length);
  } else if (defaultCountryCode) {
    countryCode = ensureCountryCode(defaultCountryCode);
    if (countryCode === '55' && !/^\d{10,11}$/.test(digits)) fail('INVALID_BRAZILIAN_NATIONAL_NUMBER', 'Telefone brasileiro deve conter DDD e número válidos.');
    nationalNumber = digits;
  }

  if (requireCountryCode && !countryCode) fail('MISSING_COUNTRY_CODE', 'Telefone sem country code explícito ou configurado.');
  if (nationalNumber.length < 7 || nationalNumber.length > 12) fail('INVALID_NATIONAL_NUMBER', 'Número nacional fora do comprimento permitido.');

  const canonicalPhone = countryCode ? `${countryCode}${nationalNumber}` : digits;
  return {
    rawImportedPhone,
    displayPhone: cleaned,
    canonicalPhone,
    canonicalDigits: canonicalPhone,
    countryCode,
    nationalNumber,
    countryCodeResolved: Boolean(countryCode),
    missingCountryCode: !countryCode,
    anomalies,
    whatsappRecipientId: countryCode ? canonicalPhone : null,
    metaRecipientId: countryCode ? canonicalPhone : null,
  };
}

export function normalizePhoneForIntegration(value, options = {}) {
  const result = normalizePhone(value, { ...options, requireCountryCode: true });
  if (result.canonicalPhone.length < 8 || result.canonicalPhone.length > 15) fail('INVALID_E164_LENGTH', 'Telefone não atende ao comprimento internacional.');
  return result;
}

export function normalizePhoneForComparison(value, { defaultCountryCode = '55' } = {}) {
  return normalizePhone(value, { defaultCountryCode, requireCountryCode: false }).canonicalPhone;
}

export function normalizeMetaPhoneRecipient(value) {
  return normalizePhoneForIntegration(value);
}

export function buildWhatsappClickToChatUrl(value, { defaultCountryCode = '55', text = '' } = {}) {
  try {
    const normalized = normalizePhoneForIntegration(value, { defaultCountryCode });
    const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
    return `https://wa.me/${normalized.canonicalPhone}${suffix}`;
  } catch {
    return null;
  }
}

export function formatPhoneDisplay(value, { defaultCountryCode = '55', includeCountryCode = true } = {}) {
  const normalized = normalizePhone(value, { defaultCountryCode });
  if (normalized.countryCode === '55' && /^\d{10,11}$/.test(normalized.nationalNumber)) {
    const national = normalized.nationalNumber;
    const local = national.length === 11
      ? `${national.slice(2, 7)}-${national.slice(7)}`
      : `${national.slice(2, 6)}-${national.slice(6)}`;
    return includeCountryCode ? `+55 (${national.slice(0, 2)}) ${local}` : `(${national.slice(0, 2)}) ${local}`;
  }
  return normalized.countryCode ? `+${normalized.countryCode} ${normalized.nationalNumber}` : normalized.displayPhone;
}
