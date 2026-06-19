import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AppState, Session, SessionStatus, SessionType, Reposition } from '../types';
import { AVAILABLE_TIMES, SCHEDULE_CONFIG } from '../constants';
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, Clock, DollarSign, FileText, MessageCircle, Phone, User, Users, Images } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { cn, getStatusColor, safeFormatDate, normalizeStr, isValidTime, normalizeTime, addOneHour, getSessionsForDate, getWhatsappReminderPlan, ProcessedSession } from '../lib/utils';
import { getSessionCycleLabel, getSessionCycleNumber } from '../lib/sessionSequence';

const getHourBase = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hour] = timeStr.split(':');
  return `${hour}:00`;
};

// ── Status helpers ────────────────────────────────────────────────

function getStatusLabel(session: ProcessedSession): string {
  if (session.isBlocked) return 'Bloqueado';

  // Use the actual session.status as the primary source of truth
  const status = session.status;
  switch (status) {
    case 'Agendada':
      if (session.blockedReason === 'feriado/recesso') return 'Feriado';
      return 'Agendada';
    case 'Realizada': return 'Realizada';
    case 'Falta': return 'Falta';
    case 'Falta.Prof': return 'Falta Prof.';
    case 'Cancelada': return 'Cancelada';
    case 'Reposição': return 'Reposição';
    default:
      // Truly unknown status — fall back to blockedReason
      if (!session.isValid) {
        if (session.blockedReason === 'feriado/recesso') return 'Feriado';
        if (session.blockedReason === 'sessão cancelada') return 'Cancelada';
        if (session.blockedReason === 'paciente inativo') return 'Inativo';
        if (session.blockedReason === 'paciente sem WhatsApp') return 'Sem WhatsApp';
      }
      return session.status || '—';
  }
}

function getStatusCardBg(session: ProcessedSession): string {
  if (session.isBlocked) return 'bg-[#5D4037]/10 border-[#5D4037]/40';

  // Use actual session.status for color, not blockedReason
  switch (session.status) {
    case 'Agendada':
      if (session.blockedReason === 'feriado/recesso') return 'bg-orange-500/10 border-orange-400/50';
      return 'bg-white border-clinic-border';
    case 'Realizada': return 'bg-blue-500/8 border-blue-400/50';
    case 'Falta': return 'bg-red-500/10 border-red-500/25';
    case 'Falta.Prof': return 'bg-orange-500/10 border-orange-500/25';
    case 'Cancelada': return 'bg-rose-900/15 border-rose-900/25';
    case 'Reposição': return 'bg-blue-500/8 border-blue-400/50';
    default:
      if (!session.isValid) return 'bg-gray-100/70 border-gray-300/60';
      return 'bg-white border-clinic-border';
  }
}

function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case 'Agendada': return 'bg-status-green-bg text-status-green-text';
    case 'Realizada': return 'bg-status-blue-bg text-status-blue-text';
    case 'Falta': return 'bg-status-red-bg text-status-red-text';
    case 'Falta.Prof': return 'bg-status-orange-bg text-status-orange-text';
    case 'Cancelada': return 'bg-gray-100 text-gray-400';
    case 'Reposição': return 'bg-status-blue-bg text-status-blue-text';
    default: return 'bg-clinic-bg text-clinic-text-muted';
  }
}

const STATUS_LEGEND = [
  { label: 'Agendada', colorClass: 'bg-status-green-bg border-status-green-text' },
  { label: 'Realizada', colorClass: 'bg-blue-500/8 border-blue-400/60' },
  { label: 'Falta', colorClass: 'bg-red-500/10 border-red-500/30' },
  { label: 'Falta Prof.', colorClass: 'bg-orange-500/10 border-orange-500/30' },
  { label: 'Cancelada', colorClass: 'bg-rose-900/15 border-rose-900/30' },
  { label: 'Reposição', colorClass: 'bg-blue-500/8 border-blue-400/60' },
  { label: 'Bloqueado', colorClass: 'bg-[#5D4037]/10 border-[#5D4037]/40' },
  { label: 'Disponível', colorClass: 'bg-green-500/10 border-green-500/30 border-dashed' },
];

// ── Component ─────────────────────────────────────────────────────

interface AgendaProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => Promise<void>;
  onNavigateToPatient?: (id: string) => void;
  onNavigateToPatientGallery?: (id: string, sessionId?: string) => void;
  currentUserName: string;
}

export default function Agenda({ state, onUpdate, onNavigateToPatient, onNavigateToPatientGallery, currentUserName }: AgendaProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; time: string } | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // Form State
  const [patientId, setPatientId] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>(SessionType.SIMPLES);
  const [notes, setNotes] = useState('');
  const [isBlockMode, setIsBlockMode] = useState(false);
  const [generalNotesDraft, setGeneralNotesDraft] = useState('');
  const [actionGeneralNotesDraft, setActionGeneralNotesDraft] = useState('');
  const [isEditingActionGeneralNotes, setIsEditingActionGeneralNotes] = useState(false);

  // Session Action Modal state (safe click/tap on card)
  const [actionSession, setActionSession] = useState<ProcessedSession | null>(null);
  const virtualActionLocksRef = useRef<Set<string>>(new Set());

// Reposition Modal State
  const [repoModal, setRepoModal] = useState<{ reposition: Reposition; patient: AppState['patients'][0]; originalSession: Session | null } | null>(null);
  const [repoDate, setRepoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [repoTime, setRepoTime] = useState('');

  const repoAvailableTimes = useMemo(() => {
    const dayIndex = getDay(new Date(repoDate + 'T12:00:00'));
    const dayKeys: Record<number, string> = { 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
    const key = dayKeys[dayIndex];
    return key ? (SCHEDULE_CONFIG[key] || []) : AVAILABLE_TIMES;
  }, [repoDate]);

  const selectedPatient = useMemo(
    () => state.patients.find(p => p.id === patientId) || null,
    [patientId, state.patients]
  );

  useEffect(() => {
    setGeneralNotesDraft(selectedPatient?.clinicalNotes || '');
  }, [selectedPatient?.id, selectedPatient?.clinicalNotes]);

  useEffect(() => {
    const patient = actionSession ? state.patients.find(p => p.id === actionSession.patientId) : null;
    setActionGeneralNotesDraft(patient?.clinicalNotes || '');
    setIsEditingActionGeneralNotes(false);
  }, [actionSession?.id, actionSession?.patientId, state.patients]);

  useEffect(() => {
    for (const key of virtualActionLocksRef.current) {
      const [patientId, date, time] = key.split('|');
      const persisted = state.sessions.some(session =>
        session.patientId === patientId &&
        session.date === date &&
        normalizeTime(session.time) === time
      );
      if (persisted) virtualActionLocksRef.current.delete(key);
    }
  }, [state.sessions]);

  const getPatientSessions = (targetPatientId: string) =>
    state.sessions
      .filter(s => s.patientId === targetPatientId && !s.isBlocked)
      .sort((a, b) => `${a.date}T${a.time}|${a.id}`.localeCompare(`${b.date}T${b.time}|${b.id}`));

  const getPatientRecentSessions = (targetPatientId: string) =>
    getPatientSessions(targetPatientId)
      .filter(s => [SessionStatus.REALIZADA, SessionStatus.FALTA, SessionStatus.FALTA_PROF, SessionStatus.CANCELADA, SessionStatus.REPOSICAO].includes(s.status))
      .slice(-4)
      .reverse();

  const getPatientFinancialSummary = (targetPatientId: string) => {
    const payments = state.payments.filter(p => p.patientId === targetPatientId);
    const total = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    if (payments.length === 0) return 'Sem pagamentos registrados';
    return `${payments.length} pagamento(s) - ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  };

  const buildPreviewSession = (): Session | null => {
    if (!selectedSlot || !patientId) return null;
    const previewSession: Session = {
      id: 'preview-agenda-session',
      patientId,
      date: selectedSlot.date,
      time: normalizeTime(selectedSlot.time),
      type: sessionType,
      status: SessionStatus.AGENDADA,
      notes,
      packageNumber: 0,
    };
    return {
      ...previewSession,
      packageNumber: getSessionCycleNumber([...state.sessions, previewSession], previewSession),
    };
  };

  const getWhatsappPreviewMessage = () => {
    const previewSession = buildPreviewSession();
    if (!previewSession || !selectedPatient) return '';
    const planType = Number(previewSession.time.split(':')[0] || 0) < 12 ? 'HOJE_MANHA' : 'HOJE_TARDE';
    const plan = getWhatsappReminderPlan({
      runDateStr: previewSession.date,
      tipo: planType,
      patients: [selectedPatient],
      sessions: [previewSession],
      settings: state.settings,
    });
    return plan.reminders.find(r => r.patientId === selectedPatient.id)?.message || 'Sem mensagem prevista: verifique WhatsApp, status do paciente, feriado/recesso ou bloqueios.';
  };

  const getSchedulingWarnings = () => {
    if (!selectedSlot) return [];
    const normalizedTime = isValidTime(selectedSlot.time) ? normalizeTime(selectedSlot.time) : selectedSlot.time;
    const warnings: string[] = [];
    const holiday = state.settings.holidays?.find(h => h.date === selectedSlot.date);
    if (holiday) warnings.push(`Data fechada por feriado/recesso: ${holiday.name}.`);

    const occupied = state.sessions.find(s =>
      s.date === selectedSlot.date &&
      normalizeTime(s.time) === normalizedTime &&
      !s.isBlocked &&
      s.status !== SessionStatus.CANCELADA
    );
    if (occupied) {
      const occupiedPatient = state.patients.find(p => p.id === occupied.patientId);
      warnings.push(`Horário já ocupado por ${occupiedPatient?.name || 'outro registro'}.`);
    }

    if (patientId) {
      const samePatientSameTime = state.sessions.find(s =>
        s.patientId === patientId &&
        s.date === selectedSlot.date &&
        normalizeTime(s.time) === normalizedTime &&
        s.status !== SessionStatus.CANCELADA
      );
      if (samePatientSameTime) warnings.push('Este atendente já possui uma sessão neste mesmo horário.');

      const samePatientSameDay = state.sessions.filter(s =>
        s.patientId === patientId &&
        s.date === selectedSlot.date &&
        normalizeTime(s.time) !== normalizedTime &&
        s.status !== SessionStatus.CANCELADA
      );
      if (samePatientSameDay.length > 0) warnings.push(`Atenção: este atendente já possui ${samePatientSameDay.length} sessão(ões) no mesmo dia.`);
    }

    return warnings;
  };

  const saveGeneralNotes = (targetPatientId: string, value: string) => {
    const updatedPatients = state.patients.map(patient =>
      patient.id === targetPatientId ? { ...patient, clinicalNotes: value } : patient
    );
    onUpdate({ patients: updatedPatients });
    showToast('Anotações gerais do paciente atualizadas.', 'success');
  };

  // ── Create real session from virtual ──────────────────────────
  const createRealFromVirtual = (virtualSession: ProcessedSession, newStatus: SessionStatus): { session: Session; reposition?: Reposition } | null => {
    const patient = state.patients.find(p => p.id === virtualSession.patientId);
    if (!patient || patient.status !== 'Ativo' || virtualSession.isBlocked) return null;

    const alreadyExists = state.sessions.some(session =>
      session.patientId === virtualSession.patientId &&
      session.date === virtualSession.date &&
      normalizeTime(session.time) === normalizeTime(virtualSession.time)
    );
    if (alreadyExists) return null;

    const previewSession: Session = {
      id: virtualSession.id,
      patientId: virtualSession.patientId,
      date: virtualSession.date,
      time: normalizeTime(virtualSession.time),
      type: virtualSession.type,
      status: newStatus,
      notes: virtualSession.notes || '',
      packageNumber: 0,
      isFixedSchedule: true,
      source: 'fixed',
      consumesPackage: newStatus === SessionStatus.FALTA
        ? window.confirm('Esta falta deve consumir uma das 10 sessões do pacote?\n\nOK = Sim.\nCancelar = Não.')
        : false,
    };
    const nextSessionNumber = getSessionCycleNumber([...state.sessions, previewSession], previewSession);
    const newReal: Session = {
      ...previewSession,
      id: Math.random().toString(36).substr(2, 9),
      packageNumber: nextSessionNumber,
    };
    let reposition: Reposition | undefined;
    if (newStatus === SessionStatus.FALTA || newStatus === SessionStatus.FALTA_PROF) {
      reposition = {
        id: Math.random().toString(36).substr(2, 9),
        patientId: patient.id,
        originalSessionId: newReal.id,
        status: 'Pendente',
      };
    }
    return { session: newReal, reposition };
  };

  const getVirtualActionKey = (session: ProcessedSession) =>
    `${session.patientId}|${session.date}|${normalizeTime(session.time)}`;

  const persistVirtualAction = async (
    session: ProcessedSession,
    newStatus: SessionStatus,
    successMessage: string,
  ): Promise<boolean> => {
    const actionKey = getVirtualActionKey(session);
    if (virtualActionLocksRef.current.has(actionKey)) {
      showToast('Este atendimento já está sendo registrado. Aguarde a atualização da Agenda.', 'error');
      return false;
    }

    const result = createRealFromVirtual(session, newStatus);
    if (!result) {
      showToast('A sessão fixa já foi registrada ou não está mais disponível. Atualize a tela e confira a Agenda.', 'error');
      return false;
    }

    virtualActionLocksRef.current.add(actionKey);
    try {
      await onUpdate({
        sessions: [...state.sessions, result.session],
        ...(result.reposition
          ? { repositions: [...state.repositions, result.reposition] }
          : {}),
      });
      showToast(successMessage);
      return true;
    } catch (error) {
      virtualActionLocksRef.current.delete(actionKey);
      console.error('Falha ao registrar atendimento fixo/virtual:', error);
      showToast('Não foi possível registrar o atendimento. Nenhuma confirmação foi gravada. Tente novamente.', 'error');
      return false;
    }
  };

  const handleOpenActivityGallery = async (session: ProcessedSession) => {
    let targetSessionId = session.id;
    const patient = state.patients.find(item => item.id === session.patientId);
    if (!patient) {
      showToast('Atendente não encontrado.', 'error');
      return;
    }
    if (!onNavigateToPatientGallery) {
      showToast('A Galeria de Atividades não está disponível nesta tela.', 'error');
      return;
    }

    if (session.isVirtual && !session.isBlocked && ![
      SessionStatus.FALTA,
      SessionStatus.FALTA_PROF,
      SessionStatus.CANCELADA,
    ].includes(session.status)) {
      const actionKey = getVirtualActionKey(session);
      if (virtualActionLocksRef.current.has(actionKey)) {
        showToast('Esta sessão fixa já está sendo preparada. Aguarde a atualização da Agenda.', 'error');
        return;
      }
      const result = createRealFromVirtual(session, SessionStatus.AGENDADA);
      if (!result) {
        showToast('A sessão fixa já foi materializada ou não está mais disponível. Atualize a Agenda.', 'error');
        return;
      }
      virtualActionLocksRef.current.add(actionKey);
      try {
        await onUpdate({ sessions: [...state.sessions, result.session] });
        targetSessionId = result.session.id;
      } catch (error) {
        virtualActionLocksRef.current.delete(actionKey);
        console.error('Falha ao preparar sessão fixa para a Galeria de Atividades:', error);
        showToast('Não foi possível preparar a sessão. Nenhum dado da galeria foi alterado.', 'error');
        return;
      }
    }

    setActionSession(null);
    onNavigateToPatientGallery(patient.id, targetSessionId);
  };


  // ── Action handlers for the modal ─────────────────────────────
  const handleActionOk = async (session: ProcessedSession) => {
    if (session.isVirtual) {
      const patientName = state.patients.find(p => p.id === session.patientId)?.name || 'Atendimento';
      await persistVirtualAction(session, SessionStatus.REALIZADA, `${patientName} - Presença registrada.`);
    } else {
      await markAsRealized(session);
    }
    setActionSession(null);
  };

  const handleActionFalta = async (session: ProcessedSession) => {
    if (session.isVirtual) {
      await persistVirtualAction(session, SessionStatus.FALTA, 'Falta registrada. Reposição pendente criada.');
    } else {
      await markAsMissed(session);
    }
    setActionSession(null);
  };

  const handleActionFaltaProf = async (session: ProcessedSession) => {
    if (session.isVirtual) {
      await persistVirtualAction(session, SessionStatus.FALTA_PROF, 'Sua falta registrada. Reposição pendente criada.');
    } else {
      await markAsMissedProf(session);
    }
    setActionSession(null);
  };

  const handleActionCancel = async (session: ProcessedSession) => {
    if (session.isVirtual) {
      await persistVirtualAction(session, SessionStatus.CANCELADA, 'Sessão cancelada.');
    } else {
      const updatedSessions = state.sessions.map(s =>
        s.id === session.id ? { ...s, status: SessionStatus.CANCELADA } : s
      );
      try {
        await onUpdate({ sessions: updatedSessions });
        showToast('Sessão cancelada.');
      } catch (error) {
        console.error('Falha ao cancelar sessão:', error);
        showToast('Não foi possível cancelar a sessão.', 'error');
      }
    }
    setActionSession(null);
  };

  const handleActionDelete = (session: ProcessedSession) => {
    if (session.isVirtual) return;
    setActionSession(null);
    setSessionToDelete(session.id);
  };

  const handleActionReopen = (session: ProcessedSession) => {
    if (session.isVirtual) return;
    const updatedSessions = state.sessions.map(s =>
      s.id === session.id ? { ...s, status: SessionStatus.AGENDADA } : s
    );
    onUpdate({ sessions: updatedSessions });
    showToast(`Sessão de ${state.patients.find(p => p.id === session.patientId)?.name} reaberta como Agendada.`);
    setActionSession(null);
  };

  // ── Existing handlers ─────────────────────────────────────────
  const openRepoModal = (reposition: Reposition) => {
    const patient = state.patients.find(p => p.id === reposition.patientId);
    const originalSession = state.sessions.find(s => s.id === reposition.originalSessionId) ?? null;
    if (!patient) return;
    const nextDate = format(new Date(), 'yyyy-MM-dd');
    setRepoDate(nextDate);
    setRepoTime(patient.fixedTime || AVAILABLE_TIMES[0]);
    setRepoModal({ reposition, patient, originalSession });
  };

  const handleConfirmReposition = () => {
    if (!repoModal || !repoDate || !repoTime) {
      showToast('Selecione a data e o horário para a reposição.', 'error');
      return;
    }
    if (!isValidTime(repoTime)) {
      showToast('Por favor, insira um horário válido no formato HH:00 ou HH:30 (ex: 17:30).', 'error');
      return;
    }
    const normalizedRepoTime = normalizeTime(repoTime);
    const { reposition, patient, originalSession } = repoModal;
    const newSession: Session = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: patient.id,
      date: repoDate,
      time: repoTime,
      type: originalSession?.type || SessionType.SIMPLES,
      status: SessionStatus.AGENDADA,
      notes: `Reposição referente à falta do dia ${originalSession ? format(new Date(originalSession.date + 'T12:00:00'), 'dd/MM/yyyy') : '--'}`,
      packageNumber: originalSession?.packageNumber || 0,
    };
    const updatedRepositions = state.repositions.map(r =>
      r.id === reposition.id ? { ...r, status: 'Agendada' as const } : r
    );
    onUpdate({ sessions: [...state.sessions, newSession], repositions: updatedRepositions });
    showToast(`Reposição de ${patient.name} agendada para ${format(new Date(repoDate + 'T12:00:00'), 'dd/MM')} às ${repoTime}!`, 'success');
    setRepoModal(null);
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate]);

  const activeDays = weekDays.filter(d => [1, 2, 3, 4, 5, 6].includes(d.getDay()));

  const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

  const openNewSession = (d: Date, t: string) => {
    setSelectedSlot({ date: format(d, 'yyyy-MM-dd'), time: t });
    setIsModalOpen(true);
  };

  const handleSaveSession = () => {
    if (!selectedSlot) return;

    if (!isValidTime(selectedSlot.time)) {
      showToast('Por favor, insira um horário de atendimento válido no formato HH:00 ou HH:30 (ex: 17:30).', 'error');
      return;
    }
    const normalizedTime = normalizeTime(selectedSlot.time);
    const holiday = state.settings.holidays?.find(h => h.date === selectedSlot.date);

    if (isBlockMode) {
      if (!notes.trim()) {
        showToast('Informe o nome do compromisso para bloquear o horário.', 'error');
        return;
      }
      const blockedSession: Session = {
        id: Math.random().toString(36).substr(2, 9),
        patientId: '__BLOCKED__',
        date: selectedSlot.date,
        time: selectedSlot.time,
        type: SessionType.SIMPLES,
        status: SessionStatus.AGENDADA,
        notes: '',
        packageNumber: null,
        isBlocked: true,
        blockName: notes.trim(),
      };
      onUpdate({ sessions: [...state.sessions, blockedSession] });
      showToast('Horário bloqueado com sucesso!');
      setIsModalOpen(false);
      resetForm();
      return;
    }

    if (!patientId) return;

    const patient = state.patients.find(p => p.id === patientId);
    if (!patient) return;

    if (holiday) {
      showToast(`Não é possível agendar em data fechada: ${holiday.name}.`, 'error');
      return;
    }

    const occupiedSession = state.sessions.find(s =>
      s.date === selectedSlot.date &&
      normalizeTime(s.time) === normalizedTime &&
      !s.isBlocked &&
      s.status !== SessionStatus.CANCELADA
    );
    if (occupiedSession) {
      const occupiedPatient = state.patients.find(p => p.id === occupiedSession.patientId);
      showToast(`Horário já ocupado por ${occupiedPatient?.name || 'outro registro'}.`, 'error');
      return;
    }

    const newSessionId = Math.random().toString(36).substr(2, 9);
    const previewSession: Session = {
      id: newSessionId,
      patientId,
      date: selectedSlot.date,
      time: normalizedTime,
      type: sessionType,
      status: SessionStatus.AGENDADA,
      notes,
      packageNumber: 0
    };
    const nextSessionNumber = getSessionCycleNumber([...state.sessions, previewSession], previewSession);

    const newSession: Session = {
      ...previewSession,
      patientId,
      date: selectedSlot.date,
      time: normalizedTime,
      type: sessionType,
      status: SessionStatus.AGENDADA,
      notes,
      packageNumber: nextSessionNumber
    };

    onUpdate({ sessions: [...state.sessions, newSession] });
    showToast('Sessão agendada com sucesso!');
    setIsModalOpen(false);
    resetForm();
  };

  const markAsRealized = async (session: Session) => {
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.REALIZADA } : s
    );
    const updatedRepositions = state.repositions.filter(r => !(r.originalSessionId === session.id && r.status === 'Pendente'));
    try {
      await onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
      showToast(`${state.patients.find(p => p.id === session.patientId)?.name} - Presença registrada.`);
    } catch (error) {
      console.error('Falha ao registrar presença:', error);
      showToast('Não foi possível registrar a presença.', 'error');
    }
  };

  const markAsMissed = async (session: Session) => {
    const consumesPackage = window.confirm(
      'Esta falta deve consumir uma das 10 sessões do pacote?\n\nOK = Sim, consumir a sessão.\nCancelar = Não consumir a sessão.'
    );
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA, consumesPackage } : s
    );
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };
    try {
      await onUpdate({ sessions: updatedSessions, repositions: [...state.repositions, newReposition] });
      showToast('Falta registrada. Reposição pendente criada.');
    } catch (error) {
      console.error('Falha ao registrar falta:', error);
      showToast('Não foi possível registrar a falta.', 'error');
    }
  };

  const markAsMissedProf = async (session: Session) => {
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA_PROF } : s
    );
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };
    try {
      await onUpdate({ sessions: updatedSessions, repositions: [...state.repositions, newReposition] });
      showToast('Sua falta registrada. Reposição pendente criada.');
    } catch (error) {
      console.error('Falha ao registrar falta do profissional:', error);
      showToast('Não foi possível registrar a falta do profissional.', 'error');
    }
  };

  const deleteSession = (id: string) => {
    setSessionToDelete(id);
  };

  const confirmDeleteSession = () => {
    if (sessionToDelete) {
      const updatedSessions = state.sessions.filter(s => s.id !== sessionToDelete);
      const updatedRepositions = state.repositions.filter(r => r.originalSessionId !== sessionToDelete);
      onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
      showToast('Sessão removida com sucesso');
      setSessionToDelete(null);
    }
  };

  const resetForm = () => {
    setPatientId('');
    setSessionType(SessionType.SIMPLES);
    setNotes('');
    setSelectedSlot(null);
    setIsBlockMode(false);
  };

  const getDayNameKey = (day: number): string => {
    const keys: Record<number, string> = { 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
    return keys[day] || '';
  };

  const getDayNameLabel = (day: number) => {
    const labels: Record<number, string> = { 1: 'SEGUNDA', 2: 'TERÇA', 3: 'QUARTA', 4: 'QUINTA', 5: 'SEXTA', 6: 'SÁBADO' };
    return labels[day] || '';
  };

  const [filterPatientId, setFilterPatientId] = useState<string>('');

  // ── Determine if the session has available actions ──────────
  const getSessionActions = (s: ProcessedSession): {
    canOk: boolean; canFalta: boolean; canFaltaProf: boolean;
    canCancel: boolean; canReopen: boolean; canDelete: boolean;
  } => {
    if (s.isBlocked) return { canOk: false, canFalta: false, canFaltaProf: false, canCancel: false, canReopen: false, canDelete: true };
    if (s.isVirtual && s.isValid) {
      // Virtual sessions behave like Agendada
      return { canOk: true, canFalta: true, canFaltaProf: true, canCancel: true, canReopen: false, canDelete: false };
    }
    if (s.isVirtual) return { canOk: false, canFalta: false, canFaltaProf: false, canCancel: false, canReopen: false, canDelete: false };

    // Manual sessions
    switch (s.status) {
      case SessionStatus.AGENDADA:
        return { canOk: true, canFalta: true, canFaltaProf: true, canCancel: true, canReopen: false, canDelete: true };
      case SessionStatus.REALIZADA:
      case SessionStatus.FALTA:
      case SessionStatus.FALTA_PROF:
      case SessionStatus.CANCELADA:
        return { canOk: false, canFalta: false, canFaltaProf: false, canCancel: false, canReopen: true, canDelete: true };
      case SessionStatus.REPOSICAO:
        return { canOk: true, canFalta: true, canFaltaProf: true, canCancel: true, canReopen: false, canDelete: true };
      default:
        return { canOk: false, canFalta: false, canFaltaProf: false, canCancel: false, canReopen: false, canDelete: true };
    }
  };

  const buildAvailableSlotTooltip = (day: Date, time: string, holidayName?: string) => {
    const dateLabel = safeFormatDate(format(day, 'yyyy-MM-dd'), 'dd/MM/yyyy');
    if (holidayName) {
      return [
        `Horário fechado: ${time}`,
        `Data: ${dateLabel}`,
        `Motivo: feriado/recesso (${holidayName})`,
        'O robô WhatsApp não deve enviar lembretes para este horário.'
      ].join('\n');
    }

    return [
      `Horário disponível: ${time}`,
      `Data: ${dateLabel}`,
      'Clique para agendar uma sessão ou bloquear este horário.',
      'Nenhuma mensagem WhatsApp é enviada ao clicar; o envio automático segue apenas os horários do robô.'
    ].join('\n');
  };

  const buildSessionTooltip = (session: ProcessedSession, patient?: AppState['patients'][0]) => {
    const statusLabel = getStatusLabel(session);
    const details = [
      `Horário: ${session.time}`,
      `Data: ${safeFormatDate(session.date, 'dd/MM/yyyy')}`,
      `Status: ${statusLabel}`,
      `Origem: ${session.isVirtual ? 'Agenda fixa calculada' : 'Registro manual'}`
    ];

    if (session.isBlocked) {
      details.push(`Bloqueio: ${session.blockName || 'Compromisso bloqueado'}`);
    } else {
      details.push(`Atendente: ${patient?.name || 'Não localizado'}`);
      details.push(`Responsável: ${patient?.guardianName || 'Não informado'}`);
      details.push(`WhatsApp: ${patient?.whatsapp || 'Não informado'}`);
      details.push(`Tipo: ${session.type || 'Não informado'}`);
      details.push(getSessionCycleLabel(state.sessions, session) || 'Sessão sem número definido');
    }

    if (session.notes?.trim()) details.push(`Observações: ${session.notes.trim()}`);
    if (session.blockedReason) details.push(`Motivo/alerta: ${session.blockedReason}`);

    details.push(session.isBlocked ? 'Passe o mouse no botão Remover para excluir este bloqueio.' : 'Clique para abrir as ações rápidas deste horário.');
    return details.join('\n');
  };

  return (
    <div className="flex flex-col gap-6 py-6 pb-24">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-clinic gap-4">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-clinic-text tracking-tight">Agenda Semanal</h2>
          <div className="flex items-center gap-2 mt-1">
            <Users size={12} className="text-clinic-text-faint" />
            <select 
              value={filterPatientId} 
              onChange={(e) => setFilterPatientId(e.target.value)}
              className="text-[10px] font-bold uppercase bg-transparent border-none outline-none text-clinic-primary cursor-pointer"
            >
              <option value="">Todos os Atendentes</option>
              {state.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handlePrevWeek} className="p-2.5 hover:bg-clinic-bg text-clinic-text-muted rounded-xl border border-clinic-border transition-all active:scale-90 bg-white shadow-sm" aria-label="Semana anterior">
            <ChevronLeft size={20} />
          </button>
          <span className="font-bold min-w-[150px] text-center text-clinic-text uppercase tracking-widest text-sm">
            {format(weekDays[0], "dd/MM")} — {format(weekDays[6], "dd/MM")}
          </span>
          <button onClick={handleNextWeek} className="p-2.5 hover:bg-clinic-bg text-clinic-text-muted rounded-xl border border-clinic-border transition-all active:scale-90 bg-white shadow-sm" aria-label="Próxima semana">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* ── Agenda Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
        {activeDays.map(day => {
          const dayKey = getDayNameKey(day.getDay());
          const scheduledTimes = SCHEDULE_CONFIG[dayKey] || [];
          const dayStr = format(day, 'yyyy-MM-dd');
          const holiday = state.settings.holidays?.find(h => h.date === dayStr);

          const daySessions = getSessionsForDate({
            dateStr: dayStr,
            patients: state.patients,
            sessions: state.sessions,
            settings: state.settings
          });

          const times = scheduledTimes;

          return (
            <div key={day.toISOString()} className={cn("rounded-xl border shadow-sm flex flex-col h-full overflow-hidden", holiday ? "bg-status-red-bg/5 border-status-red-text/20" : "bg-clinic-surface border-clinic-border")}>
              <div className={cn("px-2 py-1.5 text-center border-b", holiday ? "bg-status-red-text text-white border-status-red-text/30" : "bg-clinic-header text-white border-clinic-border")}>
                <span className="block text-[10px] font-black opacity-80 tracking-[0.2em] mb-0.5">{getDayNameLabel(day.getDay())}</span>
                <span className="block text-xl font-bold">{format(day, 'dd/MM')}</span>
                {holiday && <span className="block text-[9px] font-black uppercase mt-1 opacity-90 truncate px-1" title={holiday.name}>{holiday.name}</span>}
              </div>
              <div className="p-1.5 space-y-1.5 flex-1">
                {times.map(time => {
                  const mergedSessions = daySessions.filter(s => getHourBase(s.time) === time);

                  const filteredSessions = filterPatientId
                    ? mergedSessions.filter(s => s.patientId === filterPatientId)
                    : mergedSessions;

                  if (filterPatientId && filteredSessions.length === 0 && mergedSessions.length > 0) {
                    return (
                      <div
                        key={time}
                        className="p-2 rounded-lg border border-dashed border-clinic-border/20 min-h-[60px] opacity-20 transition-opacity"
                        title={[
                          `Horário: ${time}`,
                          `Data: ${safeFormatDate(dayStr, 'dd/MM/yyyy')}`,
                          'Há sessão neste horário, mas ela está oculta pelo filtro de atendente selecionado.'
                        ].join('\n')}
                      >
                        <span className="text-xs font-bold text-clinic-text-faint">{time}</span>
                      </div>
                    );
                  }

                  if (holiday && mergedSessions.length === 0) {
                    return (
                      <div
                        key={time}
                        className="p-2 rounded-lg border border-dashed border-status-red-text/20 min-h-[60px] opacity-40 bg-status-red-bg/20 flex flex-col items-center justify-center"
                        title={buildAvailableSlotTooltip(day, time, holiday.name)}
                      >
                        <span className="text-[10px] font-bold text-status-red-text line-through opacity-50">{time}</span>
                        <span className="text-[8px] font-black uppercase text-status-red-text mt-1 opacity-70">Fechado</span>
                      </div>
                    );
                  }

                  if (mergedSessions.length === 0) {
                    return (
                      <div key={time} className="group relative">
                        <div 
                          className="p-2 rounded-lg border min-h-[60px] transition-all flex flex-col justify-between bg-green-500/10 hover:bg-green-500/20 border-green-500/30 border-dashed cursor-pointer shadow-inner"
                          onClick={() => openNewSession(day, time)}
                          title={buildAvailableSlotTooltip(day, time)}
                          aria-label={buildAvailableSlotTooltip(day, time)}
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-clinic-text">{time}</span>
                          </div>
                          <span className="text-[9px] italic text-clinic-text-muted opacity-30 group-hover:opacity-80 transition-opacity">Disponível</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={time}
                      className="flex flex-col gap-1.5 p-1.5 rounded-xl border border-clinic-border bg-clinic-bg/10 min-h-[70px]"
                      title={[
                        `Horário-base: ${time}`,
                        `Data: ${safeFormatDate(dayStr, 'dd/MM/yyyy')}`,
                        `Sessões neste horário: ${filteredSessions.length}`,
                        'Clique em uma sessão para ver ações rápidas e detalhes completos.'
                      ].join('\n')}
                    >
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[10px] font-bold text-clinic-text-faint">{time}</span>
                        <button
                          onClick={() => openNewSession(day, time)}
                          className="text-[9px] font-black text-clinic-primary uppercase hover:underline cursor-pointer"
                          title={[
                            `Adicionar novo agendamento às ${time}`,
                            `Data: ${safeFormatDate(dayStr, 'dd/MM/yyyy')}`,
                            'Abre o formulário de agendamento. Não envia WhatsApp automaticamente.'
                          ].join('\n')}
                        >
                          + Novo
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {filteredSessions.map(session => {
                          const patient = session.isBlocked ? null : state.patients.find(p => p.id === session.patientId);
                          const isBlocked = !!session.isBlocked;
                          const isVirtual = session.isVirtual;
                          const isOnHoliday = !!holiday;
                          const statusLabel = getStatusLabel(session);
                          const sessionActions = getSessionActions(session);
                          const canAct = sessionActions.canOk || sessionActions.canFalta || sessionActions.canFaltaProf || sessionActions.canCancel;
                          const sessionCycleLabel = getSessionCycleLabel(state.sessions, session);

                          const handleCardClick = () => {
                            if (!isBlocked && patient) {
                              // Sempre abre o modal de ações (funciona no mobile e desktop ao clicar)
                              setActionSession(session);
                            }
                          };

                          return (
                            <div key={session.id} className="group relative">
                              <div
                                onClick={handleCardClick}
                                title={buildSessionTooltip(session, patient || undefined)}
                                aria-label={buildSessionTooltip(session, patient || undefined)}
                                className={cn(
                                  "p-2 rounded-lg border min-h-[56px] transition-all flex flex-col justify-between shadow-sm",
                                  isBlocked || !patient ? '' : 'cursor-pointer hover:shadow-md hover:border-clinic-primary/40 hover:scale-[1.01]',
                                  getStatusCardBg(session)
                                )}
                              >
                                {/* Top row: time + status badge */}
                                <div className="flex justify-between items-start gap-1">
                                  <span className={cn("text-[10px] font-black leading-none", isBlocked ? "text-[#5D4037]" : "text-clinic-text")}>
                                    {session.time}
                                  </span>
                                  <span className={cn(
                                    "text-[8px] font-black px-1.5 py-0.5 rounded uppercase whitespace-nowrap leading-tight",
                                    getStatusBadgeStyle(
                                      session.isBlocked ? 'Bloqueado' :
                                      session.status === SessionStatus.CANCELADA ? 'Cancelada' :
                                      session.status === SessionStatus.FALTA ? 'Falta' :
                                      session.status === SessionStatus.FALTA_PROF ? 'Falta.Prof' :
                                      session.status === SessionStatus.REALIZADA ? 'Realizada' :
                                      session.status === SessionStatus.REPOSICAO ? 'Reposição' :
                                      session.status === SessionStatus.AGENDADA ? 'Agendada' :
                                      ''
                                    )
                                  )}>
                                    {statusLabel}
                                  </span>
                                </div>

                                {/* Patient name or block name */}
                                <div className="flex flex-col mt-0.5">
                                  {isBlocked ? (
                                    <span className="font-bold text-xs truncate leading-tight text-[#5D4037]">{session.blockName}</span>
                                  ) : (
                                    <span className={cn(
                                      "font-bold text-xs truncate leading-tight",
                                      session.status === 'Cancelada' || (!session.isValid && session.blockedReason === 'sessão cancelada')
                                        ? "line-through text-gray-400"
                                        : "text-clinic-text"
                                    )}>
                                      {patient?.name || '—'}
                                    </span>
                                  )}

                                  {/* Notes preview if not blocked */}
                                  {!isBlocked && session.notes && session.notes.trim() && (
                                    <span className="text-[10px] text-clinic-text-muted mt-1 truncate italic leading-snug">
                                      {session.notes.trim().substring(0, 40)}{session.notes.trim().length > 40 ? '…' : ''}
                                    </span>
                                  )}

                                  {/* Virtual / double indicators */}
                                  {!isBlocked && (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      {isVirtual && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-clinic-primary/10 text-clinic-primary leading-tight">Fixo</span>
                                      )}
                                      {session.type === SessionType.DUPLA && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-clinic-primary/10 text-clinic-primary leading-tight">Dupla</span>
                                      )}
                                      {!isBlocked && sessionCycleLabel && (
                                        <span className="text-[9px] font-medium text-clinic-text-muted leading-tight">
                                          {sessionCycleLabel}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Sem overlay — clique abre modal em qualquer tamanho de tela */}
                                </div>
                              </div>

                              {/* Remove button for blocked sessions (always visible on hover) */}
                              {isBlocked && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                                  className="absolute top-1 right-1 text-[7px] text-status-red-text font-black uppercase opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 px-1 rounded"
                                >
                                  Remover
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Legend ── */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-clinic-border bg-clinic-bg/30">
          <h3 className="text-sm font-bold text-clinic-text uppercase tracking-wide">Legenda de Cores</h3>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap gap-3">
            {STATUS_LEGEND.map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className={cn(
                  "w-4 h-4 rounded border",
                  item.colorClass
                )} />
                <span className="text-[11px] font-medium text-clinic-text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Session Action Modal ── */}
      {actionSession && (() => {
        const patient = state.patients.find(p => p.id === actionSession.patientId);
        const statusLabel = getStatusLabel(actionSession);
        const actions = getSessionActions(actionSession);

        return (
          <Modal
            isOpen={true}
            onClose={() => setActionSession(null)}
            title={patient?.name || 'Sessão'}
            width="max-w-xl"
          >
            <div className="space-y-4">
              {/* Info card com gradiente */}
              <div className="rounded-2xl overflow-hidden border border-clinic-border shadow-sm">
                <div className="bg-gradient-to-r from-clinic-primary/10 to-clinic-primary/5 px-4 py-3 flex justify-between items-start">
                  <div>
                    <p className="text-base font-black text-clinic-text">{patient?.name}</p>
                    <p className="text-xs text-clinic-text-muted mt-0.5">
                      📅 {safeFormatDate(actionSession.date, 'dd/MM/yyyy')} &nbsp;•&nbsp; 🕐 {actionSession.time}
                      {actionSession.isVirtual && <span className="ml-2 text-clinic-primary font-bold">📌 Fixo</span>}
                    </p>
                  </div>
                  <span className={cn("text-[10px] font-black px-2.5 py-1 rounded-full uppercase shadow-sm", getStatusBadgeStyle(
                    actionSession.isBlocked ? 'Bloqueado' :
                    actionSession.status === SessionStatus.CANCELADA ? 'Cancelada' :
                    actionSession.status === SessionStatus.FALTA ? 'Falta' :
                    actionSession.status === SessionStatus.FALTA_PROF ? 'Falta.Prof' :
                    actionSession.status === SessionStatus.REALIZADA ? 'Realizada' :
                    actionSession.status === SessionStatus.REPOSICAO ? 'Reposição' :
                    actionSession.status === SessionStatus.AGENDADA ? 'Agendada' :
                    ''
                  ))}>
                    {statusLabel}
                  </span>
                </div>
                <div className="bg-white px-4 py-2.5 space-y-1 border-t border-clinic-border/50">
                  {patient && (
                    <p className="text-xs text-clinic-text-muted">
                      👤 Responsável: <span className="font-semibold text-clinic-text">{patient.guardianName}</span>
                      {patient.whatsapp && <span className="ml-2">📱 {patient.whatsapp}</span>}
                    </p>
                  )}
                  <p className="text-xs text-clinic-text-muted">🗂 {actionSession.type}</p>
                  {actionSession.notes && actionSession.notes.trim() && (
                    <p className="text-xs text-clinic-text-muted italic border-t border-clinic-border/40 pt-1.5 mt-1">
                      📝 {actionSession.notes.trim()}
                    </p>
                  )}
                  {actionSession.blockedReason && actionSession.blockedReason !== 'status inválido' && (
                    <p className="text-[10px] font-bold text-status-red-text uppercase">
                      ⚠️ {actionSession.blockedReason}
                    </p>
                  )}
                </div>
              </div>

              {patient && (
                <div className="rounded-2xl border border-clinic-border bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-clinic-text-faint uppercase tracking-widest">Anotações gerais do paciente</p>
                      <p className="text-xs text-clinic-text-muted mt-0.5">Mesmo campo usado no cadastro completo.</p>
                    </div>
                    {!isEditingActionGeneralNotes ? (
                      <button
                        type="button"
                        onClick={() => setIsEditingActionGeneralNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-primary font-black uppercase text-[10px] hover:bg-clinic-border/40 transition"
                      >
                        Editar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActionGeneralNotesDraft(patient.clinicalNotes || '');
                          setIsEditingActionGeneralNotes(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-text-muted font-black uppercase text-[10px] hover:bg-clinic-border/40 transition"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {isEditingActionGeneralNotes ? (
                    <>
                      <textarea
                        value={actionGeneralNotesDraft}
                        onChange={e => setActionGeneralNotesDraft(e.target.value)}
                        className="w-full min-h-[108px] rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-clinic-primary"
                        placeholder="Anotações gerais sincronizadas com o cadastro do paciente."
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActionGeneralNotesDraft(patient.clinicalNotes || '');
                            setIsEditingActionGeneralNotes(false);
                          }}
                          className="py-2 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-text-muted font-black uppercase tracking-wide text-[10px] hover:bg-clinic-border/40 transition"
                        >
                          Cancelar edição
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            saveGeneralNotes(patient.id, actionGeneralNotesDraft);
                            setIsEditingActionGeneralNotes(false);
                          }}
                          className="py-2 rounded-lg bg-clinic-primary text-white font-black uppercase tracking-wide text-[10px] hover:bg-clinic-primary-hover transition"
                        >
                          Salvar anotações
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="min-h-[52px] rounded-xl bg-clinic-bg border border-clinic-border px-3 py-2 text-sm text-clinic-text-muted whitespace-pre-wrap">
                      {patient.clinicalNotes?.trim() || 'Sem anotações gerais registradas.'}
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFilterPatientId(patient.id);
                        setActionSession(null);
                        showToast('Filtro aplicado na agenda para este atendente.', 'success');
                      }}
                      className="w-full py-2 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-primary font-black uppercase tracking-wide text-[10px] hover:bg-clinic-border/40 transition"
                    >
                      Ver histórico na agenda
                    </button>
                    {onNavigateToPatient && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionSession(null);
                          onNavigateToPatient(patient.id);
                        }}
                        className="w-full py-2 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-primary font-black uppercase tracking-wide text-[10px] hover:bg-clinic-border/40 transition"
                      >
                        Ver cadastro completo
                      </button>
                    )}
                  </div>
                </div>
              )}

              {patient && onNavigateToPatientGallery && (
                <button
                  type="button"
                  onClick={() => void handleOpenActivityGallery(actionSession)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-clinic-primary/25 bg-clinic-primary text-white font-bold hover:bg-clinic-primary-hover active:scale-95 transition-all"
                  title={`Registrar atividade de ${patient.name} nesta sessão`}
                >
                  <Images size={17} /> Registrar atividade
                </button>
              )}


              {/* ── Botões de ação ── */}
              {(actions.canOk || actions.canFalta || actions.canFaltaProf || actions.canCancel || actions.canReopen) && (
                <div className="space-y-2.5">
                  <p className="text-[10px] font-black text-clinic-text-faint uppercase tracking-widest">⚡ Ações Rápidas</p>

                  {(actions.canOk || actions.canFalta || actions.canFaltaProf || actions.canCancel) && (
                    <div className="grid grid-cols-2 gap-2">
                      {actions.canOk && (
                        <button
                          onClick={() => handleActionOk(actionSession)}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 bg-gradient-to-b from-emerald-400 to-emerald-600 text-white font-bold rounded-xl shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
                        >
                          <span className="text-base">✅</span>
                          <span className="text-xs font-black uppercase">OK / Presença</span>
                        </button>
                      )}
                      {actions.canFalta && (
                        <button
                          onClick={() => handleActionFalta(actionSession)}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 bg-gradient-to-b from-red-400 to-red-600 text-white font-bold rounded-xl shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
                        >
                          <span className="text-base">❌</span>
                          <span className="text-xs font-black uppercase">Falta</span>
                        </button>
                      )}
                      {actions.canFaltaProf && (
                        <button
                          onClick={() => handleActionFaltaProf(actionSession)}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 bg-gradient-to-b from-amber-400 to-amber-600 text-white font-bold rounded-xl shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
                        >
                          <span className="text-base">🟠</span>
                          <span className="text-xs font-black uppercase">Falta Prof.</span>
                        </button>
                      )}
                      {actions.canCancel && (
                        <button
                          onClick={() => handleActionCancel(actionSession)}
                          className="flex items-center justify-center gap-2 py-2.5 px-3 bg-gradient-to-b from-slate-400 to-slate-600 text-white font-bold rounded-xl shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
                        >
                          <span className="text-base">🚫</span>
                          <span className="text-xs font-black uppercase">Cancelar</span>
                        </button>
                      )}
                    </div>
                  )}

                  {actions.canReopen && (
                    <button
                      onClick={() => handleActionReopen(actionSession)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-blue-800 text-white font-bold rounded-xl shadow-sm hover:-translate-y-0.5 active:scale-95 transition-all duration-150"
                    >
                      <span>↻</span>
                      <span className="text-sm font-black uppercase tracking-wide">Reabrir como Agendada</span>
                    </button>
                  )}
                </div>
              )}

              {/* Remover sessão */}
              {actions.canDelete && !actionSession.isVirtual && (
                <button
                  onClick={() => handleActionDelete(actionSession)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-rose-50 text-rose-600 border border-rose-200 font-bold rounded-xl hover:bg-rose-100 active:scale-95 transition-all duration-150 text-sm"
                >
                  🗑 Remover Sessão
                </button>
              )}

              {!actions.canOk && !actions.canFalta && !actions.canFaltaProf && !actions.canCancel && !actions.canReopen && !actions.canDelete && (
                <div className="text-center text-xs text-clinic-text-muted italic py-2">
                  Nenhuma ação disponível para esta sessão.
                </div>
              )}

              <button
                onClick={() => setActionSession(null)}
                className="w-full py-2.5 bg-clinic-bg text-clinic-text-muted font-bold rounded-xl hover:bg-clinic-border transition-all uppercase tracking-widest text-xs"
              >
                Fechar
              </button>
            </div>
          </Modal>
        );
      })()}



      {/* ── Faltas e Reposições Pendentes ── */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2 bg-clinic-bg/30">
          <AlertCircle size={20} className="text-status-red-text" />
          <h3 className="text-xl font-bold">Faltas e Reposições Pendentes</h3>
        </div>
        <div className="p-6">
          {state.repositions.filter(r => r.status === 'Pendente').length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {state.repositions.filter(r => r.status === 'Pendente').map(reposition => {
                const patient = state.patients.find(p => p.id === reposition.patientId);
                const originalSession = state.sessions.find(s => s.id === reposition.originalSessionId);
                return (
                  <div key={reposition.id} className="p-4 rounded-xl border border-clinic-border flex flex-col gap-3 justify-between">
                    <div>
                      <h4 className="font-bold text-clinic-text">{patient?.name}</h4>
                      <p className="text-xs text-clinic-text-muted">Faltou em {originalSession ? safeFormatDate(originalSession.date, 'dd/MM') : '--'}</p>
                    </div>
                    <button
                      onClick={() => {
                        const reposition = state.repositions.find(r => r.patientId === patient?.id && r.status === 'Pendente');
                        if (reposition) {
                          openRepoModal(reposition);
                        } else {
                          setPatientId(patient?.id || '');
                          setSessionType(SessionType.SIMPLES);
                          setIsModalOpen(true);
                        }
                      }}
                      className="w-full py-2 bg-clinic-primary/10 text-clinic-primary text-xs font-bold rounded-lg hover:bg-clinic-primary hover:text-white transition-all uppercase tracking-wide"
                    >
                      Agendar Reposição
                    </button>
                    <button
                      onClick={() => {
                        const reposition = state.repositions.find(r => r.patientId === patient?.id && r.status === 'Pendente');
                        if (reposition) {
                          const updatedRepositions = state.repositions.map(r =>
                            r.id === reposition.id ? { ...r, status: 'Concluída' as const, contactDate: format(new Date(), 'yyyy-MM-dd'), result: 'aceitou' } : r
                          );
                          onUpdate({ repositions: updatedRepositions });
                          showToast('Reposição marcada como aceita.');
                        }
                      }}
                      className="w-full mt-1 py-2 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-all uppercase tracking-wide"
                    >
                      Responsável Aceitou
                    </button>
                    <button
                      onClick={() => {
                        const reposition = state.repositions.find(r => r.patientId === patient?.id && r.status === 'Pendente');
                        if (reposition) {
                          const updatedRepositions = state.repositions.map(r =>
                            r.id === reposition.id ? { ...r, status: 'Concluída' as const, contactDate: format(new Date(), 'yyyy-MM-dd'), result: 'recusou' } : r
                          );
                          onUpdate({ repositions: updatedRepositions });
                          showToast('Reposição marcada como recusada.');
                        }
                      }}
                      className="w-full mt-1 py-2 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition-all uppercase tracking-wide"
                    >
                      Responsável Recusou
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-clinic-text-muted text-center py-6 italic">Não há faltas pendentes de reposição.</p>
          )}
        </div>
      </div>

      {/* ── Modal Nova Sessão ── */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); resetForm(); }} 
        title={selectedSlot ? (isBlockMode ? `Bloquear: ${safeFormatDate(selectedSlot.date, 'dd/MM')} — ${selectedSlot.time}` : `Agendar: ${safeFormatDate(selectedSlot.date, 'dd/MM')} — ${selectedSlot.time}`) : 'Agendar Sessão'}
        width="max-w-4xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-5">
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">Atendente</label>
              <select 
                value={isBlockMode ? '__BLOCK__' : patientId}
                onChange={(e) => {
                  if (e.target.value === '__BLOCK__') {
                    setIsBlockMode(true);
                    setPatientId('');
                  } else {
                    setIsBlockMode(false);
                    setPatientId(e.target.value);
                  }
                }}
                className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all"
              >
                <option value="">Selecione um atendente...</option>
                <option value="__BLOCK__">Bloquear Horário</option>
                {state.patients.filter(p => p.status === 'Ativo').sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedSlot && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-clinic-text-faint uppercase">Horário do atendimento</label>
                  <select
                    value={AVAILABLE_TIMES.includes(selectedSlot.time) ? selectedSlot.time : 'custom'}
                    onChange={e => {
                      if (e.target.value === 'custom') {
                        setSelectedSlot(prev => prev ? { ...prev, time: getHourBase(prev.time).split(':')[0] + ':30' } : null);
                      } else {
                        setSelectedSlot(prev => prev ? { ...prev, time: e.target.value } : null);
                      }
                    }}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm w-full font-medium"
                  >
                    {AVAILABLE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value="custom">Outro horário...</option>
                  </select>
                </div>
                {!isBlockMode && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-clinic-text-faint uppercase">Tipo de Sessão</label>
                    <select 
                      value={sessionType}
                      onChange={(e) => setSessionType(e.target.value as SessionType)}
                      className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all"
                    >
                      <option value={SessionType.SIMPLES}>{SessionType.SIMPLES}</option>
                      <option value={SessionType.DUPLA}>{SessionType.DUPLA}</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {selectedSlot && !AVAILABLE_TIMES.includes(selectedSlot.time) && (
              <input
                type="text"
                placeholder="Ex: 17:30"
                value={selectedSlot.time}
                onChange={e => setSelectedSlot(prev => prev ? { ...prev, time: e.target.value } : null)}
                className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full"
              />
            )}

            {getSchedulingWarnings().length > 0 && (
              <div className="rounded-xl border border-status-orange-text/25 bg-status-orange-bg/70 p-3 space-y-1">
                {getSchedulingWarnings().map(warning => (
                  <p key={warning} className="flex items-start gap-2 text-xs font-semibold text-status-orange-text">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {warning}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-clinic-text-faint uppercase">
                {isBlockMode ? 'Nome do Compromisso *' : 'Observação da sessão'}
              </label>
              <textarea 
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isBlockMode ? 'Ex: Reunião, consulta médica, compromisso pessoal...' : 'Esta observação pertence somente a este agendamento.'}
                className={cn(
                  "px-4 py-3 bg-clinic-bg rounded-xl border focus:ring-2 focus:ring-clinic-primary outline-none transition-all min-h-[104px]",
                  isBlockMode && !notes.trim() ? "border-red-300" : "border-clinic-border"
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPatientId('');
                  setNotes('');
                  setGeneralNotesDraft('');
                }}
                className="py-3 bg-clinic-bg text-clinic-text-muted font-bold rounded-xl border border-clinic-border hover:bg-clinic-border/40 transition-all uppercase tracking-widest text-xs"
              >
                Limpar seleção
              </button>
              <button 
                onClick={handleSaveSession}
                disabled={isBlockMode ? !notes.trim() : !patientId}
                className={cn(
                  "py-3 text-white font-bold rounded-xl shadow-lg transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed text-xs",
                  isBlockMode
                    ? "bg-[#5D4037] hover:bg-[#4E342E]"
                    : "bg-clinic-primary hover:bg-clinic-primary-hover"
                )}
              >
                {isBlockMode ? 'Bloquear Horário' : 'Confirmar Agendamento'}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {selectedPatient && !isBlockMode ? (
              <>
                <div className="rounded-xl border border-clinic-border bg-white shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-clinic-bg/40 border-b border-clinic-border flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xl font-bold text-clinic-text truncate">{selectedPatient.name}</p>
                      <p className="text-xs text-clinic-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1"><User size={13} /> {selectedPatient.guardianName}</span>
                        <span className="inline-flex items-center gap-1"><Phone size={13} /> {selectedPatient.whatsapp || 'Sem telefone'}</span>
                      </p>
                    </div>
                    <span className="px-2 py-1 rounded-full bg-status-green-bg text-status-green-text text-[10px] font-black uppercase">
                      {selectedPatient.status}
                    </span>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-clinic-bg/70 border border-clinic-border p-3">
                      <p className="text-[10px] font-black text-clinic-text-faint uppercase">Última sessão</p>
                      <p className="text-sm font-bold text-clinic-text mt-1">{getPatientSessions(selectedPatient.id).filter(s => [SessionStatus.REALIZADA, SessionStatus.REPOSICAO].includes(s.status)).slice(-1)[0]?.date ? getSessionCycleLabel(state.sessions, getPatientSessions(selectedPatient.id).filter(s => [SessionStatus.REALIZADA, SessionStatus.REPOSICAO].includes(s.status)).slice(-1)[0]) : 'Sem sessão realizada'}</p>
                    </div>
                    <div className="rounded-lg bg-clinic-bg/70 border border-clinic-border p-3">
                      <p className="text-[10px] font-black text-clinic-text-faint uppercase">Próxima lógica</p>
                      <p className="text-sm font-bold text-clinic-text mt-1">{buildPreviewSession() ? getSessionCycleLabel([...state.sessions, buildPreviewSession() as Session], buildPreviewSession() as Session) : '--'}</p>
                    </div>
                    <div className="rounded-lg bg-clinic-bg/70 border border-clinic-border p-3 col-span-2">
                      <p className="text-[10px] font-black text-clinic-text-faint uppercase flex items-center gap-1"><DollarSign size={12} /> Financeiro</p>
                      <p className="text-sm font-bold text-clinic-text mt-1">{getPatientFinancialSummary(selectedPatient.id)}</p>
                    </div>
                  </div>
                </div>

                {onNavigateToPatient && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      resetForm();
                      onNavigateToPatient(selectedPatient.id);
                    }}
                    className="w-full py-2.5 rounded-xl bg-clinic-bg border border-clinic-border text-clinic-primary font-black uppercase tracking-wide text-[10px] hover:bg-clinic-border/40 transition"
                  >
                    Ver cadastro completo do paciente
                  </button>
                )}

                <div className="rounded-xl border border-clinic-border bg-white p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[10px] font-black text-clinic-text-faint uppercase tracking-widest">Histórico recente</p>
                    <Clock size={14} className="text-clinic-text-faint" />
                  </div>
                  <div className="space-y-1.5">
                    {getPatientRecentSessions(selectedPatient.id).length > 0 ? getPatientRecentSessions(selectedPatient.id).map(session => (
                      <div key={session.id} className="flex items-center justify-between gap-2 text-xs border border-clinic-border/60 rounded-lg px-2 py-1.5">
                        <span className="font-bold text-clinic-text">{safeFormatDate(session.date, 'dd/MM')} às {session.time}</span>
                        <span className={cn("font-black uppercase text-[9px] px-1.5 py-0.5 rounded", getStatusBadgeStyle(session.status))}>{session.status}</span>
                      </div>
                    )) : (
                      <p className="text-xs text-clinic-text-muted italic">Sem histórico recente registrado.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-clinic-border bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black text-clinic-text-faint uppercase tracking-widest">Anotações gerais do paciente</p>
                    <FileText size={14} className="text-clinic-text-faint" />
                  </div>
                  <textarea
                    value={generalNotesDraft}
                    onChange={e => setGeneralNotesDraft(e.target.value)}
                    className="w-full min-h-[86px] rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-clinic-primary"
                    placeholder="Anotações gerais sincronizadas com o cadastro do paciente."
                  />
                  <button
                    type="button"
                    onClick={() => saveGeneralNotes(selectedPatient.id, generalNotesDraft)}
                    className="w-full py-2 rounded-lg bg-clinic-bg border border-clinic-border text-clinic-primary font-black uppercase tracking-wide text-[10px] hover:bg-clinic-border/40 transition"
                  >
                    Salvar anotações gerais
                  </button>
                </div>

                <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg/50 p-3">
                  <p className="text-[10px] font-black text-status-green-text uppercase tracking-widest flex items-center gap-1 mb-2">
                    <MessageCircle size={13} /> Prévia WhatsApp
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-clinic-text leading-relaxed">{getWhatsappPreviewMessage()}</p>
                  <p className="text-[10px] text-clinic-text-muted mt-2 font-semibold">Prévia visual. Nenhum envio é executado nesta tela.</p>
                </div>
              </>
            ) : (
              <div className="h-full min-h-[260px] rounded-xl border border-dashed border-clinic-border bg-clinic-bg/40 flex items-center justify-center text-center p-6">
                <p className="text-sm text-clinic-text-muted">
                  Selecione um atendente para ver resumo clínico, histórico, financeiro e prévia do WhatsApp.
                </p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* ── Modal Confirmar Exclusão ── */}
      <Modal
        isOpen={!!sessionToDelete}
        onClose={() => setSessionToDelete(null)}
        title="Confirmar Exclusão"
        width="max-w-md"
      >
        <div className="space-y-6">
          <p className="text-clinic-text">
            Tem certeza que deseja excluir esta sessão? Isso pode afetar o progresso do pacote deste atendente.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setSessionToDelete(null)}
              className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
            >
              Cancelar
            </button>
            <button
              onClick={confirmDeleteSession}
              className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all uppercase tracking-wide text-xs"
            >
              Excluir Sessão
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Agendar Reposição ── */}
      {repoModal && (
        <Modal
          isOpen={true}
          onClose={() => setRepoModal(null)}
          title="Agendar Reposição"
          width="max-w-md"
        >
          <div className="space-y-5">
            <div className="p-3 bg-status-orange-bg rounded-xl border border-status-orange-text/20">
              <p className="text-xs font-bold text-status-orange-text uppercase tracking-wide">Reposição para:</p>
              <p className="text-sm font-bold text-clinic-text mt-0.5">{repoModal.patient.name}</p>
              {repoModal.originalSession && (
                <p className="text-xs text-clinic-text-muted mt-0.5">
                  Falta em {format(new Date(repoModal.originalSession.date + 'T12:00:00'), 'dd/MM/yyyy')} às {repoModal.originalSession.time}
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Data da Reposição</label>
                <input
                  type="date"
                  className="w-full bg-clinic-bg border border-clinic-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-clinic-primary outline-none transition-all"
                  value={repoDate}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={e => {
                    setRepoDate(e.target.value);
                    setRepoTime('');
                  }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">
                  Horário
                  {repoAvailableTimes.length === 0 && <span className="text-status-red-text ml-2 normal-case font-normal">(dia sem horários disponíveis)</span>}
                </label>
                <select
                  className="w-full bg-clinic-bg border border-clinic-border rounded-xl p-3 text-sm focus:ring-2 focus:ring-clinic-primary outline-none transition-all"
                  value={repoAvailableTimes.includes(repoTime) || AVAILABLE_TIMES.includes(repoTime) ? repoTime : 'custom'}
                  onChange={e => {
                    if (e.target.value === 'custom') {
                      setRepoTime('17:30');
                    } else {
                      setRepoTime(e.target.value);
                    }
                  }}
                >
                  <option value="">Selecione o horário...</option>
                  {repoAvailableTimes.map(t => <option key={t} value={t}>{t}</option>)}
                  {repoAvailableTimes.length === 0 && AVAILABLE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="custom">Outro horário...</option>
                </select>
                {repoTime && !repoAvailableTimes.includes(repoTime) && !AVAILABLE_TIMES.includes(repoTime) && (
                  <input
                    type="text"
                    placeholder="Ex: 17:30"
                    value={repoTime}
                    onChange={e => setRepoTime(e.target.value)}
                    className="px-4 py-3 mt-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full"
                  />
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setRepoModal(null)}
                className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmReposition}
                disabled={!repoDate || !repoTime}
                className="px-4 py-2 bg-clinic-primary text-white font-bold rounded-lg shadow hover:bg-clinic-primary-hover transition-all uppercase tracking-wide text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar Reposição
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
