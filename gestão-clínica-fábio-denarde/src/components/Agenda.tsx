import React, { useState, useMemo } from 'react';
import { AppState, Session, SessionStatus, SessionType, Reposition } from '../types';
import { AVAILABLE_TIMES, SCHEDULE_CONFIG } from '../constants';
import { ChevronLeft, ChevronRight, AlertCircle, Users } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { cn, getStatusColor, safeFormatDate, normalizeStr, isValidTime, normalizeTime, addOneHour, getSessionsForDate, ProcessedSession } from '../lib/utils';

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
  onUpdate: (newState: Partial<AppState>) => void;
}

export default function Agenda({ state, onUpdate }: AgendaProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; time: string } | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // Form State
  const [patientId, setPatientId] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>(SessionType.SIMPLES);
  const [notes, setNotes] = useState('');
  const [isBlockMode, setIsBlockMode] = useState(false);

  // Session Action Modal state (safe click/tap on card)
  const [actionSession, setActionSession] = useState<ProcessedSession | null>(null);

  // Touch overlay state (mobile/tablet: tap to show quick actions, tap button to act)
  const [touchOverlayId, setTouchOverlayId] = useState<string | null>(null);

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

  // ── Create real session from virtual ──────────────────────────
  const createRealFromVirtual = (virtualSession: ProcessedSession, newStatus: SessionStatus): { session: Session; reposition?: Reposition } | null => {
    const patient = state.patients.find(p => p.id === virtualSession.patientId);
    if (!patient) return null;
    const patientSessions = state.sessions.filter(s => s.patientId === patient.id);
    const maxPackage = patientSessions.reduce((max, s) => {
      const pn = s.packageNumber || 0;
      return pn > max ? pn : max;
    }, 0);
    let nextPackageNumber = 1;
    if (maxPackage === 0) {
      nextPackageNumber = 1;
    } else {
      const sessionsInCurrent = patientSessions.filter(s => s.packageNumber === maxPackage).length;
      nextPackageNumber = sessionsInCurrent >= 10 ? maxPackage + 1 : maxPackage;
    }
    const newReal: Session = {
      ...virtualSession,
      id: Math.random().toString(36).substr(2, 9),
      status: newStatus,
      packageNumber: nextPackageNumber,
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

  // ── Action handlers for the modal ─────────────────────────────
  const handleActionOk = (session: ProcessedSession) => {
    if (session.isVirtual) {
      const result = createRealFromVirtual(session, SessionStatus.REALIZADA);
      if (result) onUpdate({ sessions: [...state.sessions, result.session] });
      showToast(`${state.patients.find(p => p.id === session.patientId)?.name} - Presença registrada.`);
    } else {
      markAsRealized(session);
    }
    setActionSession(null);
  };

  const handleActionFalta = (session: ProcessedSession) => {
    if (session.isVirtual) {
      const result = createRealFromVirtual(session, SessionStatus.FALTA);
      if (result) {
        onUpdate({
          sessions: [...state.sessions, result.session],
          repositions: result.reposition ? [...state.repositions, result.reposition] : state.repositions,
        });
      }
      showToast(`Falta registrada. Reposição pendente criada.`);
    } else {
      markAsMissed(session);
    }
    setActionSession(null);
  };

  const handleActionFaltaProf = (session: ProcessedSession) => {
    if (session.isVirtual) {
      const result = createRealFromVirtual(session, SessionStatus.FALTA_PROF);
      if (result) {
        onUpdate({
          sessions: [...state.sessions, result.session],
          repositions: result.reposition ? [...state.repositions, result.reposition] : state.repositions,
        });
      }
      showToast(`Sua falta registrada. Reposição pendente criada.`);
    } else {
      markAsMissedProf(session);
    }
    setActionSession(null);
  };

  const handleActionCancel = (session: ProcessedSession) => {
    if (session.isVirtual) {
      const result = createRealFromVirtual(session, SessionStatus.CANCELADA);
      if (result) onUpdate({ sessions: [...state.sessions, result.session] });
      showToast('Sessão cancelada.');
    } else {
      const updatedSessions = state.sessions.map(s =>
        s.id === session.id ? { ...s, status: SessionStatus.CANCELADA } : s
      );
      onUpdate({ sessions: updatedSessions });
      showToast('Sessão cancelada.');
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

    const patientSessions = state.sessions.filter(s => s.patientId === patientId);
    const maxPackage = patientSessions.reduce((max, s) => {
      const pn = s.packageNumber || 0;
      return pn > max ? pn : max;
    }, 0);
    let nextPackageNumber = 1;
    if (maxPackage === 0) {
      nextPackageNumber = 1;
    } else {
      const sessionsInCurrent = patientSessions.filter(s => s.packageNumber === maxPackage).length;
      nextPackageNumber = sessionsInCurrent >= 10 ? maxPackage + 1 : maxPackage;
    }

    const newSession: Session = {
      id: Math.random().toString(36).substr(2, 9),
      patientId,
      date: selectedSlot.date,
      time: selectedSlot.time,
      type: sessionType,
      status: SessionStatus.AGENDADA,
      notes,
      packageNumber: nextPackageNumber
    };

    onUpdate({ sessions: [...state.sessions, newSession] });
    showToast('Sessão agendada com sucesso!');
    setIsModalOpen(false);
    resetForm();
  };

  const markAsRealized = (session: Session) => {
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.REALIZADA } : s
    );
    const updatedRepositions = state.repositions.filter(r => !(r.originalSessionId === session.id && r.status === 'Pendente'));
    onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
    showToast(`${state.patients.find(p => p.id === session.patientId)?.name} - Presença registrada.`);
  };

  const markAsMissed = (session: Session) => {
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA } : s
    );
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };
    onUpdate({ sessions: updatedSessions, repositions: [...state.repositions, newReposition] });
    showToast(`Falta registrada. Reposição pendente criada.`);
  };

  const markAsMissedProf = (session: Session) => {
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
    onUpdate({ sessions: updatedSessions, repositions: [...state.repositions, newReposition] });
    showToast(`Sua falta registrada. Reposição pendente criada.`);
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

  return (
    <div className="flex flex-col gap-6 py-6 pb-24">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-clinic gap-4">
        <div className="flex flex-col">
          <h2 className="font-serif text-2xl font-bold text-clinic-text tracking-tight">Agenda Semanal</h2>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
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
                      <div key={time} className="p-2 rounded-lg border border-dashed border-clinic-border/20 min-h-[60px] opacity-20 transition-opacity">
                        <span className="text-xs font-bold text-clinic-text-faint">{time}</span>
                      </div>
                    );
                  }

                  if (holiday && mergedSessions.length === 0) {
                    return (
                      <div key={time} className="p-2 rounded-lg border border-dashed border-status-red-text/20 min-h-[60px] opacity-40 bg-status-red-bg/20 flex flex-col items-center justify-center">
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
                    <div key={time} className="flex flex-col gap-1.5 p-1.5 rounded-xl border border-clinic-border bg-clinic-bg/10 min-h-[70px]">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[10px] font-bold text-clinic-text-faint">{time}</span>
                        <button
                          onClick={() => openNewSession(day, time)}
                          className="text-[9px] font-black text-clinic-primary uppercase hover:underline cursor-pointer"
                          title="Agendar neste horário"
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
                          const isOverlayActive = touchOverlayId === session.id;

                          const handleCardClick = () => {
                            if (!isBlocked && patient) {
                              if (isOverlayActive) {
                                // Second tap: open detail modal
                                setTouchOverlayId(null);
                                setActionSession(session);
                              } else if (canAct) {
                                // First tap on actionable session: show touch overlay
                                setTouchOverlayId(session.id);
                              } else {
                                // Non-actionable session: go straight to detail modal
                                setActionSession(session);
                              }
                            }
                          };

                          return (
                            <div key={session.id} className="group relative">
                              <div
                                onClick={handleCardClick}
                                className={cn(
                                  "p-2 rounded-lg border min-h-[50px] transition-all flex flex-col justify-between shadow-sm",
                                  isBlocked || !patient ? '' : 'cursor-pointer hover:shadow-md',
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
                                    <span className="text-[8px] text-clinic-text-muted mt-0.5 truncate italic">
                                      {session.notes.trim().substring(0, 40)}{session.notes.trim().length > 40 ? '…' : ''}
                                    </span>
                                  )}

                                  {/* Virtual / double indicators */}
                                  {!isBlocked && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                      {isVirtual && (
                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded uppercase bg-clinic-primary/10 text-clinic-primary">Fixo</span>
                                      )}
                                      {session.type === SessionType.DUPLA && (
                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded uppercase bg-clinic-primary/10 text-clinic-primary">Dupla</span>
                                      )}
                                      {!isVirtual && !isBlocked && session.packageNumber && session.packageNumber > 0 && (
                                        <span className="text-[7px] text-clinic-text-muted">
                                          Pacote {session.packageNumber}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Quick action overlay: hover (desktop) or tap (mobile/tablet) */}
                                  {canAct && (
                                    <div
                                      onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); }}
                                      className={cn(
                                        "absolute inset-0 bg-black/65 rounded-lg transition-opacity duration-200 flex flex-col items-center justify-center gap-1 p-1 z-10",
                                        isOverlayActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                      )}
                                      role="toolbar"
                                      aria-label="Ações rápidas da sessão"
                                    >
                                      {/* Backdrop close hint (mobile/tablet) */}
                                      {isOverlayActive && (
                                        <span className="text-white/60 text-[9px] absolute top-1 lg:hidden">
                                          Toque fora para fechar
                                        </span>
                                      )}

                                      <div className="flex flex-wrap justify-center lg:flex-nowrap items-center gap-1.5 lg:gap-1 w-full">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); handleActionOk(session); }}
                                          className="bg-emerald-500 text-white font-semibold rounded-md hover:bg-emerald-600 transition-all duration-150 flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[40px] lg:min-h-[28px] px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 text-[11px]"
                                          aria-label="Marcar presença"
                                        >
                                          <span className="lg:hidden text-sm">✓</span> OK
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); handleActionFalta(session); }}
                                          className="bg-red-500 text-white font-semibold rounded-md hover:bg-red-600 transition-all duration-150 flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[40px] lg:min-h-[28px] px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 text-[11px]"
                                          aria-label="Marcar falta do paciente"
                                        >
                                          <span className="lg:hidden text-sm">✕</span> Falta
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); handleActionFaltaProf(session); }}
                                          className="bg-amber-500 text-white font-semibold rounded-md hover:bg-amber-600 transition-all duration-150 flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[40px] lg:min-h-[28px] px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 text-[11px]"
                                          aria-label="Marcar falta do profissional"
                                        >
                                          <span className="lg:hidden text-sm font-bold">FP</span> Falta Prof.
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); handleActionCancel(session); }}
                                          className="bg-gray-500 text-white font-semibold rounded-md hover:bg-gray-600 transition-all duration-150 flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[40px] lg:min-h-[28px] px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 text-[11px]"
                                          aria-label="Cancelar sessão"
                                        >
                                          <span className="lg:hidden text-sm">🚫</span> Cancelar
                                        </button>
                                        {!isVirtual && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setTouchOverlayId(null); handleActionDelete(session); }}
                                            className="bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 transition-all duration-150 flex items-center justify-center gap-1 min-h-[36px] sm:min-h-[40px] lg:min-h-[28px] px-2.5 lg:px-1.5 py-1.5 lg:py-0.5 text-[11px]"
                                            aria-label="Remover sessão"
                                          >
                                            <span className="lg:hidden text-sm">🗑</span> Remover
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )}
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
          <h3 className="font-serif text-sm font-bold text-clinic-text uppercase tracking-wide">Legenda de Cores</h3>
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
            width="max-w-sm"
          >
            <div className="space-y-4">
              {/* Info */}
              <div className="p-3 bg-clinic-bg rounded-xl border border-clinic-border space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-clinic-text">{patient?.name}</span>
                  <span className={cn("text-[10px] font-black px-2 py-0.5 rounded uppercase", getStatusBadgeStyle(
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
                <div className="flex items-center gap-2 text-xs text-clinic-text-muted">
                  <span className="font-bold">{safeFormatDate(actionSession.date, 'dd/MM/yyyy')}</span>
                  <span>•</span>
                  <span className="font-bold">{actionSession.time}</span>
                  {actionSession.isVirtual && <span className="text-clinic-primary font-bold">(Fixo)</span>}
                </div>
                <div className="text-xs text-clinic-text-muted">
                  {actionSession.type}
                </div>
                {patient && (
                  <div className="text-xs text-clinic-text-muted">
                    Responsável: <span className="font-medium">{patient.guardianName}</span>
                    {patient.whatsapp && <span> • {patient.whatsapp}</span>}
                  </div>
                )}
                {actionSession.notes && actionSession.notes.trim() && (
                  <div className="text-xs text-clinic-text-muted mt-1 p-2 bg-white rounded-lg border border-clinic-border">
                    <span className="font-bold block mb-0.5">Observações:</span>
                    {actionSession.notes.trim()}
                  </div>
                )}
                {/* Only show blocked warning for real blockers (feriado, paciente inativo, etc.), not for known statuses */}
                {actionSession.blockedReason && actionSession.blockedReason !== 'status inválido' && (
                  <div className="text-[10px] font-bold text-status-red-text uppercase mt-1">
                    Bloqueado: {actionSession.blockedReason}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {(actions.canOk || actions.canFalta || actions.canFaltaProf || actions.canCancel || actions.canReopen) && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-clinic-text-faint uppercase tracking-wide">Ações</p>

                  {/* Primary actions (Agendada) */}
                  {(actions.canOk || actions.canFalta || actions.canFaltaProf || actions.canCancel) && (
                    <div className="grid grid-cols-2 gap-3">
                      {actions.canOk && (
                        <button
                          onClick={() => handleActionOk(actionSession)}
                          className="py-3 px-4 bg-emerald-500 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 hover:shadow-md transition-all duration-150 active:scale-[0.97]"
                        >
                          OK / Presença
                        </button>
                      )}
                      {actions.canFalta && (
                        <button
                          onClick={() => handleActionFalta(actionSession)}
                          className="py-3 px-4 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 hover:shadow-md transition-all duration-150 active:scale-[0.97]"
                        >
                          Falta
                        </button>
                      )}
                      {actions.canFaltaProf && (
                        <button
                          onClick={() => handleActionFaltaProf(actionSession)}
                          className="py-3 px-4 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 hover:shadow-md transition-all duration-150 active:scale-[0.97]"
                        >
                          Falta Prof.
                        </button>
                      )}
                      {actions.canCancel && (
                        <button
                          onClick={() => handleActionCancel(actionSession)}
                          className="py-3 px-4 bg-gray-500 text-white text-sm font-semibold rounded-lg hover:bg-gray-600 hover:shadow-md transition-all duration-150 active:scale-[0.97]"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  )}

                  {/* Reopen action (finalized sessions) */}
                  {actions.canReopen && (
                    <button
                      onClick={() => handleActionReopen(actionSession)}
                      className="w-full py-3 px-4 bg-blue-800 text-white text-sm font-semibold rounded-lg hover:bg-blue-900 hover:shadow-md transition-all duration-150 active:scale-[0.97]"
                    >
                      ↻ Reabrir (Voltar para Agendada)
                    </button>
                  )}
                </div>
              )}

              {/* Remove button — always available for manual non-blocked sessions */}
              {actions.canDelete && !actionSession.isVirtual && (
                <button
                  onClick={() => handleActionDelete(actionSession)}
                  className="w-full py-3 px-4 bg-gray-100 text-gray-500 text-sm font-semibold rounded-lg hover:bg-gray-200 hover:text-gray-700 transition-all duration-150 active:scale-[0.97]"
                >
                  Remover Sessão
                </button>
              )}

              {!actions.canOk && !actions.canFalta && !actions.canFaltaProf && !actions.canCancel && !actions.canReopen && !actions.canDelete && (
                <div className="text-center text-xs text-clinic-text-muted italic py-2">
                  Nenhuma ação disponível para esta sessão.
                </div>
              )}

              <button
                onClick={() => setActionSession(null)}
                className="w-full py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
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
          <h3 className="font-serif text-xl font-bold">Faltas e Reposições Pendentes</h3>
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
      >
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
              <option value="__BLOCK__">🔒 Bloquear Horário</option>
              {state.patients.filter(p => p.status === 'Ativo').sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {selectedSlot && (
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
              {(!AVAILABLE_TIMES.includes(selectedSlot.time)) && (
                <input
                  type="text"
                  placeholder="Ex: 17:30"
                  value={selectedSlot.time}
                  onChange={e => setSelectedSlot(prev => prev ? { ...prev, time: e.target.value } : null)}
                  className="px-4 py-3 mt-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full animate-in fade-in"
                />
              )}
            </div>
          )}

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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-clinic-text-faint uppercase">
              {isBlockMode ? 'Nome do Compromisso *' : 'Observações'}
            </label>
            <textarea 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isBlockMode ? 'Ex: Reunião, Consulta médica, Compromisso pessoal...' : 'Digite alguma anotação técnica opcional...'}
              className={cn(
                "px-4 py-3 bg-clinic-bg rounded-xl border focus:ring-2 focus:ring-clinic-primary outline-none transition-all min-h-[100px]",
                isBlockMode && !notes.trim() ? "border-red-300" : "border-clinic-border"
              )}
            />
          </div>

          <button 
            onClick={handleSaveSession}
            disabled={isBlockMode ? !notes.trim() : !patientId}
            className={cn(
              "w-full py-4 text-white font-bold rounded-xl shadow-lg transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed",
              isBlockMode
                ? "bg-[#5D4037] hover:bg-[#4E342E]"
                : "bg-clinic-primary hover:bg-clinic-primary-hover"
            )}
          >
            {isBlockMode ? '🔒 Bloquear Horário' : 'Confirmar Agendamento'}
          </button>
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
