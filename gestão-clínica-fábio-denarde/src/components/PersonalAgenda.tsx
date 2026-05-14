import React, { useState, useMemo, useEffect } from 'react';
import { AppState, PersonalAppointment, PersonalAppointmentType, AlarmAdvance, AlarmSound } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, List, LayoutGrid, FastForward, Clock, Bell, CheckCircle2, MoreVertical, Plus, Edit2, Trash2, CalendarClock, BookOpen } from 'lucide-react';
import { format, addDays, startOfWeek, addWeeks, subWeeks, getDay, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, parseISO, isSameMonth, addMonths, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { cn } from '../lib/utils';
import { useAlarms } from '../lib/useAlarms';

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
  'Outro': { icon: '📝', bg: 'bg-gray-100', text: 'text-gray-800' },
};

const TIMES = Array.from({ length: 13 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`);

type ViewMode = 'semanal' | 'mensal' | 'lista' | 'proximos';

interface PersonalAgendaProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
}

export default function PersonalAgenda({ state, onUpdate }: PersonalAgendaProps) {
  // Ativa os alarmes baseados nos compromissos
  useAlarms(state.personalAppointments || []);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('semanal');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);

  // Form State
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [type, setType] = useState<PersonalAppointmentType>('Outro');
  const [recurrence, setRecurrence] = useState<'Não repetir' | 'Toda semana' | 'Todo mês'>('Não repetir');
  const [notes, setNotes] = useState('');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmAdvance, setAlarmAdvance] = useState<AlarmAdvance>('10 min');
  const [alarmSound, setAlarmSound] = useState<AlarmSound>('Notificação padrão');

  const resetForm = () => {
    setFormDate('');
    setFormTime('');
    setType('Outro');
    setRecurrence('Não repetir');
    setNotes('');
    setAlarmEnabled(false);
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
    if (app.alarmSound) setAlarmSound(app.alarmSound);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!formDate || !formTime || !type) return;

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
      alarmSound: alarmEnabled ? alarmSound : undefined,
      isDone: false,
    };

    const currentList = state.personalAppointments || [];
    let updatedList;

    if (selectedApptId) {
      updatedList = currentList.map(a => a.id === selectedApptId ? newApp : a);
    } else {
      updatedList = [...currentList, newApp];
    }

    onUpdate({ personalAppointments: updatedList });
    showToast('Compromisso salvo com sucesso!');
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este compromisso?')) {
      const updatedList = (state.personalAppointments || []).filter(a => a.id !== id);
      onUpdate({ personalAppointments: updatedList });
      showToast('Compromisso excluído.');
    }
  };

  const toggleDone = (id: string) => {
    const updatedList = (state.personalAppointments || []).map(a => 
      a.id === id ? { ...a, isDone: !a.isDone } : a
    );
    onUpdate({ personalAppointments: updatedList });
  };

  // Lógica de Ocorrências Virtuais
  const getOccurrences = (start: Date, end: Date) => {
    const list = state.personalAppointments || [];
    const occurrences: (PersonalAppointment & { occDate: Date })[] = [];

    list.forEach(app => {
      const [year, month, day] = app.date.split('-').map(Number);
      const firstDate = new Date(year, month - 1, day);
      
      // Passado e sem recorrência
      if (app.recurrence === 'Não repetir') {
        if (firstDate >= start && firstDate <= end) {
          occurrences.push({ ...app, occDate: firstDate });
        }
      } else if (app.recurrence === 'Toda semana') {
        // Encontra a primeira data dentro do intervalo que cai no mesmo dia da semana
        let curr = new Date(start);
        // Ajusta pro dia da semana correto
        while (curr.getDay() !== firstDate.getDay()) {
          curr = addDays(curr, 1);
        }
        while (curr <= end) {
          if (curr >= firstDate) {
            occurrences.push({ ...app, occDate: new Date(curr) });
          }
          curr = addDays(curr, 7);
        }
      } else if (app.recurrence === 'Todo mês') {
        // Itera mês a mês no intervalo
        let curr = new Date(start.getFullYear(), start.getMonth(), firstDate.getDate());
        if (curr < start) curr = addMonths(curr, 1);
        while (curr <= end) {
          if (curr >= firstDate) {
            occurrences.push({ ...app, occDate: new Date(curr) });
          }
          curr = addMonths(curr, 1);
        }
      }
    });

    return occurrences;
  };

  // Visão Semanal
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate]);

  // Visão Mensal
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  function endOfWeek(date: Date, options: { weekStartsOn: number }) {
      const day = date.getDay();
      const diff = (day < options.weekStartsOn ? 7 : 0) + day - options.weekStartsOn;
      return addDays(date, 6 - diff);
  }

  const handlePrev = () => {
    if (viewMode === 'mensal') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'semanal') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1)); // for daily
  };

  const handleNext = () => {
    if (viewMode === 'mensal') setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === 'semanal') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  function subDays(date: Date, amount: number) {
      return addDays(date, -amount);
  }

  const getDayNameLabel = (day: number) => {
    const labels = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    return labels[day];
  };

  const currentWeekOccurrences = getOccurrences(weekDays[0], weekDays[6]);

  return (
    <div className="flex flex-col gap-6 py-6 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-[#FDFBF7] p-6 rounded-2xl border border-[#DED4C8] shadow-sm gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl font-bold text-[#5D4037] tracking-tight flex items-center gap-2">
            <BookOpen className="text-[#5D4037]" /> Agenda Pessoal
          </h2>
          <span className="bg-[#5D4037] text-white text-[10px] font-bold px-2 py-1 rounded-full">
            {currentWeekOccurrences.filter(o => !o.isDone).length} pendentes
          </span>
        </div>

        <div className="flex bg-white rounded-xl p-1 border border-[#DED4C8] shadow-sm">
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
                viewMode === view.id ? "bg-[#5D4037] text-white shadow-sm" : "text-[#8D6E63] hover:bg-[#F5EBE6]"
              )}
            >
              <view.icon size={14} />
              <span className="hidden sm:inline">{view.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentDate(new Date())} 
            className="px-3 py-1.5 text-xs font-bold text-[#5D4037] border border-[#5D4037]/30 rounded-lg hover:bg-[#5D4037]/5 transition-colors uppercase"
          >
            Hoje
          </button>
          <div className="flex items-center gap-1 bg-white rounded-xl border border-[#DED4C8] p-1 shadow-sm">
            <button onClick={handlePrev} className="p-1 hover:bg-[#F5EBE6] text-[#5D4037] rounded-lg transition-colors"><ChevronLeft size={18} /></button>
            <span className="font-bold min-w-[120px] text-center text-[#5D4037] uppercase tracking-widest text-xs">
              {viewMode === 'mensal' ? format(currentDate, "MMMM", { locale: ptBR }) : 
               viewMode === 'semanal' ? `${format(weekDays[0], "dd/MM")} - ${format(weekDays[6], "dd/MM")}` :
               format(currentDate, "dd/MM/yyyy")}
            </span>
            <button onClick={handleNext} className="p-1 hover:bg-[#F5EBE6] text-[#5D4037] rounded-lg transition-colors"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      {/* View: Semanal */}
      {viewMode === 'semanal' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {weekDays.map(day => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={cn("rounded-xl border shadow-sm flex flex-col h-full bg-white", isToday ? "border-[#5D4037]" : "border-[#DED4C8]")}>
                <div className={cn("px-2 py-1.5 text-center border-b border-[#DED4C8]", isToday ? "bg-[#5D4037] text-white" : "bg-[#F5EBE6] text-[#5D4037]")}>
                  <span className="block text-[10px] font-black opacity-80 tracking-[0.2em] mb-0.5">{getDayNameLabel(day.getDay())}</span>
                  <span className="block text-xl font-bold">{format(day, 'dd')}</span>
                </div>
                <div className="p-1.5 space-y-1.5 flex-1 min-h-[400px]">
                  {TIMES.map(time => {
                    const appts = currentWeekOccurrences.filter(o => isSameDay(o.occDate, day) && o.time === time);
                    
                    if (appts.length === 0) {
                      return (
                        <div key={time} onClick={() => openNew(day, time)} className="p-2 rounded-lg border border-dashed border-[#DED4C8]/50 min-h-[50px] bg-green-500/5 hover:bg-green-500/10 cursor-pointer flex items-start group">
                           <span className="text-[10px] font-bold text-gray-400 group-hover:text-green-600 transition-colors">{time}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={time} className="space-y-1">
                        {appts.map(app => {
                          const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                          return (
                            <div key={app.id} className={cn("p-2 rounded-lg border relative group", config.bg, "border-black/5", app.isDone ? "opacity-50 grayscale" : "")}>
                               <div className="flex justify-between items-start mb-1">
                                 <span className={cn("text-[10px] font-black", config.text)}>{time}</span>
                                 <div className="flex gap-1">
                                    {app.alarmEnabled && <Bell size={10} className={config.text} />}
                                    {app.isDone && <CheckCircle2 size={10} className="text-green-600" />}
                                 </div>
                               </div>
                               <div className="flex items-center gap-1.5" title={app.notes}>
                                 <span className="text-sm">{config.icon}</span>
                                 <span className={cn("text-xs font-bold truncate leading-tight", config.text)}>{app.type}</span>
                               </div>
                               {/* Hover Actions */}
                               <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-sm rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center border border-black/10">
                                 <button onClick={(e) => { e.stopPropagation(); toggleDone(app.id); }} className="p-1 hover:bg-green-50 text-green-600" title="Concluir/Desfazer">
                                   <CheckCircle2 size={12} />
                                 </button>
                                 <button onClick={(e) => { e.stopPropagation(); openEdit(app); }} className="p-1 hover:bg-blue-50 text-blue-600" title="Editar">
                                   <Edit2 size={12} />
                                 </button>
                                 <button onClick={(e) => { e.stopPropagation(); handleDelete(app.id); }} className="p-1 hover:bg-red-50 text-red-600" title="Excluir">
                                   <Trash2 size={12} />
                                 </button>
                               </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View: Mensal */}
      {viewMode === 'mensal' && (
        <div className="bg-white rounded-2xl border border-[#DED4C8] shadow-sm overflow-hidden">
           <div className="grid grid-cols-7 border-b border-[#DED4C8] bg-[#F5EBE6]">
             {['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map(d => (
               <div key={d} className="py-2 text-center text-[10px] font-black text-[#5D4037] tracking-widest">{d}</div>
             ))}
           </div>
           <div className="grid grid-cols-7">
             {monthDays.map((day, i) => {
               const isCurrentMonth = isSameMonth(day, currentDate);
               const isToday = isSameDay(day, new Date());
               const appts = getOccurrences(day, day);

               return (
                 <div key={day.toISOString()} onClick={() => openNew(day, "08:00")} className={cn("min-h-[100px] border-b border-r border-[#DED4C8]/50 p-1 cursor-pointer hover:bg-gray-50", !isCurrentMonth && "bg-gray-50 opacity-50")}>
                   <div className="flex justify-between items-start">
                     <span className={cn("text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full", isToday ? "bg-[#5D4037] text-white" : "text-gray-500")}>
                       {format(day, 'd')}
                     </span>
                   </div>
                   <div className="mt-1 flex flex-wrap gap-1">
                     {appts.map(app => {
                       const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                       return (
                         <div key={app.id} title={`${app.time} - ${app.type}`} className={cn("w-2 h-2 rounded-full", config.bg, "border border-black/10", app.isDone ? "opacity-30" : "")} />
                       )
                     })}
                   </div>
                 </div>
               )
             })}
           </div>
        </div>
      )}

      {/* View: Lista do Dia */}
      {viewMode === 'lista' && (
        <div className="bg-white rounded-2xl border border-[#DED4C8] shadow-sm p-6 min-h-[400px]">
          <h3 className="font-serif text-xl font-bold text-[#5D4037] mb-6 flex items-center gap-2">
            <List size={20} /> Compromissos do Dia - {format(currentDate, "dd 'de' MMMM", { locale: ptBR })}
          </h3>
          <div className="space-y-3">
            {getOccurrences(currentDate, currentDate).sort((a, b) => a.time.localeCompare(b.time)).length > 0 ? (
              getOccurrences(currentDate, currentDate).sort((a, b) => a.time.localeCompare(b.time)).map(app => {
                const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                return (
                  <div key={app.id} className={cn("p-4 rounded-xl border flex items-center justify-between group", config.bg, "border-black/5", app.isDone ? "opacity-50 grayscale" : "")}>
                     <div className="flex items-center gap-4">
                       <span className={cn("text-lg font-black", config.text)}>{app.time}</span>
                       <div className="w-px h-8 bg-black/10"></div>
                       <div className="flex flex-col">
                         <div className="flex items-center gap-2">
                           <span className="text-xl">{config.icon}</span>
                           <span className={cn("text-sm font-bold", config.text)}>{app.type}</span>
                           <div className="flex gap-1 ml-2">
                              {app.alarmEnabled && <Bell size={12} className={config.text} />}
                              {app.isDone && <CheckCircle2 size={12} className="text-green-600" />}
                           </div>
                         </div>
                         {app.notes && <span className="text-xs text-black/60 mt-0.5">{app.notes}</span>}
                       </div>
                     </div>
                     <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={() => toggleDone(app.id)} className="p-2 bg-white hover:bg-green-50 text-green-600 rounded-lg shadow-sm" title="Concluir/Desfazer">
                         <CheckCircle2 size={16} />
                       </button>
                       <button onClick={() => openEdit(app)} className="p-2 bg-white hover:bg-blue-50 text-blue-600 rounded-lg shadow-sm" title="Editar">
                         <Edit2 size={16} />
                       </button>
                       <button onClick={() => handleDelete(app.id)} className="p-2 bg-white hover:bg-red-50 text-red-600 rounded-lg shadow-sm" title="Excluir">
                         <Trash2 size={16} />
                       </button>
                     </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center text-gray-500 py-12 font-bold bg-gray-50 rounded-xl border border-dashed border-gray-200">
                Nenhum compromisso para este dia.
                <button onClick={() => openNew(currentDate, "08:00")} className="block mx-auto mt-4 px-4 py-2 bg-[#5D4037] text-white rounded-lg hover:bg-[#4E342E] transition-colors">
                  Adicionar Compromisso
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View: Próximos */}
      {viewMode === 'proximos' && (
        <div className="bg-white rounded-2xl border border-[#DED4C8] shadow-sm p-6 min-h-[400px]">
          <h3 className="font-serif text-xl font-bold text-[#5D4037] mb-6 flex items-center gap-2">
            <FastForward size={20} /> Próximos Compromissos
          </h3>
          <div className="space-y-4">
            {getOccurrences(new Date(), addMonths(new Date(), 3))
              .filter(o => !o.isDone)
              .sort((a, b) => {
                const dateA = new Date(a.occDate.getFullYear(), a.occDate.getMonth(), a.occDate.getDate(), ...a.time.split(':').map(Number));
                const dateB = new Date(b.occDate.getFullYear(), b.occDate.getMonth(), b.occDate.getDate(), ...b.time.split(':').map(Number));
                return dateA.getTime() - dateB.getTime();
              })
              .slice(0, 10)
              .map(app => {
                const config = APPOINTMENT_CONFIG[app.type] || APPOINTMENT_CONFIG['Outro'];
                return (
                  <div key={`${app.id}-${app.occDate.getTime()}`} className={cn("p-4 rounded-xl border flex items-center justify-between group", config.bg, "border-black/5")}>
                     <div className="flex items-center gap-4">
                       <div className="flex flex-col items-center justify-center bg-white/50 px-3 py-1 rounded-lg">
                          <span className={cn("text-xs font-black uppercase tracking-widest", config.text)}>{format(app.occDate, 'MMM', {locale: ptBR})}</span>
                          <span className={cn("text-lg font-black", config.text)}>{format(app.occDate, 'dd')}</span>
                       </div>
                       <span className={cn("text-lg font-black", config.text)}>{app.time}</span>
                       <div className="w-px h-8 bg-black/10"></div>
                       <div className="flex flex-col">
                         <div className="flex items-center gap-2">
                           <span className="text-xl">{config.icon}</span>
                           <span className={cn("text-sm font-bold", config.text)}>{app.type}</span>
                           {app.alarmEnabled && <Bell size={12} className={config.text} />}
                         </div>
                         {app.notes && <span className="text-xs text-black/60 mt-0.5">{app.notes}</span>}
                       </div>
                     </div>
                     <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={() => toggleDone(app.id)} className="p-2 bg-white hover:bg-green-50 text-green-600 rounded-lg shadow-sm" title="Concluir/Desfazer">
                         <CheckCircle2 size={16} />
                       </button>
                       <button onClick={() => openEdit(app)} className="p-2 bg-white hover:bg-blue-50 text-blue-600 rounded-lg shadow-sm" title="Editar">
                         <Edit2 size={16} />
                       </button>
                     </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Modal Nova/Editar Sessão Pessoal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={selectedApptId ? 'Editar Compromisso' : 'Novo Compromisso'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Data Inicial</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-500 uppercase">Horário</label>
              <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)} className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 outline-none" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-500 uppercase">Tipo de Compromisso *</label>
            <select value={type} onChange={e => setType(e.target.value as PersonalAppointmentType)} className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 outline-none">
              {Object.entries(APPOINTMENT_CONFIG).map(([t, config]) => (
                <option key={t} value={t}>{config.icon} {t}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-500 uppercase">Recorrência</label>
            <div className="flex bg-gray-50 rounded-xl p-1 border border-gray-200">
              {['Não repetir', 'Toda semana', 'Todo mês'].map(r => (
                <button 
                  key={r}
                  onClick={() => setRecurrence(r as any)}
                  className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-colors", recurrence === r ? "bg-[#5D4037] text-white shadow" : "text-gray-500 hover:bg-gray-200")}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-500 uppercase">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 outline-none min-h-[80px]" />
          </div>

          <div className="bg-[#F5EBE6] p-4 rounded-xl border border-[#DED4C8] space-y-3">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <Bell size={16} className="text-[#5D4037]" />
                 <span className="text-sm font-bold text-[#5D4037] uppercase tracking-wide">Alarme Sonoro & Notificação</span>
               </div>
               <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={alarmEnabled} onChange={e => setAlarmEnabled(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5D4037]"></div>
                </label>
             </div>
             
             {alarmEnabled && (
               <div className="grid grid-cols-2 gap-3 pt-2">
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] font-bold text-gray-500 uppercase">Antecedência</label>
                   <select value={alarmAdvance} onChange={e => setAlarmAdvance(e.target.value as AlarmAdvance)} className="px-2 py-2 text-sm bg-white rounded border border-gray-200 outline-none">
                     <option value="Na hora">Na hora</option>
                     <option value="5 min">5 min</option>
                     <option value="10 min">10 min</option>
                     <option value="15 min">15 min</option>
                     <option value="30 min">30 min</option>
                     <option value="1 hora">1 hora</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] font-bold text-gray-500 uppercase">Som do Alarme</label>
                   <select value={alarmSound} onChange={e => setAlarmSound(e.target.value as AlarmSound)} className="px-2 py-2 text-sm bg-white rounded border border-gray-200 outline-none">
                     <option value="Sino suave">Sino suave</option>
                     <option value="Notificação padrão">Notificação padrão</option>
                     <option value="Melodia relaxante">Melodia relaxante</option>
                     <option value="Alerta urgente">Alerta urgente</option>
                     <option value="Silencioso">Silencioso</option>
                   </select>
                 </div>
               </div>
             )}
          </div>

          <button onClick={handleSave} className="w-full py-4 bg-[#5D4037] hover:bg-[#4E342E] text-white font-bold rounded-xl shadow-lg transition-all uppercase tracking-widest mt-2">
            Salvar Compromisso
          </button>
        </div>
      </Modal>

    </div>
  );
}
