import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Save } from 'lucide-react';
import type { PublicBookingAvailabilityPeriod, PublicBookingException, PublicBookingExceptionType, PublicBookingModality, PublicBookingSettings } from './types';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50';
const dayLabels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const modalityLabels: Record<PublicBookingModality, string> = { ONLINE: 'Online', PRESENCIAL: 'Presencial' };

type HabitualDayDraft = { dayOfWeek: number; enabled: boolean; periods: PublicBookingAvailabilityPeriod[] };

function calendarDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function habitualDraftFromSettings(settings: PublicBookingSettings): HabitualDayDraft[] {
  const activePublicModalities = settings.publishedModalities.filter(item => item.active).map(item => item.id);
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const periods = settings.publicBookingAvailability
      .filter(period => period.dayOfWeek === dayOfWeek)
      .map(period => ({ ...period, modalities: Array.isArray(period.modalities) ? [...period.modalities] : [...activePublicModalities] }));
    return { dayOfWeek, enabled: periods.some(period => period.enabled), periods };
  });
}

function periodModalityLabel(modalities: readonly PublicBookingModality[]): string {
  const hasOnline = modalities.includes('ONLINE');
  const hasPresential = modalities.includes('PRESENCIAL');
  if (hasOnline && hasPresential) return 'Ambos';
  if (hasOnline) return 'Online';
  if (hasPresential) return 'Presencial';
  return 'Nenhuma modalidade';
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

export default function PublicBookingAvailabilityEditor({ settings, onSave }: { settings: PublicBookingSettings; onSave: (patch: Partial<PublicBookingSettings>, message: string) => Promise<void> }) {
  const today = new Date();
  const [habitualDays, setHabitualDays] = useState<HabitualDayDraft[]>(() => habitualDraftFromSettings(settings));
  const [availabilityArea, setAvailabilityArea] = useState<'routine' | 'exceptions'>('routine');
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState('');
  const [exceptionStart, setExceptionStart] = useState('15:00');
  const [exceptionEnd, setExceptionEnd] = useState('17:00');
  const [exceptionModalities, setExceptionModalities] = useState<PublicBookingModality[]>(() => settings.publishedModalities.filter(item => item.active).map(item => item.id));
  const [error, setError] = useState('');

  useEffect(() => { setHabitualDays(habitualDraftFromSettings(settings)); }, [settings.publicBookingAvailability]);

  const monthYear = calendarMonth.getFullYear();
  const monthIndex = calendarMonth.getMonth();
  const daysInMonth = new Date(monthYear, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(monthYear, monthIndex, 1).getDay();
  const calendarCells = useMemo(() => [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => calendarDateKey(monthYear, monthIndex, index + 1))], [daysInMonth, firstWeekday, monthIndex, monthYear]);
  const exceptionsForSelectedDate = settings.publicBookingExceptions.filter(exception => exception.civilDate === selectedDate);
  const monthlyExceptionCount = settings.publicBookingExceptions.filter(exception => exception.civilDate.startsWith(`${monthYear}-${String(monthIndex + 1).padStart(2, '0')}-`)).length;
  const routineSummary = habitualDays
    .filter(day => day.enabled && day.periods.length)
    .map(day => `${dayLabels[day.dayOfWeek].slice(0, 3)} ${day.periods.map(period => `${period.startTime}–${period.endTime} · ${periodModalityLabel(period.modalities)}`).join(' · ')}`)
    .join(' · ') || 'Indisponível';

  const updateDay = (dayOfWeek: number, patch: Partial<HabitualDayDraft>) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day));
  const updatePeriod = (dayOfWeek: number, index: number, patch: Partial<PublicBookingAvailabilityPeriod>) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.map((period, periodIndex) => periodIndex === index ? { ...period, ...patch } : period) } : day));
  const addPeriod = (dayOfWeek: number) => setHabitualDays(current => current.map(day => {
    if (day.dayOfWeek !== dayOfWeek) return day;
    const activePublicModalities = settings.publishedModalities.filter(item => item.active).map(item => item.id);
    const inheritedModalities = day.periods[0]?.modalities?.length ? [...day.periods[0].modalities] : activePublicModalities;
    return { ...day, enabled: true, periods: [...day.periods, { dayOfWeek, enabled: true, startTime: '13:00', endTime: '17:00', modalities: inheritedModalities, locationIds: settings.locations.filter(item => item.active).map(item => item.id) }] };
  }));
  const removePeriod = (dayOfWeek: number, index: number) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.filter((_, periodIndex) => periodIndex !== index) } : day));
  const togglePeriodModality = (dayOfWeek: number, index: number, modality: PublicBookingModality, checked: boolean) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.map((period, periodIndex) => {
    if (periodIndex !== index) return period;
    const modalities = checked ? [...new Set([...period.modalities, modality])] : period.modalities.filter(item => item !== modality);
    return { ...period, modalities };
  }) } : day));
  const toggleExceptionModality = (modality: PublicBookingModality, checked: boolean) => setExceptionModalities(current => checked ? [...new Set([...current, modality])] : current.filter(item => item !== modality));

  const saveRoutine = async () => {
    if (habitualDays.some(day => day.periods.some(period => period.endTime <= period.startTime))) { setError('Corrija os períodos habituais: o fim precisa ser depois do início.'); return false; }
    if (habitualDays.some(day => day.enabled && day.periods.some(period => period.modalities.length === 0))) { setError('Selecione Online, Presencial ou ambos para este período.'); return false; }
    setError('');
    await onSave({ publicBookingAvailability: habitualDays.flatMap(day => day.periods.map(period => ({ ...period, enabled: day.enabled }))) }, 'Rotina semanal salva neste navegador.');
    return true;
  };

  const exceptionStatus = (date: string): 'NORMAL' | 'ALTERADO' | 'INDISPONÍVEL' => {
    const exceptions = settings.publicBookingExceptions.filter(exception => exception.civilDate === date);
    return exceptions.some(exception => exception.type === 'BLOCK_DAY') ? 'INDISPONÍVEL' : exceptions.length ? 'ALTERADO' : 'NORMAL';
  };

  const saveException = async (type: PublicBookingExceptionType) => {
    if (!selectedDate) return;
    setError('');
    if (type !== 'BLOCK_DAY' && exceptionEnd <= exceptionStart) { setError('O fim precisa ser depois do início.'); return; }
    if (type !== 'BLOCK_DAY' && exceptionModalities.length === 0) { setError('Selecione Online, Presencial ou ambos para este período.'); return; }
    const now = new Date().toISOString();
    const next: PublicBookingException = { id: `public-exception-${Date.now().toString(36)}`, professionalId: settings.professionalId, civilDate: selectedDate, type, startTime: type === 'BLOCK_DAY' ? undefined : exceptionStart, endTime: type === 'BLOCK_DAY' ? undefined : exceptionEnd, modality: type === 'BLOCK_DAY' || exceptionModalities.length === 2 ? undefined : exceptionModalities[0], note: undefined, createdAt: now, updatedAt: now };
    const retained = settings.publicBookingExceptions.filter(exception => exception.civilDate !== selectedDate || (type !== 'BLOCK_DAY' && exception.type !== 'BLOCK_DAY'));
    await onSave({ publicBookingExceptions: [...retained, next] }, type === 'BLOCK_DAY' ? 'Dia bloqueado para novos agendamentos públicos.' : type === 'BLOCK_PERIOD' ? 'Período bloqueado para novos agendamentos públicos.' : 'Horário extra liberado para novos agendamentos públicos.');
  };

  const resetSelectedDate = async () => {
    if (!selectedDate) return;
    await onSave({ publicBookingExceptions: settings.publicBookingExceptions.filter(exception => exception.civilDate !== selectedDate) }, 'A data voltou a usar a programação habitual.');
  };

  return <section className="mt-5 rounded-2xl border border-violet-100 bg-white p-4" data-testid="psychology-public-availability-settings">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Disponibilidade para agendamento</p><h4 className="mt-1 text-lg font-black text-violet-950">Rotina e exceções</h4><p className="mt-1 text-sm text-slate-600">Organize a rotina semanal e altere uma data somente quando necessário.</p></div><CalendarDays className="shrink-0 text-violet-700" size={21} /></div>
    <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">Resumo da disponibilidade</p><p className="mt-1 text-sm font-black text-violet-950">{routineSummary}</p><p className="mt-1 text-xs font-semibold text-violet-900">{monthlyExceptionCount} exceção(ões) no mês de {monthLabel(monthYear, monthIndex)}.</p></div>
    <div role="tablist" aria-label="Organização da disponibilidade" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"><button type="button" role="tab" aria-selected={availabilityArea === 'routine'} data-testid="psychology-availability-tab-routine" onClick={() => setAvailabilityArea('routine')} className={`rounded-lg px-3 py-2 text-xs font-black ${availabilityArea === 'routine' ? 'bg-violet-700 text-white' : 'text-slate-500 hover:bg-violet-50'}`}>ROTINA SEMANAL</button><button type="button" role="tab" aria-selected={availabilityArea === 'exceptions'} data-testid="psychology-availability-tab-exceptions" onClick={() => setAvailabilityArea('exceptions')} className={`rounded-lg px-3 py-2 text-xs font-black ${availabilityArea === 'exceptions' ? 'bg-violet-700 text-white' : 'text-slate-500 hover:bg-violet-50'}`}>EXCEÇÕES POR DATA</button></div>
    {availabilityArea === 'routine' && <div className="mt-4 space-y-2" data-testid="psychology-availability-routine"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black text-slate-900">Rotina semanal</p><button type="button" onClick={() => void saveRoutine()} className={primaryButton}><Save size={15} /> Salvar rotina</button></div>{habitualDays.map(day => { const isEditing = editingDay === day.dayOfWeek; const summary = day.enabled && day.periods.length ? day.periods.map(period => `${period.startTime}–${period.endTime} · ${periodModalityLabel(period.modalities)}`).join(' · ') : 'Indisponível'; return <div key={day.dayOfWeek} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-slate-900">{dayLabels[day.dayOfWeek]}</p><p className={`mt-1 text-xs font-semibold ${day.enabled && day.periods.length ? 'text-emerald-700' : 'text-slate-500'}`}>{summary}</p></div><button type="button" onClick={() => setEditingDay(current => current === day.dayOfWeek ? null : day.dayOfWeek)} className={secondaryButton}>{isEditing ? 'Fechar' : day.enabled && day.periods.length ? 'Editar' : 'Configurar'}</button></div>{isEditing && <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3" data-testid={`psychology-availability-day-editor-${day.dayOfWeek}`}><label className="flex items-center gap-2 text-sm font-black text-slate-800"><input aria-label={`${dayLabels[day.dayOfWeek]} dia ativo`} type="checkbox" checked={day.enabled} onChange={event => updateDay(day.dayOfWeek, { enabled: event.target.checked })} /> Dia ativo</label>{day.enabled && <div className="mt-3 space-y-3">{day.periods.map((period, index) => <div key={`${day.dayOfWeek}-${index}`} className="rounded-xl border border-violet-100 bg-white p-3"><div className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold text-slate-600">Início<input aria-label={`${dayLabels[day.dayOfWeek]} início público ${index + 1}`} type="time" value={period.startTime} onChange={event => updatePeriod(day.dayOfWeek, index, { startTime: event.target.value })} className={`${inputClass} mt-1`} /></label><span className="pb-2 text-slate-400">—</span><label className="text-xs font-bold text-slate-600">Fim<input aria-label={`${dayLabels[day.dayOfWeek]} fim público ${index + 1}`} type="time" value={period.endTime} onChange={event => updatePeriod(day.dayOfWeek, index, { endTime: event.target.value })} className={`${inputClass} mt-1`} /></label><button type="button" onClick={() => removePeriod(day.dayOfWeek, index)} className="rounded-lg px-2 py-2 text-xs font-black text-slate-500 hover:bg-rose-50 hover:text-rose-700">Remover</button></div><fieldset className="mt-3"><legend className="text-xs font-black text-slate-700">Disponível para</legend><div className="mt-2 flex flex-wrap gap-3"><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input aria-label={`${dayLabels[day.dayOfWeek]} período ${index + 1} Online`} type="checkbox" checked={period.modalities.includes('ONLINE')} onChange={event => togglePeriodModality(day.dayOfWeek, index, 'ONLINE', event.target.checked)} /> {modalityLabels.ONLINE}</label><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input aria-label={`${dayLabels[day.dayOfWeek]} período ${index + 1} Presencial`} type="checkbox" checked={period.modalities.includes('PRESENCIAL')} onChange={event => togglePeriodModality(day.dayOfWeek, index, 'PRESENCIAL', event.target.checked)} /> {modalityLabels.PRESENCIAL}</label><span className="text-xs font-black text-violet-700">{periodModalityLabel(period.modalities)}</span></div></fieldset></div>)}<button type="button" onClick={() => addPeriod(day.dayOfWeek)} className="rounded-lg px-2 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-100">+ Adicionar período</button></div>}<button type="button" onClick={() => void saveRoutine().then(saved => { if (saved) setEditingDay(null); })} className={`${primaryButton} mt-3`}>Salvar dia</button></div>}</div>; })}{error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}</div>}
    {availabilityArea === 'exceptions' && <div className="mt-4" data-testid="psychology-availability-exceptions"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-black text-slate-900">Exceções por data</p><p className="text-xs font-semibold text-slate-500">Selecione uma data para editar somente aquele dia.</p></div><div className="flex items-center gap-1"><button type="button" aria-label="Mês anterior" onClick={() => setCalendarMonth(new Date(monthYear, monthIndex - 1, 1))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronLeft size={17} /></button><span className="min-w-32 py-2 text-center text-sm font-black capitalize">{monthLabel(monthYear, monthIndex)}</span><button type="button" aria-label="Próximo mês" onClick={() => setCalendarMonth(new Date(monthYear, monthIndex + 1, 1))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronRight size={17} /></button></div></div><div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-slate-500">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}{calendarCells.map((date, index) => date ? <button type="button" key={date} onClick={() => setSelectedDate(date)} aria-label={`${date} · ${exceptionStatus(date)}`} className={`min-h-10 rounded-lg border p-1 text-xs font-black transition ${selectedDate === date ? 'border-violet-600 bg-violet-100 text-violet-900' : exceptionStatus(date) === 'INDISPONÍVEL' ? 'border-rose-200 bg-rose-50 text-rose-700' : exceptionStatus(date) === 'ALTERADO' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-100 bg-slate-50 text-slate-700'}`}>{Number(date.slice(-2))}</button> : <span key={`empty-${index}`} />)}</div>{selectedDate && <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3"><p className="text-sm font-black text-violet-950">Data selecionada: {selectedDate}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Início do ajuste<input aria-label="Início do ajuste" type="time" value={exceptionStart} onChange={event => setExceptionStart(event.target.value)} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Fim do ajuste<input aria-label="Fim do ajuste" type="time" value={exceptionEnd} onChange={event => setExceptionEnd(event.target.value)} className={`${inputClass} mt-1`} /></label></div><fieldset className="mt-3"><legend className="text-xs font-black text-slate-700">Disponível para o ajuste de período</legend><div className="mt-2 flex flex-wrap gap-3"><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input aria-label="Modalidade do ajuste Online" type="checkbox" checked={exceptionModalities.includes('ONLINE')} onChange={event => toggleExceptionModality('ONLINE', event.target.checked)} /> {modalityLabels.ONLINE}</label><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input aria-label="Modalidade do ajuste Presencial" type="checkbox" checked={exceptionModalities.includes('PRESENCIAL')} onChange={event => toggleExceptionModality('PRESENCIAL', event.target.checked)} /> {modalityLabels.PRESENCIAL}</label><span className="text-xs font-black text-violet-700">{periodModalityLabel(exceptionModalities)}</span></div></fieldset><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveException('BLOCK_DAY')} className={secondaryButton}>Bloquear dia inteiro</button><button type="button" onClick={() => void saveException('BLOCK_PERIOD')} className={secondaryButton}>Bloquear período</button><button type="button" onClick={() => void saveException('OPEN_PERIOD')} className={primaryButton}>Liberar horário extra</button><button type="button" onClick={() => void resetSelectedDate()} disabled={!exceptionsForSelectedDate.length} className={secondaryButton}>Usar programação habitual</button></div>{exceptionsForSelectedDate.length > 0 && <div className="mt-3 space-y-1 text-xs font-bold text-slate-600">{exceptionsForSelectedDate.map(exception => <p key={exception.id}>{exception.type === 'BLOCK_DAY' ? 'Dia inteiro bloqueado' : `${exception.type === 'BLOCK_PERIOD' ? 'Período bloqueado' : 'Horário extra'} · ${exception.startTime}–${exception.endTime}${exception.modality ? ` · ${modalityLabels[exception.modality]}` : ' · Ambos'}`}</p>)}</div>}{error && <p role="alert" className="mt-3 text-xs font-bold text-rose-700">{error}</p>}</div>}</div>}
  </section>;
}
