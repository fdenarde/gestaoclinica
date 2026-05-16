/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  CANCELADA = 'Cancelada'
}

export enum SessionType {
  SIMPLES = 'Sessão simples (50 min)',
  DUPLA = 'Sessão dupla (2 × 50 min)'
}

export interface Patient {
  id: string;
  name: string;
  birthDate: string;
  guardianName: string;
  whatsapp: string;
  fixedDay: string; // terça, quinta, sexta, sábado
  fixedTime: string;
  doubleSession?: boolean; // true = atende 2 horários seguidos (ex: 14h e 15h)
  paymentModal: PaymentModal;
  startDate: string;
  photoUrl?: string;
  school?: string;
  grade?: string;
  shift?: string;
  doctorName?: string;
  medication?: string;
  reportPdfUrl?: string;
  opinionPdfUrl?: string;
  emergencyContact?: string;
  allergies?: string;
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
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: 'Aluguel' | 'Energia' | 'Internet' | 'Materiais' | 'Impostos' | 'Outro';
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
  | 'Outro';

export type AlarmAdvance = '5 min' | '10 min' | '15 min' | '30 min' | '1 hora' | 'Na hora';
export type AlarmSound = 'Sino suave' | 'Notificação padrão' | 'Melodia relaxante' | 'Alerta urgente' | 'Bipe curto' | 'Sirene' | 'Alarme pulsante' | 'Toque de telefone' | 'Clássico Nokia' | 'Digital repetitivo' | 'Toque duplo' | 'Urgência crescente' | 'Marimba' | 'Pulse forte' | 'Campainha escola' | 'Alerta militar' | 'Silencioso';

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
}
