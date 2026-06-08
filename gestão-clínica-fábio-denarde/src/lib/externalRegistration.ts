import { addDays, format } from 'date-fns';
import { ExternalRegistrationData, ExternalRegistrationStatus, Patient } from '../types';

export const EXTERNAL_REGISTRATION_FIELDS: { key: keyof ExternalRegistrationData; label: string }[] = [
  { key: 'name', label: 'Nome da criança' },
  { key: 'birthDate', label: 'Nascimento' },
  { key: 'guardianName', label: 'Responsável' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'school', label: 'Escola' },
  { key: 'grade', label: 'Ano escolar' },
  { key: 'shift', label: 'Turno' },
  { key: 'doctorName', label: 'Médico cuidando' },
  { key: 'medication', label: 'Medicação em uso' },
];

export const EMPTY_EXTERNAL_REGISTRATION_DATA: ExternalRegistrationData = {
  name: '',
  birthDate: '',
  guardianName: '',
  whatsapp: '',
  school: '',
  grade: '',
  shift: '',
  hasMedicalFollowUp: '',
  doctorName: '',
  usesMedication: '',
  medication: '',
  authorizationAccepted: false,
};

export const PENDING_EXTERNAL_REGISTRATION_STATUSES: ExternalRegistrationStatus[] = [
  'Pendente de preenchimento',
  'Pré-cadastro recebido',
  'Atualização recebida',
];

export const FINAL_EXTERNAL_REGISTRATION_STATUSES: ExternalRegistrationStatus[] = [
  'Novo cadastro criado',
  'Cadastro atualizado',
  'Arquivado',
];

export function isPendingExternalRegistrationStatus(status: ExternalRegistrationStatus) {
  return PENDING_EXTERNAL_REGISTRATION_STATUSES.includes(status);
}

export function isFinalExternalRegistrationStatus(status: ExternalRegistrationStatus) {
  return FINAL_EXTERNAL_REGISTRATION_STATUSES.includes(status);
}

export function createStrongToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function getExternalRegistrationExpiry() {
  return format(addDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}

export function getExternalRegistrationExpiryMs() {
  return addDays(new Date(), 7).getTime();
}

function isFirestoreSpecialValue(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
  return constructorName === 'Timestamp' || constructorName === 'GeoPoint' || constructorName === 'DocumentReference';
}

export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined) {
    return null as T;
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Date ||
    isFirestoreSpecialValue(value)
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForFirestore(item)) as T;
  }

  return Object.entries(value as Record<string, unknown>).reduce((acc, [key, entry]) => {
    if (entry !== undefined) {
      acc[key] = sanitizeForFirestore(entry);
    }
    return acc;
  }, {} as Record<string, unknown>) as T;
}

export function patientToExternalRegistrationData(patient?: Partial<Patient>): ExternalRegistrationData {
  return {
    name: patient?.name || '',
    birthDate: patient?.birthDate || '',
    guardianName: patient?.guardianName || '',
    whatsapp: formatBrazilianWhatsapp(patient?.whatsapp || ''),
    school: patient?.school || '',
    grade: patient?.grade || '',
    shift: patient?.shift || '',
    hasMedicalFollowUp: patient?.doctorName ? 'Sim' : 'Não',
    doctorName: patient?.doctorName || '',
    usesMedication: patient?.medication ? 'Sim' : 'Não',
    medication: patient?.medication || '',
    authorizationAccepted: false,
  };
}

export function externalRegistrationDataToPatient(data: ExternalRegistrationData): Partial<Patient> {
  return {
    name: data.name.trim(),
    birthDate: data.birthDate,
    guardianName: data.guardianName.trim(),
    whatsapp: formatBrazilianWhatsapp(data.whatsapp),
    school: data.school?.trim() || '',
    grade: data.grade?.trim() || '',
    shift: data.shift || '',
    doctorName: data.hasMedicalFollowUp === 'Sim' ? data.doctorName?.trim() || '' : '',
    medication: data.usesMedication === 'Sim' ? data.medication?.trim() || '' : '',
  };
}

export function formatBrazilianWhatsapp(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function validateExternalRegistrationData(data: ExternalRegistrationData) {
  const errors: string[] = [];
  if (!data.name.trim()) errors.push('Informe o nome da criança.');
  if (!data.birthDate) errors.push('Informe a data de nascimento.');
  if (!data.guardianName.trim()) errors.push('Informe o nome do responsável.');
  if (data.whatsapp.replace(/\D/g, '').length < 10) errors.push('Informe um WhatsApp brasileiro válido.');
  if (!data.authorizationAccepted) errors.push('Confirme a autorização para envio dos dados.');
  if (data.hasMedicalFollowUp === 'Sim' && !data.doctorName?.trim()) errors.push('Informe o médico cuidando.');
  if (data.usesMedication === 'Sim' && !data.medication?.trim()) errors.push('Informe a medicação em uso.');
  return errors;
}

export function getChangedExternalFields(currentData: ExternalRegistrationData, submittedData: ExternalRegistrationData) {
  return EXTERNAL_REGISTRATION_FIELDS
    .filter(field => String(currentData[field.key] || '').trim() !== String(submittedData[field.key] || '').trim())
    .map(field => field.key);
}

export function getExternalFieldLabel(key: string) {
  return EXTERNAL_REGISTRATION_FIELDS.find(field => field.key === key)?.label || key;
}
