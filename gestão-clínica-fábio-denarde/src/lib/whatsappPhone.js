export function extractPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeBrazilianWhatsappPhone(value, { requiredAreaCode = '27' } = {}) {
  let digits = extractPhoneDigits(value);
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

  if (digits.startsWith('55')) {
    const national = digits.slice(2);
    if (!/^\d{10,11}$/.test(national)) {
      throw new Error('Telefone brasileiro inválido.');
    }
    if (requiredAreaCode && !national.startsWith(requiredAreaCode)) {
      throw new Error(`DDD autorizado inválido. Esperado: ${requiredAreaCode}.`);
    }
    return {
      digits: `55${national}`,
      nationalDigits: national,
      chatId: `55${national}@c.us`,
      maskedShort: maskPhoneShort(national),
      maskedDisplay: maskBrazilianPhone(national),
    };
  }

  if (!/^\d{10,11}$/.test(digits)) {
    throw new Error('Telefone brasileiro inválido.');
  }
  if (requiredAreaCode && !digits.startsWith(requiredAreaCode)) {
    throw new Error(`DDD autorizado inválido. Esperado: ${requiredAreaCode}.`);
  }

  return {
    digits: `55${digits}`,
    nationalDigits: digits,
    chatId: `55${digits}@c.us`,
    maskedShort: maskPhoneShort(digits),
    maskedDisplay: maskBrazilianPhone(digits),
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
