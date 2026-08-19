export const CLINICAL_TIME_ZONE = 'America/Sao_Paulo';

const CLINICAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getSaoPauloDateKey(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return CLINICAL_DATE_FORMATTER.format(parsed);
}

export const getClinicalDateKey = getSaoPauloDateKey;
