import { AppState, Patient, Session, Payment, Reposition, PaymentModal, SessionStatus, SessionType } from '../types';

const STORAGE_KEY = 'fabio_denarde_clinic_data';

const MOCK_PATIENTS: Patient[] = [
  {
    id: '1',
    name: 'Ana Clara Souza',
    birthDate: '2017-05-15',
    guardianName: 'Maria Souza',
    whatsapp: '27 99999-0001',
    fixedDay: 'terça',
    fixedTime: '08:00',
    paymentModal: PaymentModal.PIX_FULL,
    startDate: '2025-01-05',
    anamnese: {
      complaint: 'Dificuldade na alfabetização',
      school: 'Escola Pequeno Príncipe',
      grade: '2º ano',
      referredBy: 'Escola',
      diagnoses: 'Nenhum',
      initialNotes: 'Criança tímida, boa relação com a mãe.'
    },
    clinicalNotes: 'Demonstra progresso lento mas constante no reconhecimento de fonemas.',
    status: 'Ativo'
  },
  {
    id: '2',
    name: 'Pedro Henrique Lima',
    birthDate: '2015-08-20',
    guardianName: 'Carla Lima',
    whatsapp: '27 99999-0002',
    fixedDay: 'quinta',
    fixedTime: '09:00',
    paymentModal: PaymentModal.PARCELADO,
    startDate: '2024-12-08',
    anamnese: {
      complaint: 'TDAH e desatenção',
      school: 'Colégio Alpha',
      grade: '4º ano',
      referredBy: 'Médico',
      diagnoses: 'TDAH',
      initialNotes: 'Agitação motora presente.'
    },
    clinicalNotes: 'Foco melhorado com estratégias visuais.',
    status: 'Ativo'
  },
  {
    id: '3',
    name: 'Mariana Costa',
    birthDate: '2018-11-30',
    guardianName: 'Juliana Costa',
    whatsapp: '27 99999-0003',
    fixedDay: 'sexta',
    fixedTime: '14:00',
    paymentModal: PaymentModal.PIX_FULL,
    startDate: '2025-01-10',
    anamnese: {
      complaint: 'Dislexia suspeita',
      school: 'Escola ABC',
      grade: '1º ano',
      referredBy: 'Familiar',
      diagnoses: 'Nenhum',
      initialNotes: 'Dificuldade extrema em rimas.'
    },
    clinicalNotes: 'Trabalhando consciência fonológica.',
    status: 'Ativo'
  }
];

const MOCK_SESSIONS: Session[] = [
  { id: 's1', patientId: '1', date: '2025-01-07', time: '08:00', status: SessionStatus.REALIZADA, type: SessionType.SIMPLES, packageNumber: 1 },
  { id: 's2', patientId: '1', date: '2025-01-14', time: '08:00', status: SessionStatus.REALIZADA, type: SessionType.SIMPLES, packageNumber: 2 },
  { id: 's3', patientId: '1', date: '2025-01-21', time: '08:00', status: SessionStatus.FALTA, type: SessionType.SIMPLES, packageNumber: 3 },
  { id: 's4', patientId: '2', date: '2025-01-09', time: '09:00', status: SessionStatus.REALIZADA, type: SessionType.DUPLA, packageNumber: 1 },
  { id: 's5', patientId: '2', date: '2025-01-16', time: '09:00', status: SessionStatus.REALIZADA, type: SessionType.SIMPLES, packageNumber: 3 },
  { id: 's6', patientId: '3', date: '2025-01-10', time: '14:00', status: SessionStatus.REALIZADA, type: SessionType.SIMPLES, packageNumber: 1 },
];

const MOCK_PAYMENTS: Payment[] = [
  { id: 'p1', patientId: '1', amount: 1000, date: '2025-01-04', installment: 'Pagamento integral', method: 'Pix' },
  { id: 'p2', patientId: '2', amount: 500, date: '2024-12-07', installment: '1ª parcela', method: 'Pix' },
  { id: 'p3', patientId: '3', amount: 1000, date: '2025-01-09', installment: 'Pagamento integral', method: 'Pix' },
];

import { CLINIC_INFO } from '../constants';

const INITIAL_STATE: AppState = {
  patients: MOCK_PATIENTS,
  sessions: MOCK_SESSIONS,
  payments: MOCK_PAYMENTS,
  repositions: [],
  expenses: [],
  evolutions: [],
  personalAppointments: [],
  settings: CLINIC_INFO
};

export function loadState(): AppState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_STATE,
        ...parsed,
        settings: parsed.settings || INITIAL_STATE.settings
      };
    } catch (e) {
      console.error('Error parsing state', e);
    }
  }
  return INITIAL_STATE;
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
