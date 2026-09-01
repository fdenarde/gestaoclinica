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
  return Boolean(value
    && String(value.fullName || '').trim()
    && String(value.relationship || '').trim()
    && isValidPhoneInput(value.phone)
    && /^\S+@\S+\.\S+$/.test(String(value.email || '').trim()));
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
  const responsibleRequired = requiresResponsible(dateOfBirth, referenceCivilDate);
  if (responsibleRequired) {
    if (!String(input.administrativeResponsible?.fullName || '').trim()) missingFields.push('responsible.fullName');
    if (!String(input.administrativeResponsible?.relationship || '').trim()) missingFields.push('responsible.relationship');
    if (!isValidPhoneInput(input.administrativeResponsible?.phone)) missingFields.push('responsible.phone');
    if (!/^\S+@\S+\.\S+$/.test(String(input.administrativeResponsible?.email || '').trim())) missingFields.push('responsible.email');
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
  if (!String(value?.fullName || '').trim()) errors.fullName = 'Informe o nome completo do responsável.';
  if (!String(value?.relationship || '').trim()) errors.relationship = 'Informe o vínculo ou parentesco.';
  if (!isValidPhoneInput(value?.phone)) errors.phone = 'Informe um telefone válido para o responsável.';
  if (!/^\S+@\S+\.\S+$/.test(String(value?.email || '').trim())) errors.email = 'Informe um e-mail válido para o responsável.';
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
  if (requiresResponsible(dateOfBirth, referenceCivilDate)) {
    const responsibleErrors = validateAdministrativeResponsible(input.administrativeResponsible);
    Object.entries(responsibleErrors).forEach(([field, message]) => { errors[`administrativeResponsible.${field}`] = message; });
  }
  return errors;
}
