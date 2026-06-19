import type { PatientCareProfessional } from '../types';

export const PATIENT_SEX_OPTIONS = [
  'Masculino',
  'Feminino',
  'Não informado',
] as const;

export const PATIENT_FAMILY_STATUS_OPTIONS = [
  'Casados',
  'União estável',
  'Separados',
  'Divorciados',
  'Nunca viveram juntos',
  'Pai falecido',
  'Mãe falecida',
  'Ambos falecidos',
] as const;

export const PATIENT_CUSTODY_STATUS_OPTIONS = [
  'Guarda compartilhada',
  'Guarda unilateral da mãe',
  'Guarda unilateral do pai',
  'Guarda de outro responsável',
] as const;

export const PATIENT_EDUCATION_OPTIONS = [
  'Não informado',
  'Não se aplica',
  'Educação Infantil',
  '1º ano do Ensino Fundamental',
  '2º ano do Ensino Fundamental',
  '3º ano do Ensino Fundamental',
  '4º ano do Ensino Fundamental',
  '5º ano do Ensino Fundamental',
  '6º ano do Ensino Fundamental',
  '7º ano do Ensino Fundamental',
  '8º ano do Ensino Fundamental',
  '9º ano do Ensino Fundamental',
  '1º ano do Ensino Médio',
  '2º ano do Ensino Médio',
  '3º ano do Ensino Médio',
  'Ensino Médio completo',
  'Educação de Jovens e Adultos — EJA',
  'Ensino Superior em andamento',
  'Ensino Superior concluído',
  'Pós-graduação em andamento',
  'Pós-graduação concluída',
  'Outro',
] as const;

export const PATIENT_SHIFT_OPTIONS = [
  'Manhã',
  'Tarde',
  'Integral',
] as const;

export const PATIENT_CARE_SPECIALTY_OPTIONS = [
  'Psicólogo',
  'Fonoaudiólogo',
  'Terapeuta Ocupacional',
  'Neurologista',
  'Psiquiatra',
  'Pediatra',
  'Psicopedagogo',
  'Neuropsicopedagogo',
  'Outro',
] as const;

export const PATIENT_FINANCIAL_RESPONSIBLE_OPTIONS = [
  'Pai',
  'Mãe',
  'Outro',
] as const;

export const PATIENT_REGISTRATION_FIELD_LABELS: Record<string, string> = {
  name: '1º Nome do Atendente',
  fullName: 'Nome completo do Atendente',
  birthDate: 'Data de nascimento',
  sex: 'Sexo',
  guardianName: '1º Nome do Responsável',
  whatsapp: 'WhatsApp do Responsável',
  motherName: 'Nome completo da mãe',
  motherProfession: 'Profissão da mãe',
  motherPhone: 'Contato da mãe',
  fatherName: 'Nome completo do pai',
  fatherProfession: 'Profissão do pai',
  fatherPhone: 'Contato do pai',
  otherResponsibleName: 'Nome completo de outro responsável',
  otherResponsibleKinship: 'Parentesco do outro responsável',
  otherResponsiblePhone: 'Contato de outro responsável',
  school: 'Escola',
  grade: 'Ano/nível escolar',
  educationDetail: 'Curso, especialização ou formação',
  shift: 'Turno',
  familyStatus: 'Situação familiar',
  custodyStatus: 'Situação da guarda',
  custodyResponsibleName: 'Nome do responsável pela guarda',
  custodyResponsibleKinship: 'Parentesco do responsável pela guarda',
  careProfessionals: 'Profissionais que acompanham o Atendente',
  doctorName: 'Profissional/médico informado anteriormente',
  medication: 'Medicação em uso',
  emergencyContact: 'Contato de emergência',
  allergies: 'Alergias e restrições',
  financialResponsible: 'Responsável financeiro',
  financialResponsibleOtherName: 'Nome do responsável financeiro',
  financialResponsibleOtherKinship: 'Parentesco do responsável financeiro',
  financialResponsibleOtherPhone: 'Telefone do responsável financeiro',
  financialResponsibleOtherCpf: 'CPF do responsável financeiro',
};

export function getFirstName(value: string | null | undefined): string {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

export function getEducationDetailLabel(grade: string | null | undefined): string | null {
  if (grade === 'Ensino Superior em andamento' || grade === 'Ensino Superior concluído') {
    return 'Nome do curso';
  }
  if (grade === 'Pós-graduação em andamento' || grade === 'Pós-graduação concluída') {
    return 'Nome da especialização';
  }
  if (grade === 'Outro') return 'Especifique';
  return null;
}

export function createPatientCareProfessional(specialty: string): PatientCareProfessional {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `care-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    specialty,
    customSpecialty: '',
    name: '',
    contact: '',
  };
}

export function formatPatientRegistrationValue(field: string, value: unknown): string {
  if (field === 'careProfessionals') {
    if (!Array.isArray(value) || value.length === 0) return 'Não informado';
    return value.map(item => {
      const professional = item as Partial<PatientCareProfessional>;
      const specialty = professional.specialty === 'Outro'
        ? professional.customSpecialty || 'Outro'
        : professional.specialty || 'Profissional';
      const details = [professional.name, professional.contact].filter(Boolean).join(' — ');
      return details ? `${specialty}: ${details}` : String(specialty);
    }).join('; ');
  }
  if (value === null || value === undefined || value === '') return 'Não informado';
  return String(value);
}
