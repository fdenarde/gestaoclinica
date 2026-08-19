/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppTheme } from './lib/theme';
import type { ActivityMediaAuthorization } from './types/activityRecords';
import type { PackageToleranceRecord } from './types/packageTolerance';

export type PackageContractSource = 'explicit' | 'legacy_fallback';

export interface PackageContractSnapshot {
  packageNumber: number;
  packageContractValue: number;
  contractValue?: number;
  source: PackageContractSource;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export enum PaymentModal {
  PIX_FULL = 'PADRÃO: Pix integral — R$1.000 antes da 1ª sessão',
  PARCELADO = 'ALTERNATIVA: Parcelado — R$500 antes da 1ª / R$500 na 5ª sessão'
}

export enum SessionStatus {
  REALIZADA = 'Realizada',
  FALTA = 'Falta',
  FALTA_PROF = 'Falta.Prof',
  AGENDADA = 'Agendada',
  REPOSICAO = 'Reposição',
  CANCELADA = 'Cancelada',
  LATE_CANCELLATION_NO_REPLACEMENT = 'late_cancellation_no_replacement'
}

export enum SessionType {
  SIMPLES = 'Sessão simples (50 min)',
  DUPLA = 'Sessão dupla (2 × 50 min)'
}

export type NoReplacementReasonCode =
  | 'late_notice_or_out_of_policy_cancellation'
  | 'no_show_without_notice'
  | 'contractual_no_replacement'
  | 'notice_in_advance'
  | 'late_notice'
  | 'same_day_cancellation'
  | 'health_issue'
  | 'family_emergency'
  | 'transportation_issue'
  | 'school_commitment'
  | 'professional_commitment'
  | 'travel'
  | 'schedule_conflict'
  | 'online_technical_issue'
  | 'professional_absence'
  | 'clinic_cancellation'
  | 'prior_agreement'
  | 'exceptionally_justified'
  | 'reason_not_informed'
  | 'other';

export interface SessionNoReplacementHistoryEntry {
  previousStatus: SessionStatus | string;
  newStatus: SessionStatus | string;
  reasonCode: NoReplacementReasonCode;
  reasonText: string;
  observation: string;
  changedAt: string;
  changedBy: string;
  consumesPackage?: boolean;
  packageConsumptionDecidedAt?: string;
  packageConsumptionDecidedBy?: string;
}

export interface ResponsibleDocumentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  note: string;
  uploadedByName: string;
  createdAt: string;
}

export type PatientSex = 'Masculino' | 'Feminino' | 'Não informado';

export type PatientFamilyStatus =
  | 'Casados'
  | 'União estável'
  | 'Separados'
  | 'Divorciados'
  | 'Nunca viveram juntos'
  | 'Pai falecido'
  | 'Mãe falecida'
  | 'Ambos falecidos';

export type PatientCustodyStatus =
  | 'Guarda compartilhada'
  | 'Guarda unilateral da mãe'
  | 'Guarda unilateral do pai'
  | 'Guarda de outro responsável';

export type PatientFinancialResponsible = 'Pai' | 'Mãe' | 'Outro';

export interface PatientCareProfessional {
  id: string;
  specialty: string;
  customSpecialty?: string;
  name?: string;
  contact?: string;
}

export interface PatientRegistrationData {
  name: string;
  fullName?: string;
  birthDate: string;
  sex?: PatientSex;
  guardianName: string;
  whatsapp: string;
  motherName?: string;
  motherProfession?: string;
  motherPhone?: string;
  fatherName?: string;
  fatherProfession?: string;
  fatherPhone?: string;
  otherResponsibleName?: string;
  otherResponsibleKinship?: string;
  otherResponsiblePhone?: string;
  school?: string;
  grade?: string;
  educationDetail?: string;
  shift?: string;
  familyStatus?: PatientFamilyStatus;
  custodyStatus?: PatientCustodyStatus;
  custodyResponsibleName?: string;
  custodyResponsibleKinship?: string;
  careProfessionals?: PatientCareProfessional[];
  doctorName?: string;
  medication?: string;
  emergencyContact?: string;
  allergies?: string;
  financialResponsible?: PatientFinancialResponsible;
  financialResponsibleOtherName?: string;
  financialResponsibleOtherKinship?: string;
  financialResponsibleOtherPhone?: string;
  financialResponsibleOtherCpf?: string;
}

export interface Patient extends PatientRegistrationData {
  id: string;
  fixedDay: string; // terça, quinta, sexta, sábado
  fixedTime: string;
  doubleSession?: boolean; // true = atende 2 horários seguidos (ex: 14h e 15h)
  fixedScheduleEffectiveFrom?: string; // YYYY-MM-DD; current fixed schedule starts on this date
  fixedScheduleHistory?: {
    fixedDay: string;
    fixedTime: string;
    doubleSession?: boolean;
    effectiveFrom: string;
    effectiveTo: string;
  }[];
  paymentModal: PaymentModal;
  startDate: string;
  photoUrl?: string; // legado: base64 ou URL antiga
  photoStoragePath?: string; // legado ou identificador google-drive:<fileId>
  photoStorageProvider?: 'google-drive' | 'firebase-storage';
  photoDriveFileId?: string;
  photoDriveFileName?: string;
  photoMimeType?: string;
  activityMediaAuthorization?: ActivityMediaAuthorization;
  packageTolerances?: PackageToleranceRecord[];
  packageContracts?: PackageContractSnapshot[];
  lastExternalRegistrationUpdate?: string;
  externalRegistrationHistory?: ExternalRegistrationHistoryItem[];
  reportPdfUrl?: string;
  opinionPdfUrl?: string;
  responsibleDocuments?: ResponsibleDocumentSummary[];
  anamnese: {
    complaint: string;
    school: string;
    grade: string;
    referredBy: string;
    diagnoses: string;
    initialNotes: string;
  };
  clinicalNotes: string;
  status: 'Ativo' | 'Concluído';
}

export interface ExternalRegistrationData {
  name: string;
  birthDate: string;
  guardianName: string;
  whatsapp: string;
  school?: string;
  grade?: string;
  shift?: string;
  hasMedicalFollowUp: 'Sim' | 'Não' | '';
  doctorName?: string;
  usesMedication: 'Sim' | 'Não' | '';
  medication?: string;
  authorizationAccepted: boolean;
}

export type ExternalRegistrationType = 'new' | 'update';

export type ExternalRegistrationStatus =
  | 'Pendente de preenchimento'
  | 'Pré-cadastro recebido'
  | 'Atualização recebida'
  | 'Novo cadastro criado'
  | 'Cadastro atualizado'
  | 'Arquivado';

export interface ExternalRegistrationHistoryItem {
  id: string;
  formId: string;
  submittedAt: string;
  approvedAt: string;
  type: ExternalRegistrationType;
  action: string;
  changedFields: string[];
  approvedBy?: string;
}

export interface ExternalRegistrationForm {
  id: string;
  token: string;
  ownerUserId: string;
  type: ExternalRegistrationType;
  status: ExternalRegistrationStatus;
  patientId?: string | null;
  patientSnapshot?: Partial<Patient> | null;
  currentData?: ExternalRegistrationData;
  submittedData?: ExternalRegistrationData;
  selectedFields?: string[];
  createdAt: string;
  expiresAt: string;
  expiresAtMs: number;
  expiresAtTimestamp?: unknown;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  archivedAt?: string;
  notes?: string;
  history?: ExternalRegistrationHistoryItem[];
}


export interface SessionRescheduleHistoryEntry {
  previousDate: string;
  previousTime: string;
  newDate: string;
  newTime: string;
  changedAt: string;
  changedBy: string;
}


export type WhatsappReminderBlockType = 'AMANHA' | 'HOJE_MANHA' | 'HOJE_TARDE' | 'RETRY';

export interface WhatsappAutomationControl {
  version: 1;
  blockAll: boolean;
  blockedReminderTypes: WhatsappReminderBlockType[];
  scope: 'session' | 'patient_date';
  updatedAt: string;
  updatedBy: string;
  updatedByRole: string;
}

export interface Session {
  id: string;
  patientId: string;
  date: string; // ISO String
  time: string;
  type: SessionType;
  status: SessionStatus;
  notes?: string;
  packageNumber: number | null; // 1 to 10
  previousPackageNumber?: number; // Pacotes anteriores
  isBlocked?: boolean; // true when this slot is a personal block (not a patient session)
  blockName?: string; // name of the personal commitment when isBlocked is true
  isFixedSchedule?: boolean; // true if this is an automatic/fixed session
  source?: 'fixed' | 'manual' | 'reposition' | 'blocked';
  consumesPackage?: boolean; // decisão do profissional para faltas que devem consumir sessão
  packageConsumptionDecidedAt?: string;
  packageConsumptionDecidedBy?: string;
  noReplacementReasonCode?: NoReplacementReasonCode;
  noReplacementReasonText?: string;
  noReplacementObservation?: string;
  noReplacementRecordedAt?: string;
  noReplacementRecordedBy?: string;
  noReplacementHistory?: SessionNoReplacementHistoryEntry[];
  removedFromAgenda?: boolean; // tombstone de ocorrência fixa removida, preserva auditoria e impede recriação virtual
  removedFromAgendaAt?: string;
  removedFromAgendaBy?: string;
  removalReason?: 'removed_after_cancellation';
  logicalSessionPosition?: number; // posição absoluta preservada para impedir duplicidade ao reagendar
  logicalSessionNumber?: number; // número de 1 a 10 derivado da posição lógica
  rescheduledAt?: string;
  rescheduledBy?: string;
  fixedScheduleOriginalDate?: string; // mantém a ocorrência fixa original suprimida após mudança de data/horário
  fixedScheduleOriginalTime?: string;
  rescheduleHistory?: SessionRescheduleHistoryEntry[];
  whatsappAutomationControl?: WhatsappAutomationControl;
}

export interface Reposition {
  id: string;
  patientId: string;
  originalSessionId: string;
  status: 'Pendente' | 'Agendada' | 'Concluída';
  suggestedDate?: string;
}

export interface Payment {
  id: string;
  patientId: string;
  amount: number;
  date: string;
  installment: '1ª parcela' | '2ª parcela' | 'Pagamento integral';
  method: 'Pix' | 'Dinheiro' | 'Transferência' | 'Outro';
  packageNumber?: number;
  status?: 'active' | 'voided';
  operationKey?: string;
  createdAt?: string;
  createdBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface ClinicSettings {
  name: string;
  specialty: string;
  title: string;
  email: string;
  whatsapp: string;
  address: string;
  customHeader?: string;
  customFooter?: string;
  holidays?: { id: string; date: string; name: string }[];
  visualTheme?: AppTheme;
  activityMediaMonitoringStart?: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: 'Aluguel' | 'Energia' | 'Internet' | 'Materiais' | 'Impostos' | 'Repasse Sócia' | 'Outro';
  auto_gerado?: boolean;
  pagamento_origem_id?: string;
  status?: 'active' | 'voided';
  operationKey?: string;
  createdAt?: string;
  createdBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface Evolution {
  id: string;
  patientId: string;
  sessionId?: string;
  date: string;
  notes: string;
}

export type PersonalAppointmentType =
  | 'Médico'
  | 'Estudar'
  | 'Cortar cabelo'
  | 'Visitar família'
  | 'Viajar'
  | 'Passear'
  | 'Compromisso com a esposa'
  | 'Compromisso com Lara'
  | 'Ir ao supermercado'
  | 'Compromisso com cliente'
  | 'Academia / Exercício'
  | 'Farmácia'
  | 'Banco / Financeiro'
  | 'Manutenção / Conserto'
  | 'Receber entrega'
  | 'Restaurante / Jantar especial'
  | 'Aniversário'
  | 'Compromisso Familiar'
  | 'Compromisso com Amigos'
  | 'Outro';

export type AlarmAdvance = 'Na hora' | '5 min' | '10 min' | '15 min' | '20 min' | '25 min' | '30 min' | '35 min' | '40 min' | '45 min' | '50 min' | '55 min' | '1 hora' | '1h30' | '2 horas';
export type AlarmSound = string;

export interface PersonalAppointment {
  id: string;
  type: PersonalAppointmentType;
  date: string; // YYYY-MM-DD (primeira ocorrência)
  time: string; // HH:MM
  durationMinutes: number; // default 60
  recurrence: 'Não repetir' | 'Toda semana' | 'Todo mês';
  notes: string;
  alarmEnabled: boolean;
  alarmAdvance?: AlarmAdvance;
  alarmSound?: AlarmSound;
  alarmVolume?: number;
  alarmFadeIn?: boolean;
  isDone: boolean; // para histórico
}

export interface AppState {
  patients: Patient[];
  sessions: Session[];
  payments: Payment[];
  repositions: Reposition[];
  expenses: Expense[];
  evolutions: Evolution[];
  settings: ClinicSettings;
  personalAppointments: PersonalAppointment[];
  externalRegistrationForms: ExternalRegistrationForm[];
}
