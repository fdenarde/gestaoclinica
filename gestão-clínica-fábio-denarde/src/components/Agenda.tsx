import React, { useState, useMemo } from 'react';
import { AppState, Session, SessionStatus, SessionType, Reposition } from '../types';
import { AVAILABLE_TIMES, SCHEDULE_CONFIG } from '../constants';
import { ChevronLeft, ChevronRight, AlertCircle, Users, RefreshCw, Lock } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { cn, getStatusColor, safeFormatDate } from '../lib/utils';

// Normaliza string removendo acentos e convertendo para minúsculas
const normalizeStr = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Helpers para validação e normalização de horários (minutos :00 ou :30)
const getHourBase = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hour] = timeStr.split(':');
  return `${hour}:00`;
};

const isValidTime = (timeStr: string): boolean => {
  if (!timeStr) return false;
  return /^([0-1]?[0-9]|2[0-3]):(00|30)$/.test(timeStr.trim());
};

const normalizeTime = (timeStr: string): string => {
  if (!isValidTime(timeStr)) return timeStr;
  const [hour, min] = timeStr.trim().split(':').map(Number);
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const addOneHour = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hour, min] = timeStr.split(':').map(Number);
  const newHour = (hour + 1) % 24;
  return `${String(newHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

// Helper: returns virtual session(s) for a patient on a given date if their fixedDay matches.
// For doubleSession patients, returns entries for both the fixedTime AND the next hour.
// Returns empty array for holiday dates.
function getVirtualSessions(
  patient: AppState['patients'][0],
  dayStr: string,
  dayKey: string,
  holidays: { date: string }[]
): Session[] {
  if (patient.status !== 'Ativo') return [];
  // Normalize both sides so 'Terça', 'TERCA', 'terça' all match 'terca'
  if (normalizeStr(patient.fixedDay || '') !== normalizeStr(dayKey)) return [];
  // Block virtual sessions on holidays
  if (holidays.some(h => h.date === dayStr)) return [];
  // fixedTime is required
  if (!patient.fixedTime) return [];

  const times = SCHEDULE_CONFIG[dayKey] || [];

  const makeVirtual = (time: string): Session => ({
    id: `virtual-${patient.id}-${dayStr}-${time}`,
    patientId: patient.id,
    date: dayStr,
    time,
    type: patient.doubleSession ? SessionType.DUPLA : SessionType.SIMPLES,
    status: SessionStatus.AGENDADA,
    packageNumber: 0,
    notes: '',
  });

  const result: Session[] = [makeVirtual(patient.fixedTime)];

  // If doubleSession, also occupy the next time slot
  if (patient.doubleSession) {
    result.push(makeVirtual(addOneHour(patient.fixedTime)));
  }
  return result;
}

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

  // Reposition Modal State
  const [repoModal, setRepoModal] = useState<{ reposition: Reposition; patient: AppState['patients'][0]; originalSession: Session | null } | null>(null);
  const [repoDate, setRepoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [repoTime, setRepoTime] = useState('');

  // Compute available times for selected repoDate
  const repoAvailableTimes = useMemo(() => {
    const dayIndex = getDay(new Date(repoDate + 'T12:00:00'));
    const dayKeys: Record<number, string> = { 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
    const key = dayKeys[dayIndex];
    return key ? (SCHEDULE_CONFIG[key] || []) : AVAILABLE_TIMES;
  }, [repoDate]);

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
    const start = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate]);

  // Filter to active clinic days: segunda (1), terça (2), quarta (3), quinta (4), sexta (5), sábado (6)
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

    // Block mode: no patient needed, but blockName (stored in notes) is required
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
      // Determine the current package number and how many sessions are already in it
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
    // Remove qualquer reposição pendente ligada a esta sessão (sincronismo)
    const updatedRepositions = state.repositions.filter(r => !(r.originalSessionId === session.id && r.status === 'Pendente'));
    
    onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
    showToast(`${state.patients.find(p => p.id === session.patientId)?.name} - Presença registrada.`);
  };

  const markAsMissed = (session: Session) => {
    // Evita duplicar reposição se já existir uma pendente
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

    onUpdate({ 
      sessions: updatedSessions,
      repositions: [...state.repositions, newReposition]
    });
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

    onUpdate({ 
      sessions: updatedSessions,
      repositions: [...state.repositions, newReposition]
    });
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
    const keys: Record<number, string> = {
      1: 'segunda',
      2: 'terça',
      3: 'quarta',
      4: 'quinta',
      5: 'sexta',
      6: 'sábado'
    };
    return keys[day] || '';
  };

  const getDayNameLabel = (day: number) => {
    const labels: Record<number, string> = {
      1: 'SEGUNDA',
      2: 'TERÇA',
      3: 'QUARTA',
      4: 'QUINTA',
      5: 'SEXTA',
      6: 'SÁBADO'
    };
    return labels[day] || '';
  };

  const [filterPatientId, setFilterPatientId] = useState<string>('');

  return (
    <div className="flex flex-col gap-6 py-6 pb-24">
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
          <button onClick={handlePrevWeek} className="p-2.5 hover:bg-clinic-bg text-clinic-text-muted rounded-xl border border-clinic-border transition-all active:scale-90 bg-white shadow-sm">
            <ChevronLeft size={20} />
          </button>
          <span className="font-bold min-w-[150px] text-center text-clinic-text uppercase tracking-widest text-sm">
            {format(weekDays[0], "dd/MM")} — {format(weekDays[6], "dd/MM")}
          </span>
          <button onClick={handleNextWeek} className="p-2.5 hover:bg-clinic-bg text-clinic-text-muted rounded-xl border border-clinic-border transition-all active:scale-90 bg-white shadow-sm">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Agenda Grid */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        {activeDays.map(day => {
          const dayKey = getDayNameKey(day.getDay());
          const scheduledTimes = SCHEDULE_CONFIG[dayKey] || [];
          const dayStr = format(day, 'yyyy-MM-dd');
          const holiday = state.settings.holidays?.find(h => h.date === dayStr);
          const holidays = state.settings.holidays || [];

          // All virtual sessions for this day (includes non-standard times)
          const allVirtualForDay = !holiday
            ? state.patients.flatMap(p => getVirtualSessions(p, dayStr, dayKey, holidays))
            : [];

          // Use only the scheduled times; ignore virtual times not in the schedule config
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
                  // Find all real sessions belonging to this hour base
                  const realSessions = state.sessions
                    .filter(s => s.date === dayStr && getHourBase(s.time) === time)
                    .sort((a, b) => a.time.localeCompare(b.time));

                  // Find all virtual sessions belonging to this hour base
                  const virtualSessions = allVirtualForDay
                    .filter(vs => {
                      if (getHourBase(vs.time) !== time) return false;
                      const hasManualAtSameTime = state.sessions.some(s => s.date === dayStr && s.patientId === vs.patientId && s.time === vs.time);
                      return !hasManualAtSameTime;
                    })
                    .sort((a, b) => a.time.localeCompare(b.time));

                  // Combine them
                  const mergedSessions = [...realSessions, ...virtualSessions].sort((a, b) => a.time.localeCompare(b.time));

                  // Filter logic: if patient filter is active, only show if patientId matches
                  const filteredSessions = filterPatientId
                    ? mergedSessions.filter(s => s.patientId === filterPatientId)
                    : mergedSessions;

                  // If patient filter is active and this slot doesn't have any matching sessions, fade it out
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
                          className="p-2 rounded-lg border min-h-[60px] transition-all flex flex-col justify-between bg-green-500/10 hover:bg-green-500/20 border-green-500/30 border-dashed cursor-pointer pointer-events-auto shadow-inner"
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
                      {/* Header slot */}
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
                      
                      {/* Sessions list */}
                      <div className="space-y-1.5">
                        {filteredSessions.map(session => {
                          const patient = session ? state.patients.find(p => p.id === session.patientId) : null;
                          const isBlocked = !!session?.isBlocked;
                          const isVirtual = !state.sessions.some(s => s.id === session.id);
                          const isOnHoliday = !!holiday;
                          const displayPackage = isVirtual ? null : session.packageNumber;
                          
                          return (
                            <div key={session.id} className="group relative">
                              <div className={cn(
                                "p-2 rounded-lg border min-h-[50px] transition-all flex flex-col justify-between bg-white shadow-sm",
                                isBlocked
                                  ? 'bg-[#5D4037]/15 border-[#5D4037]/40'
                                  : isOnHoliday
                                  ? 'bg-orange-500/10 border-orange-400 border-dashed'
                                  : session.status === SessionStatus.FALTA
                                  ? 'bg-red-500/10 border-red-500/20'
                                  : session.status === SessionStatus.FALTA_PROF
                                  ? 'bg-orange-500/10 border-orange-500/20'
                                  : session.status === SessionStatus.CANCELADA
                                  ? 'bg-rose-900/20 border-rose-900/30'
                                  : session.status === SessionStatus.REALIZADA
                                  ? 'bg-blue-500/10 border-blue-400 border-dashed'
                                  : 'bg-white border-clinic-border'
                              )}>
                                <div className="flex justify-between items-start gap-1">
                                  <span className={cn("text-[10px] font-black leading-none", isBlocked ? "text-[#5D4037]" : "text-clinic-text")}>
                                    {session.time}
                                  </span>
                                  
                                  <div className="flex items-center gap-0.5">
                                    {isBlocked ? (
                                      <>
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                                          className="text-[7px] text-status-red-text font-black uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity mr-0.5"
                                        >
                                          Remover
                                        </button>
                                        <span className="text-[7px] font-black px-0.5 py-0.2 rounded uppercase bg-[#5D4037]/20 text-[#5D4037]">
                                          🔒
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        {isOnHoliday && (
                                          <span className="text-[6px] font-black px-1 py-0.5 rounded uppercase bg-orange-500/20 text-orange-600">
                                            ⚠ Feriado
                                          </span>
                                        )}
                                        {isVirtual && (
                                          <span className="text-[6px] font-black px-1 py-0.5 rounded uppercase bg-clinic-primary/10 text-clinic-primary">
                                            Fixo
                                          </span>
                                        )}
                                        {!isVirtual && (
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                                            className="text-[7px] text-status-red-text font-black uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity mr-0.5"
                                          >
                                            Remover
                                          </button>
                                        )}
                                        {session.type === SessionType.DUPLA && (
                                          <span className="bg-clinic-primary/10 text-clinic-primary text-[6px] font-black px-1 py-0.5 rounded uppercase">2x</span>
                                        )}
                                        {!isVirtual && (
                                          <span className={cn("text-[6px] font-black px-1 py-0.5 rounded uppercase", getStatusColor(session.status))}>
                                            {session.status.charAt(0)}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                
                                {isBlocked ? (
                                  <div className="flex flex-col mt-0.5">
                                    <span className="font-bold text-xs truncate leading-tight text-[#5D4037]">{session.blockName}</span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col mt-0.5">
                                    <span className="font-bold text-xs truncate leading-tight text-clinic-text">{patient?.name}</span>
                                    <span className="text-[8px] text-clinic-text-muted mt-0.5">
                                      {displayPackage ? `S.${displayPackage}` : 'Fixo'}
                                    </span>
                                    
                                    {/* Quick Actions Overlay */}
                                    {(isVirtual || session.status === SessionStatus.AGENDADA) && (
                                      <div className="absolute inset-0 bg-clinic-header/95 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 px-1">
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); 
                                            if (isVirtual) {
                                              const patientSessions = state.sessions.filter(s => s.patientId === session.patientId);
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
                                              const newReal: Session = { ...session, id: Math.random().toString(36).substr(2, 9), status: SessionStatus.REALIZADA, packageNumber: nextPackageNumber };
                                              onUpdate({ sessions: [...state.sessions, newReal] });
                                              showToast(`${patient?.name} - Presença registrada.`);
                                            } else {
                                              markAsRealized(session);
                                            }
                                          }}
                                          className="bg-status-green-text text-white text-[8px] font-black px-1.5 py-1 rounded hover:scale-105"
                                        >
                                          OK
                                        </button>
                                        <button 
                                          onClick={(e) => { e.stopPropagation();
                                            if (isVirtual) {
                                              const patientSessions = state.sessions.filter(s => s.patientId === session.patientId);
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
                                              const newReal: Session = { ...session, id: Math.random().toString(36).substr(2, 9), status: SessionStatus.FALTA, packageNumber: nextPackageNumber };
                                              const newRepo: Reposition = { id: Math.random().toString(36).substr(2, 9), patientId: session.patientId, originalSessionId: newReal.id, status: 'Pendente' };
                                              onUpdate({ sessions: [...state.sessions, newReal], repositions: [...state.repositions, newRepo] });
                                              showToast(`Falta registrada. Reposição pendente criada.`);
                                            } else {
                                              markAsMissed(session);
                                            }
                                          }}
                                          className="bg-status-red-text text-white text-[8px] font-black px-1.5 py-1 rounded hover:scale-105"
                                          title="Falta"
                                        >
                                          F
                                        </button>
                                        <button 
                                          onClick={(e) => { e.stopPropagation();
                                            if (isVirtual) {
                                              const patientSessions = state.sessions.filter(s => s.patientId === session.patientId);
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
                                              const newReal: Session = { ...session, id: Math.random().toString(36).substr(2, 9), status: SessionStatus.FALTA_PROF, packageNumber: nextPackageNumber };
                                              const newRepo: Reposition = { id: Math.random().toString(36).substr(2, 9), patientId: session.patientId, originalSessionId: newReal.id, status: 'Pendente' };
                                              onUpdate({ sessions: [...state.sessions, newReal], repositions: [...state.repositions, newRepo] });
                                              showToast(`Sua falta registrada. Reposição pendente criada.`);
                                            } else {
                                              markAsMissedProf(session);
                                            }
                                          }}
                                          className="bg-status-orange-text text-white text-[8px] font-black px-1.5 py-1 rounded hover:scale-105"
                                          title="Minha Falta"
                                        >
                                          FP
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation();
                                            if (isVirtual) {
                                              const patientSessions = state.sessions.filter(s => s.patientId === session.patientId);
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
                                              const newReal: Session = { ...session, id: Math.random().toString(36).substr(2, 9), status: SessionStatus.CANCELADA, packageNumber: nextPackageNumber };
                                              onUpdate({ sessions: [...state.sessions, newReal] });
                                              showToast('Sessão cancelada.');
                                            } else {
                                              const updatedSessions = state.sessions.map(s => s.id === session.id ? { ...s, status: SessionStatus.CANCELADA } : s);
                                              onUpdate({ sessions: updatedSessions });
                                              showToast('Sessão cancelada.');
                                            }
                                          }}
                                          className="bg-rose-700 text-white text-[8px] font-black px-1.5 py-1 rounded hover:scale-105"
                                          title="Cancelar"
                                        >
                                          C
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
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

      {/* Faltas e Reposições Pendentes Section */}
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

      {/* Modal Nova Sessão */}
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

      {/* Modal Confirmar Exclusão de Sessão */}
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

      {/* Modal Agendar Reposição */}
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
