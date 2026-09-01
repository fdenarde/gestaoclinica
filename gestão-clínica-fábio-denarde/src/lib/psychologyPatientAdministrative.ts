import { normalizePhone } from '../../shared/phoneNormalization.js';

export interface PsychologyAdministrativeResponsible {
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
}

export type PsychologyPatientAdministrativeField = 'name' | 'dateOfBirth' | 'phone' | 'email' | 'responsible.fullName' | 'responsible.relationship' | 'responsible.phone' | 'responsible.email';

export interface PsychologyPatientProfileCompleteness {
  complete: boolean;
  missingFields: PsychologyPatientAdministrativeField[];
  requiresResponsible: boolean;
}

export interface PsychologyPatientAdministrativeInput {
  name: string;
  dateOfBirth?: string;
  phone: string;
  email?: string;
  administrativeResponsible?: Partial<PsychologyAdministrativeResponsible>;
}

function civilParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isValidPhoneInput(value: unknown): boolean {
  try {
    normalizePhone(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidCivilDate(value: string): boolean {
  const parts = civilParts(value);
  if (!parts) return false;
  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function civilDateFromDate(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function calculateAgeOnDate(dateOfBirth: string, referenceCivilDate: string): number | null {
  if (!isValidCivilDate(dateOfBirth) || !isValidCivilDate(referenceCivilDate)) return null;
  const birth = civilParts(dateOfBirth)!;
  const reference = civilParts(referenceCivilDate)!;
  let age = reference[0] - birth[0];
  if (reference[1] < birth[1] || (reference[1] === birth[1] && reference[2] < birth[2])) age -= 1;
  return age >= 0 ? age : null;
}

export function requiresResponsible(dateOfBirth: string, appointmentCivilDate: string): boolean {
  const age = calculateAgeOnDate(dateOfBirth, appointmentCivilDate);
  return age !== null && age < 18;
}

export function isCompleteAdministrativeResponsible(value: Partial<PsychologyAdministrativeResponsible> | undefined): value is PsychologyAdministrativeResponsible {
  const phone = String(value?.phone || '').trim();
  const email = String(value?.email || '').trim();
  return Boolean(value && (!phone || isValidPhoneInput(phone)) && (!email || /^\S+@\S+\.\S+$/.test(email)));
}

export function profileCompleteness(input: {
  name?: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  administrativeResponsible?: Partial<PsychologyAdministrativeResponsible>;
}, referenceCivilDate: string): PsychologyPatientProfileCompleteness {
  const missingFields: PsychologyPatientAdministrativeField[] = [];
  if (!String(input.name || '').trim()) missingFields.push('name');
  const dateOfBirth = String(input.dateOfBirth || '').trim();
  if (dateOfBirth && !isValidCivilDate(dateOfBirth)) missingFields.push('dateOfBirth');
  if (!isValidPhoneInput(input.phone)) missingFields.push('phone');
  const email = String(input.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) missingFields.push('email');
  const responsibleRequired = false;
  const responsibleHasData = Boolean(input.administrativeResponsible && Object.values(input.administrativeResponsible).some(value => String(value || '').trim()));
  if (responsibleHasData) {
    const responsiblePhone = String(input.administrativeResponsible?.phone || '').trim();
    const responsibleEmail = String(input.administrativeResponsible?.email || '').trim();
    if (responsiblePhone && !isValidPhoneInput(responsiblePhone)) missingFields.push('responsible.phone');
    if (responsibleEmail && !/^\S+@\S+\.\S+$/.test(responsibleEmail)) missingFields.push('responsible.email');
  }
  return { complete: missingFields.length === 0, missingFields, requiresResponsible: responsibleRequired };
}

export function validateDateOfBirth(dateOfBirth: string, referenceCivilDate: string): string | null {
  if (!String(dateOfBirth || '').trim()) return 'Informe a data de nascimento.';
  if (!isValidCivilDate(dateOfBirth)) return 'Informe uma data de nascimento válida.';
  if (!isValidCivilDate(referenceCivilDate)) return 'Não foi possível validar a data de referência.';
  if (dateOfBirth > referenceCivilDate) return 'A data de nascimento não pode ser futura.';
  return null;
}

export function validateAdministrativeResponsible(value: Partial<PsychologyAdministrativeResponsible> | undefined): Partial<Record<keyof PsychologyAdministrativeResponsible, string>> {
  const errors: Partial<Record<keyof PsychologyAdministrativeResponsible, string>> = {};
  const phone = String(value?.phone || '').trim();
  const email = String(value?.email || '').trim();
  if (phone && !isValidPhoneInput(phone)) errors.phone = 'Informe um telefone válido para o responsável.';
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Informe um e-mail válido para o responsável.';
  return errors;
}

export function validatePsychologyPatientAdministrativeInput(input: PsychologyPatientAdministrativeInput, referenceCivilDate: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!String(input.name || '').trim()) errors.name = 'Informe o nome completo do paciente.';
  const dateOfBirth = String(input.dateOfBirth || '').trim();
  if (dateOfBirth) {
    const dateError = validateDateOfBirth(dateOfBirth, referenceCivilDate);
    if (dateError) errors.dateOfBirth = dateError;
  }
  if (!isValidPhoneInput(input.phone)) errors.phone = 'Informe um telefone válido.';
  const email = String(input.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Informe um e-mail válido.';
  const responsibleHasData = Boolean(input.administrativeResponsible && Object.values(input.administrativeResponsible).some(value => String(value || '').trim()));
  if (responsibleHasData) {
    const responsibleErrors = validateAdministrativeResponsible(input.administrativeResponsible);
    Object.entries(responsibleErrors).forEach(([field, message]) => { errors[`administrativeResponsible.${field}`] = message; });
  }
  return errors;
}
