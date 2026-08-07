import React, { useState, useMemo, useEffect } from 'react';
import { AppState, PersonalAppointment, PersonalAppointmentType, AlarmAdvance } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, List, LayoutGrid, FastForward, Bell, CheckCircle2, Edit2, Trash2, BookOpen } from 'lucide-react';
import { format, addDays, subDays, startOfWeek, addWeeks, subWeeks, isSameDay, startOfDay, endOfDay, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { cn } from '../lib/utils';
import { previewSound, prepareAlarmAudio } from '../lib/useAlarms';
import { ALARM_ADVANCE_OPTIONS, loadAlarmSounds, AlarmSoundMeta, getDefaultSounds, DEFAULT_ALARM_SOUND_ID, getFallbackAlarmSoundId } from '../lib/alarmSounds';
import { getNextPersonalAppointmentOccurrence, getPendingPersonalAppointmentOccurrences, getPersonalAppointmentOccurrences, PersonalAppointmentOccurrence } from '../lib/personalAgendaTemporal';

// Configuração visual por tipo
const APPOINTMENT_CONFIG: Record<PersonalAppointmentType, { icon: string, bg: string, text: string }> = {
  'Médico': { icon: '🏥', bg: 'bg-blue-100', text: 'text-blue-800' },
  'Estudar': { icon: '📚', bg: 'bg-indigo-100', text: 'text-indigo-800' },
  'Cortar cabelo': { icon: '✂️', bg: 'bg-stone-200', text: 'text-stone-800' },
  'Visitar família': { icon: '👨‍👩‍👧', bg: 'bg-rose-100', text: 'text-rose-800' },
  'Viajar': { icon: '✈️', bg: 'bg-sky-100', text: 'text-sky-800' },
  'Passear': { icon: '🚶', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  'Compromisso com a esposa': { icon: '💑', bg: 'bg-pink-100', text: 'text-pink-800' },
  'Compromisso com Lara': { icon: '👧', bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
  'Ir ao supermercado': { icon: '🛒', bg: 'bg-orange-100', text: 'text-orange-800' },
  'Compromisso com cliente': { icon: '🤝', bg: 'bg-slate-200', text: 'text-slate-800' },
  'Academia / Exercício': { icon: '🏋️', bg: 'bg-red-100', text: 'text-red-800' },
  'Farmácia': { icon: '💊', bg: 'bg-teal-100', text: 'text-teal-800' },
  'Banco / Financeiro': { icon: '🏦', bg: 'bg-green-100', text: 'text-green-800' },
  'Manutenção / Conserto': { icon: '🔧', bg: 'bg-amber-100', text: 'text-amber-800' },
  'Receber entrega': { icon: '📦', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  'Restaurante / Jantar especial': { icon: '🍽️', bg: 'bg-purple-100', text: 'text-purple-800' },
  'Aniversário': { icon: '🎂', bg: 'bg-pink-200', text: 'text-pink-900' },
  'Compromisso Familiar': { icon: '👨‍👩‍👧', bg: 'bg-rose-200', text: 'text-rose-900' },
  'Compromisso com Amigos': { icon: '👫', bg: 'bg-violet-100', text: 'text-violet-800' },
  'Outro': { icon: '📝', bg: 'bg-gray-100', text: 'text-gray-800' },
};

// Helper: build tooltip text for a PersonalAppointment
function buildTooltip(app: PersonalAppointment): string {
  const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
  const lines: string[] = [
    `${config.icon} ${app.type}`,
    `⏰ Horário: ${app.time}`,
  ];
  if (app.alarmEnabled && app.alarmAdvance) {
    lines.push(`🔔 Alarme: ${app.alarmAdvance === 'Na hora' ? 'No horário' : app.alarmAdvance + ' antes'}`);
  }
  if (app.recurrence && app.recurrence !== 'Não repetir') {
    lines.push(`🔄 Recorrência: ${app.recurrence}`);
  }
  if (app.notes) {
    lines.push(`📝 ${app.notes}`);
  }
  lines.push(app.isDone ? '✅ Concluído' : '🟢 Ativo');
  return lines.join('\n');
}

// Helper: get hour from time string for slot matching
function getHourSlot(time: string): string {
  const [h] = time.split(':');
  return `${h}:00`;
}

function occurrenceKey(app: PersonalAppointmentOccurrence): string {
  return `${app.id}-${format(app.occDate, 'yyyy-MM-dd')}-${app.time}`;
}

const TIMES = Array.from({ length: 13 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`);

const TIME_OPTIONS = (() => {
  const opts: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 5) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return opts;
})();

type ViewMode = 'semanal' | 'mensal' | 'lista' | 'proximos';

interface PersonalAgendaProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => Promise<boolean>;
  activeAlarmId: string | null;
  activeAlarmLabel: string;
  stopAlarm: () => void;
}

export default function PersonalAgenda({ state, onUpdate, activeAlarmId, activeAlarmLabel, stopAlarm }: PersonalAgendaProps) {

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('semanal');
  const [listFilter, setListFilter] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [type, setType] = useState<PersonalAppointmentType>('Outro');
  const [recurrence, setRecurrence] = useState<string>('Não repetir');
  const [notes, setNotes] = useState('');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmAdvance, setAlarmAdvance] = useState<AlarmAdvance>('Na hora');
  const [alarmSound, setAlarmSound] = useState<string>(DEFAULT_ALARM_SOUND_ID);
  const [alarmVolume, setAlarmVolume] = useState(80);
  const [alarmFadeIn, setAlarmFadeIn] = useState(false);
  const [alarmSoundsList, setAlarmSoundsList] = useState<AlarmSoundMeta[]>(() => getDefaultSounds());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadAlarmSounds().then(setAlarmSoundsList).catch(() => {});
  }, []);

  const resetForm = () => {
    setFormDate('');
    setFormTime('');
    setType('Outro');
    setRecurrence('Não repetir');
    setNotes('');
    setAlarmEnabled(false);
    setAlarmAdvance('Na hora');
    setAlarmSound(DEFAULT_ALARM_SOUND_ID);
    setAlarmVolume(80);
    setAlarmFadeIn(false);
    setSelectedApptId(null);
  };

  const openNew = (date: Date, time: string) => {
    resetForm();
    setFormDate(format(date, 'yyyy-MM-dd'));
    setFormTime(time);
    setIsModalOpen(true);
  };

  const openEdit = (app: PersonalAppointment) => {
    setSelectedApptId(app.id);
    setFormDate(app.date);
    setFormTime(app.time);
    setType(app.type);
    setRecurrence(app.recurrence);
    setNotes(app.notes);
    setAlarmEnabled(app.alarmEnabled);
    if (app.alarmAdvance) setAlarmAdvance(app.alarmAdvance);
    setAlarmSound(getFallbackAlarmSoundId(app.alarmSound));
    if (app.alarmVolume !== undefined) setAlarmVolume(app.alarmVolume);
    setAlarmFadeIn(app.alarmFadeIn ?? false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formDate || !formTime || !type) return;
    if (isSaving) return;

    const newApp: PersonalAppointment = {
      id: selectedApptId || Math.random().toString(36).substr(2, 9),
      type,
      date: formDate,
      time: formTime,
      durationMinutes: 60,
      recurrence,
      notes,
      alarmEnabled,
      alarmAdvance: alarmEnabled ? alarmAdvance : undefined,
      alarmSound: alarmEnabled ? getFallbackAlarmSoundId(alarmSound) : undefined,
      alarmVolume: alarmEnabled ? alarmVolume : undefined,
      alarmFadeIn: alarmEnabled ? alarmFadeIn : undefined,
      isDone: false,
    };

    const currentList = state.personalAppointments || [];
    let updatedList;

    if (selectedApptId) {
      updatedList = currentList.map(a => a.id === selectedApptId ? newApp : a);
    } else {
      updatedList = [...currentList, newApp];
    }

    setIsSaving(true);
    try {
      const persisted = await onUpdate({ personalAppointments: updatedList });
      if (!persisted) {
        showToast('Não foi possível salvar o compromisso. Nenhuma alteração foi confirmada.', 'error');
        return;
      }
      showToast('Compromisso salvo com sucesso!');
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar compromisso:', error);
      showToast('Não foi possível salvar o compromisso. Verifique a conexão e tente novamente.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este compromisso?')) return;

    try {
      const updatedList = (state.personalAppointments || []).filter(a => a.id !== id);
      const persisted = await onUpdate({ personalAppointments: updatedList });
      if (!persisted) {
        showToast('Não foi possível excluir o compromisso. Nenhuma alteração foi confirmada.', 'error');
        return;
      }
      showToast('Compromisso excluído com sucesso!');
    } catch (error) {
      console.error('Erro ao excluir compromisso:', error);
      showToast('Erro ao excluir compromisso. Tente novamente.', 'error');
    }
  };

  const toggleDone = async (id: string) => {
    const currentAppointment = (state.personalAppointments || []).find(a => a.id === id);
    if (!currentAppointment) return;

    const updatedList = (state.personalAppointments || []).map(a =>
      a.id === id ? { ...a, isDone: !a.isDone } : a
    );

    try {
      const persisted = await onUpdate({ personalAppointments: updatedList });
      if (!persisted) {
        showToast('Não foi possível atualizar o compromisso. Nenhuma alteração foi confirmada.', 'error');
        return;
      }
      showToast(currentAppointment.isDone ? 'Compromisso reativado!' : 'Compromisso concluído!');
    } catch (error) {
      console.error('Erro ao atualizar compromisso:', error);
      showToast('Erro ao atualizar compromisso. Tente novamente.', 'error');
    }
  };

  const getOccurrences = (start: Date, end: Date): PersonalAppointmentOccurrence[] =>
    getPersonalAppointmentOccurrences(state.personalAppointments || [], start, end);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate]);

  const monthCells = useMemo<(Date | null)[]>(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    const leadingEmptyCells = Array.from({ length: start.getDay() }, () => null);
    const usedCells = leadingEmptyCells.length + days.length;
    const trailingEmptyCells = Array.from({ length: (7 - (usedCells % 7)) % 7 }, () => null);
    return [...leadingEmptyCells, ...days, ...trailingEmptyCells];
  }, [currentDate]);

  const listDateRange = useMemo(() => {
    if (listFilter === 'hoje') {
      return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
    } else if (listFilter === 'semana') {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfDay(endOfWeek(currentDate, { weekStartsOn: 1 }));
      return { start, end };
    } else {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return { start, end };
    }
  }, [currentDate, listFilter]);

  const listTitle = useMemo(() => {
    if (listFilter === 'hoje') {
      return `Compromissos de Hoje - ${format(currentDate, "dd 'de' MMMM", { locale: ptBR })}`;
    } else if (listFilter === 'semana') {
      return `Compromissos da Semana - ${format(listDateRange.start, 'dd/MM')} a ${format(listDateRange.end, 'dd/MM')}`;
    } else {
      return `Compromissos de ${format(currentDate, "MMMM 'de' yyyy", { locale: ptBR })}`;
    }
  }, [currentDate, listFilter, listDateRange]);

  function endOfWeek(date: Date, options: { weekStartsOn: number }) {
    const day = date.getDay();
    const diff = (day < options.weekStartsOn ? 7 : 0) + day - options.weekStartsOn;
    return addDays(date, 6 - diff);
  }

  const handlePrev = () => {
    if (viewMode === 'mensal') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'semanal') setCurrentDate(subWeeks(currentDate, 1));
    else if (viewMode === 'lista' && listFilter === 'mes') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'lista' && listFilter === 'semana') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const handleNext = () => {
    if (viewMode === 'mensal') setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === 'semanal') setCurrentDate(addWeeks(currentDate, 1));
    else if (viewMode === 'lista' && listFilter === 'mes') setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === 'lista' && listFilter === 'semana') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const getDayNameLabel = (day: number) => {
    const labels = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    return labels[day];
  };

  const currentWeekOccurrences = getOccurrences(weekDays[0], weekDays[6]);

  const pendingCount = useMemo(() => {
    const appointments = state.personalAppointments || [];

    if (viewMode === 'mensal') {
      return getPendingPersonalAppointmentOccurrences(
        appointments,
        startOfMonth(currentDate),
        endOfMonth(currentDate),
      ).length;
    }

    if (viewMode === 'lista') {
      return getPendingPersonalAppointmentOccurrences(
        appointments,
        listDateRange.start,
        listDateRange.end,
      ).length;
    }

    if (viewMode === 'proximos') {
      return getPendingPersonalAppointmentOccurrences(
        appointments,
        startOfDay(new Date()),
        endOfDay(addDays(new Date(), 21)),
      ).length;
    }

    return getPendingPersonalAppointmentOccurrences(
      appointments,
      weekDays[0],
      weekDays[6],
    ).length;
  }, [state.personalAppointments, viewMode, currentDate, listDateRange, weekDays]);

  return (
    <div className="flex flex-col gap-6 py-6 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-sm gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-clinic-primary tracking-tight flex items-center gap-2">
            <BookOpen className="text-clinic-primary" /> Agenda Pessoal
          </h2>
          <span className="bg-clinic-primary text-white text-[10px] font-bold px-2 py-1 rounded-full">
            {pendingCount} pendentes
          </span>
        </div>

        <div className="flex bg-white rounded-xl p-1 border border-clinic-border shadow-sm">
          {[
            { id: 'semanal', icon: LayoutGrid, label: 'Semanal' },
            { id: 'mensal', icon: CalendarIcon, label: 'Mensal' },
            { id: 'lista', icon: List, label: 'Lista' },
            { id: 'proximos', icon: FastForward, label: 'Próximos' }
          ].map(view => (
            <button
              key={view.id}
              onClick={() => setViewMode(view.id as ViewMode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                viewMode === view.id ? "bg-clinic-primary text-white shadow-sm" : "text-clinic-text-muted hover:bg-clinic-bg"
              )}
            >
              <view.icon size={14} />
              <span className="hidden sm:inline">{view.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openNew(new Date(), '08:00')}
            className="px-3 py-1.5 text-xs font-black text-white bg-clinic-primary rounded-lg hover:bg-clinic-primary-hover transition-colors uppercase whitespace-nowrap"
          >
            + Novo Compromisso
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1.5 text-xs font-bold text-clinic-primary border border-clinic-primary/30 rounded-lg hover:bg-clinic-primary/5 transition-colors uppercase"
          >
            Hoje
          </button>
          <div className="flex items-center gap-1 bg-white rounded-xl border border-clinic-border p-1 shadow-sm">
            <button onClick={handlePrev} className="p-1 hover:bg-clinic-bg text-clinic-primary rounded-lg transition-colors"><ChevronLeft size={18} /></button>
            <span className="font-bold min-w-[120px] text-center text-clinic-primary uppercase tracking-widest text-xs">
              {viewMode === 'mensal' ? format(currentDate, "MMMM", { locale: ptBR }) :
                viewMode === 'semanal' ? `${format(weekDays[0], 'dd/MM')} - ${format(weekDays[6], 'dd/MM')}` :
                viewMode === 'lista' && listFilter === 'semana' ? `${format(listDateRange.start, 'dd/MM')} - ${format(listDateRange.end, 'dd/MM')}` :
                viewMode === 'lista' && listFilter === 'mes' ? format(currentDate, "MMMM", { locale: ptBR }) :
                format(currentDate, 'dd/MM/yyyy')}
            </span>
            <button onClick={handleNext} className="p-1 hover:bg-clinic-bg text-clinic-primary rounded-lg transition-colors"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      {/* View: Semanal */}
      {viewMode === 'semanal' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {weekDays.map(day => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={cn("rounded-xl border shadow-sm flex flex-col h-full bg-white", isToday ? "border-clinic-primary" : "border-clinic-border")}>
                <div className={cn("px-2 py-1.5 text-center border-b border-clinic-border", isToday ? "bg-clinic-primary text-white" : "bg-clinic-bg text-clinic-primary")}>
                  <span className="block text-[10px] font-bold opacity-80 tracking-[0.2em] mb-0.5">{getDayNameLabel(day.getDay())}</span>
                  <span className="block text-xl font-bold">{format(day, 'dd')}</span>
                </div>
                <div className="p-1.5 space-y-1 flex-1 min-h-[400px]">
                  {TIMES.map(time => {
                    // Match appointments whose hour falls within this slot
                    const appts = currentWeekOccurrences.filter(o => isSameDay(o.occDate, day) && getHourSlot(o.time) === time);

                    if (appts.length === 0) {
                      return (
                        <div key={time} onClick={() => openNew(day, time)} className="p-1.5 rounded-lg border border-dashed border-clinic-border/50 min-h-[44px] bg-green-500/5 hover:bg-green-500/10 cursor-pointer flex items-start group transition-colors">
                          <span className="text-[10px] font-bold text-gray-400 group-hover:text-green-600 transition-colors">{time}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={time} className="space-y-1">
                        {appts.map(app => {
                          const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                          const tooltipText = buildTooltip(app);
                          return (
                            <div
                              key={occurrenceKey(app)}
                              title={tooltipText}
                              className={cn(
                                "p-2 rounded-lg border relative group cursor-default transition-all",
                                config.bg, "border-black/5",
                                app.isDone ? "opacity-50 grayscale" : "hover:shadow-md"
                              )}
                            >
                              {/* Row 1: Time + status badges */}
                              <div className="flex justify-between items-center mb-1">
                                <span className={cn("text-[10px] font-black tracking-wide", config.text)}>{app.time}</span>
                                <div className="flex items-center gap-0.5">
                                  {app.alarmEnabled && (
                                    <span className="inline-flex items-center gap-0.5 bg-white/60 px-1 py-0.5 rounded text-[8px] font-bold" title={`Alarme: ${app.alarmAdvance || 'Na hora'}`}>
                                      🔔 <span className={config.text}>{app.alarmAdvance === 'Na hora' ? '⏰' : app.alarmAdvance}</span>
                                    </span>
                                  )}
                                  {app.isDone && <span className="text-green-600 text-xs" title="Concluído">✅</span>}
                                </div>
                              </div>
                              {/* Row 2: Icon + name */}
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className="text-sm leading-none">{config.icon}</span>
                                <span className={cn("text-[11px] font-bold truncate leading-tight", config.text)}>{app.type}</span>
                              </div>
                              {/* Row 3: Recurrence badge */}
                              {app.recurrence && app.recurrence !== 'Não repetir' && (
                                <div className="flex items-center gap-0.5 mb-0.5">
                                  <span className="inline-flex items-center gap-0.5 bg-white/50 px-1 py-0.5 rounded text-[8px] font-bold text-gray-600">
                                    🔄 {app.recurrence}
                                  </span>
                                </div>
                              )}
                              {/* Row 4: Notes preview */}
                              {app.notes && (
                                <p className="text-[9px] text-gray-600 truncate leading-tight mt-0.5 italic">
                                  {app.notes}
                                </p>
                              )}
                              {/* Ações no Hover */}
                              <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-sm rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 border border-black/10 shadow-md p-0.5 z-10">
                                <button onClick={(e) => { e.stopPropagation(); void toggleDone(app.id); }} className="p-1.5 hover:bg-green-50 text-green-600 rounded" title={app.isDone ? 'Reativar' : 'Marcar como concluído'}>
                                  <CheckCircle2 size={13} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); openEdit(app); }} className="p-1.5 hover:bg-blue-50 text-blue-600 rounded" title="Editar">
                                  <Edit2 size={13} />
                                </button>
                                <button className="p-1.5 hover:bg-red-50 text-red-600 rounded" title="Excluir" onClick={e => { e.stopPropagation(); void handleDelete(app.id); }}>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View: Mensal */}
      {viewMode === 'mensal' && (
        <div className="bg-white rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-clinic-border bg-clinic-bg">
            {['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map(d => (
              <div key={d} className="py-2 text-center text-[10px] font-bold text-clinic-primary tracking-widest">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((day, index) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${index}`}
                    aria-hidden="true"
                    className="min-h-[100px] border-b border-r border-clinic-border/50 bg-clinic-bg/40"
                  />
                );
              }

              const isToday = isSameDay(day, new Date());
              const appts = getOccurrences(day, day);

              return (
                <div
                  key={day.toISOString()}
                  onClick={() => openNew(day, '08:00')}
                  className="min-h-[100px] border-b border-r border-clinic-border/50 p-1 cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <span className={cn("text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full", isToday ? "bg-clinic-primary text-white" : "text-gray-500")}>
                      {format(day, 'd')}
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {appts.map(app => {
                      const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                      return (
                        <button
                          key={occurrenceKey(app)}
                          type="button"
                          title={buildTooltip(app)}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdit(app);
                          }}
                          className={cn(
                            "w-full rounded-md border border-black/10 px-1.5 py-1 text-left shadow-sm transition hover:brightness-95",
                            config.bg,
                            app.isDone ? "opacity-40 grayscale" : "",
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-1">
                            <span className={cn("shrink-0 text-[9px] font-black", config.text)}>{app.time}</span>
                            <span className="shrink-0 text-[10px] leading-none">{config.icon}</span>
                            <span className={cn("truncate text-[9px] font-bold", config.text)}>{app.type}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View: Lista */}
      {viewMode === 'lista' && (
        <div className="bg-white rounded-2xl border border-clinic-border shadow-sm p-6 min-h-[400px]">
          <h3 className="text-xl font-bold text-clinic-primary mb-4 flex items-center gap-2">
            <List size={20} /> {listTitle}
          </h3>

          <div className="flex bg-white rounded-xl p-1 border border-clinic-border shadow-sm mb-6 w-fit">
            {[
              { id: 'hoje' as const, label: 'Hoje' },
              { id: 'semana' as const, label: 'Esta Semana' },
              { id: 'mes' as const, label: 'Este Mês' },
            ].map(filter => (
              <button
                key={filter.id}
                onClick={() => setListFilter(filter.id)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                  listFilter === filter.id ? "bg-clinic-primary text-white shadow-sm" : "text-clinic-text-muted hover:bg-clinic-bg"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {(() => {
              const listOccurrences = getOccurrences(listDateRange.start, listDateRange.end)
                .sort((a, b) => {
                  const dateDiff = a.occDate.getTime() - b.occDate.getTime();
                  if (dateDiff !== 0) return dateDiff;
                  return a.time.localeCompare(b.time);
                });
              return listOccurrences.length > 0 ? (
                listOccurrences.map(app => {
                  const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                  return (
                    <div key={occurrenceKey(app)} className={cn('p-4 rounded-xl border flex items-center justify-between group', config.bg, 'border-black/5', app.isDone ? 'opacity-50 grayscale' : '')}>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-center min-w-[50px]">
                          <span className="text-[10px] font-bold uppercase text-gray-500">{format(app.occDate, 'dd/MM')}</span>
                          <span className={cn('text-lg font-bold', config.text)}>{app.time}</span>
                        </div>
                        <div className="w-px h-8 bg-black/10"></div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{config.icon}</span>
                            <span className={cn('text-sm font-bold', config.text)}>{app.type}</span>
                            <div className="flex gap-1 ml-2">
                              {app.alarmEnabled && <Bell size={12} className={config.text} />}
                              {app.isDone && <CheckCircle2 size={12} className='text-green-500' />}
                            </div>
                          </div>
                          {app.notes && <span className='text-xs text-gray-600 mt-0.5'>{app.notes}</span>}
                        </div>
                      </div>
                      <div className='flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <button onClick={(e) => { e.stopPropagation(); void toggleDone(app.id); }} className='p-2 bg-green-500 text-white rounded-lg shadow-sm hover:bg-green-600'>
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openEdit(app); }} className='p-2 bg-blue-500 text-white rounded-lg shadow-sm hover:bg-blue-600'>
                          <Edit2 size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); void handleDelete(app.id); }} className='p-2 bg-red-500 text-white rounded-lg shadow-sm hover:bg-red-600'>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className='text-center text-gray-500 py-12 font-bold bg-gray-50 rounded-xl border border-dashed border-gray-200'>
                  Nenhum compromisso para este período.
                  <button onClick={() => openNew(currentDate, '08:00')} className='block mx-auto mt-4 px-4 py-2 bg-clinic-primary text-white rounded-lg hover:bg-clinic-primary-hover transition-colors'>
                    Adicionar Compromisso
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* View: Próximos */}
      {viewMode === 'proximos' && (
        <div className="bg-white rounded-2xl border border-clinic-border shadow-sm p-6 min-h-[400px]">
          <h3 className="text-xl font-bold text-clinic-primary mb-6 flex items-center gap-2">
            <FastForward size={20} /> Próximos Compromissos
          </h3>
          <div className="space-y-4">
            {getOccurrences(new Date(), addDays(new Date(), 21))
              .filter(o => !o.isDone)
              .slice(0, 10)
              .map(app => {
                const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                return (
                  <div key={occurrenceKey(app)} className={cn('p-4 rounded-xl border flex items-center justify-between group', config.bg, 'border-black/5')}>
                    <div className='flex items-center gap-4'>
                      <div className='flex flex-col items-center justify-center bg-white/50 p-3 text-sm rounded-lg'>
                        <span className={cn('text-xs font-bold uppercase tracking-widest', config.text)}>{format(app.occDate, 'MMM', { locale: ptBR })}</span>
                        <span className={cn('text-base font-bold', config.text)}>{format(app.occDate, 'dd')}</span>
                      </div>
                      <span className={cn('text-xl font-bold', config.text)}>{app.time}</span>
                      <div className='flex flex-col'>
                        <div className='flex items-center gap-2'>
                          <span className='text-xl'>{config.icon}</span>
                          <span className={cn('text-sm font-bold', config.text)}>{app.type}</span>
                        </div>
                        {app.notes && <span className='text-xs text-gray-600 mt-0.5'>{app.notes}</span>}
                      </div>
                    </div>
                    <div className='flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                      <button onClick={(e) => { e.stopPropagation(); void toggleDone(app.id); }} className='p-2 bg-green-500 text-white rounded-lg shadow-sm hover:bg-green-600'>
                        <CheckCircle2 size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); openEdit(app); }} className='p-2 bg-blue-500 text-white rounded-lg shadow-sm hover:bg-blue-600'>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); void handleDelete(app.id); }} className='p-2 bg-red-500 text-white rounded-lg shadow-sm hover:bg-red-600'>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Modal Nova/Editar Sessão Pessoal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={selectedApptId ? 'Editar Compromisso' : 'Novo Compromisso'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Data</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full p-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Horário</label>
              <select value={formTime} onChange={e => setFormTime(e.target.value)} className="w-full p-2 border rounded-lg">
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tipo de Atividade</label>
            <select value={type} onChange={e => setType(e.target.value as PersonalAppointmentType)} className="w-full p-2 border rounded-lg">
              {Object.keys(APPOINTMENT_CONFIG).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Recorrência</label>
            <select value={recurrence} onChange={e => setRecurrence(e.target.value as any)} className="w-full p-2 border rounded-lg">
              <option value="Não repetir">Não repetir</option>
              <option value="Toda semana">Toda semana</option>
              <option value="Todo mês">Todo mês</option>
            </select>
          </div>
          {selectedApptId && (() => {
            const selectedAppointment = (state.personalAppointments || []).find(app => app.id === selectedApptId);
            const nextReminder = selectedAppointment
              ? getNextPersonalAppointmentOccurrence(selectedAppointment, new Date())
              : null;
            return nextReminder ? (
              <div className="rounded-lg border border-clinic-border bg-clinic-bg p-3 text-xs text-clinic-text">
                <span className="font-bold uppercase text-clinic-text-muted">Próximo lembrete</span>
                <div className="mt-1 font-bold">{format(nextReminder.occurrenceDateTime, "dd/MM/yyyy 'às' HH:mm")}</div>
              </div>
            ) : null;
          })()}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2 border rounded-lg h-20" placeholder="Detalhes opcionais..." />
          </div>
          <div className="flex items-center gap-3 p-3 bg-clinic-bg rounded-xl border border-clinic-border shadow-sm">
            <input
              type="checkbox"
              checked={alarmEnabled}
              onChange={async e => {
                const checked = e.target.checked;
                setAlarmEnabled(checked);
                if (checked) await prepareAlarmAudio();
              }}
              className="w-4 h-4 rounded text-clinic-primary"
            />
            <div className="flex-1">
              <span className="text-sm font-black text-clinic-text">Ativar Alarme Sonoro</span>
              <p className="text-[10px] text-gray-600">Prepara o áudio do navegador e emite um alerta no horário configurado.</p>
            </div>
            <span className="hidden sm:inline-flex px-2 py-1 rounded-full bg-clinic-primary text-white text-[9px] font-black uppercase tracking-wider">Novo</span>
          </div>
          {alarmEnabled && (
             <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Antecedência</label>
                  <select value={alarmAdvance} onChange={e => setAlarmAdvance(e.target.value as AlarmAdvance)} className="w-full p-2 border rounded-lg text-sm">
                    {ALARM_ADVANCE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Volume</label>
                    <span className="text-[10px] font-bold text-gray-500">{alarmVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={alarmVolume}
                    onChange={e => setAlarmVolume(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-clinic-primary"
                  />
                </div>

                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <input type="checkbox" checked={alarmFadeIn} onChange={e => setAlarmFadeIn(e.target.checked)} className="w-4 h-4 rounded text-clinic-primary" />
                  <div className="flex-1">
                    <span className="text-sm font-bold text-gray-700">Som crescente (fade-in)</span>
                    <p className="text-[10px] text-gray-500">Começa em 20% e aumenta gradualmente até 100% em 30 segundos</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-clinic-border bg-clinic-surface p-3 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <div>
                      <label className="block text-[10px] font-black text-clinic-primary uppercase tracking-widest">Som selecionado</label>
                      <p className="text-sm font-black text-clinic-text">
                        {alarmSoundsList.find(s => s.id === alarmSound)?.name || alarmSoundsList[0]?.name || 'Alarme Celular Forte'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        previewSound(getFallbackAlarmSoundId(alarmSound), alarmVolume);
                      }}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-clinic-primary text-white text-xs font-black hover:bg-clinic-primary-hover transition-all shadow-sm"
                    >
                      🔊 Testar selecionado
                    </button>
                  </div>

                  {alarmSoundsList.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic">Carregando sons...</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {alarmSoundsList.map(s => {
                        const isSelected = alarmSound === s.id;
                        const isVeryStrong = s.intensity === 'Muito forte';
                        return (
                          <div
                            key={s.id}
                            className={`rounded-2xl border p-3 transition-all ${isSelected ? 'border-clinic-primary bg-clinic-nav-bg shadow-md' : 'border-clinic-border bg-white hover:border-clinic-border-dark'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setAlarmSound(s.id);
                                  previewSound(s.id, alarmVolume);
                                }}
                                className="text-left flex-1 cursor-pointer"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-lg">{isSelected ? '🔊' : isVeryStrong ? '🚨' : '⏰'}</span>
                                  <span className="text-xs font-black text-clinic-text uppercase tracking-wide">{s.name}</span>
                                </div>
                                <p className="text-[10px] leading-snug text-gray-600">{s.description}</p>
                              </button>
                              <span className={`shrink-0 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-wider ${isVeryStrong ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                                {s.intensity}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setAlarmSound(s.id);
                                }}
                                className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${isSelected ? 'bg-clinic-primary text-white' : 'bg-clinic-bg text-clinic-primary hover:bg-clinic-border'}`}
                              >
                                {isSelected ? 'Selecionado' : 'Selecionar'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  previewSound(s.id, alarmVolume);
                                }}
                                className="px-3 py-2 rounded-xl border border-clinic-border text-clinic-primary text-[10px] font-black uppercase tracking-wider hover:bg-clinic-bg transition-all"
                              >
                                ▶ Testar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
             </div>
          )}
          <div className="pt-2">
            <button onClick={() => void handleSave()} disabled={isSaving} className="w-full py-3 bg-clinic-primary text-white font-bold rounded-xl hover:bg-clinic-primary-hover transition-all shadow-md active:scale-[0.98] disabled:cursor-wait disabled:opacity-60">
              {isSaving ? 'Salvando...' : selectedApptId ? 'Atualizar Compromisso' : 'Salvar Compromisso'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
