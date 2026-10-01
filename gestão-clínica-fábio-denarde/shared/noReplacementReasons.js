export const NO_REPLACEMENT_PORTAL_REASON = 'Aviso tardio ou cancelamento fora do prazo';
export const NO_REPLACEMENT_DEFAULT_NOTE = 'Ausência registrada após aviso tardio.';

export const NO_REPLACEMENT_REASON_OPTIONS = Object.freeze([
  {
    code: 'late_notice_or_out_of_policy_cancellation',
    label: NO_REPLACEMENT_PORTAL_REASON,
    defaultObservation: NO_REPLACEMENT_DEFAULT_NOTE,
    requiresObservation: false,
  },
  { code: 'no_show_without_notice', label: 'Ausência sem aviso', defaultObservation: '', requiresObservation: false },
  { code: 'contractual_no_replacement', label: 'Outro motivo previsto no contrato', defaultObservation: '', requiresObservation: true },
  { code: 'notice_in_advance', label: 'Aviso com antecedência', defaultObservation: '', requiresObservation: false },
  { code: 'late_notice', label: 'Aviso tardio', defaultObservation: 'Aviso registrado fora do prazo habitual.', requiresObservation: false },
  { code: 'same_day_cancellation', label: 'Cancelamento no mesmo dia', defaultObservation: 'Cancelamento registrado no mesmo dia.', requiresObservation: false },
  { code: 'health_issue', label: 'Problema de saúde', defaultObservation: '', requiresObservation: false },
  { code: 'family_emergency', label: 'Emergência familiar', defaultObservation: '', requiresObservation: false },
  { code: 'transportation_issue', label: 'Problema de transporte', defaultObservation: '', requiresObservation: false },
  { code: 'school_commitment', label: 'Compromisso escolar', defaultObservation: '', requiresObservation: false },
  { code: 'professional_commitment', label: 'Compromisso profissional', defaultObservation: '', requiresObservation: false },
  { code: 'travel', label: 'Viagem', defaultObservation: '', requiresObservation: false },
  { code: 'schedule_conflict', label: 'Conflito de agenda', defaultObservation: '', requiresObservation: false },
  { code: 'online_technical_issue', label: 'Problema técnico no atendimento online', defaultObservation: '', requiresObservation: false },
  { code: 'professional_absence', label: 'Falta do profissional', defaultObservation: 'Ausência do profissional registrada.', requiresObservation: false },
  { code: 'clinic_cancellation', label: 'Cancelamento pela clínica', defaultObservation: 'Cancelamento registrado pela clínica.', requiresObservation: false },
  { code: 'prior_agreement', label: 'Acordo prévio', defaultObservation: 'Ausência previamente acordada.', requiresObservation: false },
  { code: 'exceptionally_justified', label: 'Outro motivo excepcionalmente justificado', defaultObservation: '', requiresObservation: true },
  { code: 'reason_not_informed', label: 'Motivo não informado', defaultObservation: '', requiresObservation: false },
  { code: 'other', label: 'Outro', defaultObservation: '', requiresObservation: true },
]);

export function getNoReplacementReasonLabel(code, fallback = '') {
  return NO_REPLACEMENT_REASON_OPTIONS.find(option => option.code === code)?.label
    || fallback
    || NO_REPLACEMENT_PORTAL_REASON;
}

const LEGACY_ACTIVITY_REASON_TO_CANONICAL = Object.freeze({
  professional_opted_out: 'professional_absence',
  technical_issue: 'online_technical_issue',
  other: 'other',
});

export function mapLegacyActivityReasonToCanonical(value) {
  return LEGACY_ACTIVITY_REASON_TO_CANONICAL[String(value || '').trim()] || 'other';
}

export function buildCanonicalAbsencePatch(session = {}, {
  reasonCode = 'other',
  observation = '',
  changedAt = new Date().toISOString(),
  changedBy = 'Profissional',
  status = 'late_cancellation_no_replacement',
} = {}) {
  const normalizedReasonCode = String(reasonCode || 'other').trim() || 'other';
  const reasonText = getNoReplacementReasonLabel(normalizedReasonCode);
  const normalizedObservation = String(observation || '').trim();
  return {
    status,
    consumesPackage: session?.consumesPackage !== false,
    packageConsumptionDecidedAt: session?.packageConsumptionDecidedAt || changedAt,
    packageConsumptionDecidedBy: session?.packageConsumptionDecidedBy || changedBy,
    noReplacementReasonCode: normalizedReasonCode,
    noReplacementReasonText: reasonText,
    noReplacementObservation: normalizedObservation,
    noReplacementRecordedAt: changedAt,
    noReplacementRecordedBy: changedBy,
    noReplacementHistory: [
      ...(Array.isArray(session?.noReplacementHistory) ? session.noReplacementHistory : []),
      {
        previousStatus: session?.status || 'Realizada',
        newStatus: status,
        reasonCode: normalizedReasonCode,
        reasonText,
        observation: normalizedObservation,
        changedAt,
        changedBy,
        consumesPackage: session?.consumesPackage !== false,
        packageConsumptionDecidedAt: session?.packageConsumptionDecidedAt || changedAt,
        packageConsumptionDecidedBy: session?.packageConsumptionDecidedBy || changedBy,
      },
    ],
  };
}
