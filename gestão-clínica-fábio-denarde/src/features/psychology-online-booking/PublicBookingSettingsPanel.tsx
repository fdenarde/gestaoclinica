import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Globe2, MapPin, Plus, Save } from 'lucide-react';
import { createLocalPublicBookingRepository } from './repository';
import { syncLocalPublicBookingSettings } from './publicApiClient';
import PublicBookingAvailabilityEditor from './PublicBookingAvailabilityEditor';
import { isValidGoogleMapsUrl, normalizeProfessionalSlug, publicBookingWeekdayLabel } from './bookingDomain';
import type { PublicBookingAvailabilityPeriod, PublicBookingException, PublicBookingExceptionType, PublicBookingLocation, PublicBookingService, PublicBookingSettings } from './types';
import type { PsychologyLocation, PsychologyService } from '../psychology-pilot/psychologyR2a';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50';
const sectionClass = 'mt-5 rounded-2xl border border-violet-100 bg-white p-4';

function locationDraft(location: PublicBookingLocation) {
  return {
    displayName: location.displayName || location.name || '',
    fullAddress: location.fullAddress || location.address || '',
    city: location.city,
    state: location.state,
    googleMapsUrl: location.googleMapsUrl,
    sortOrder: location.sortOrder,
    active: location.active,
  };
}

function LocationRow({ location, onSave }: { key?: React.Key; location: PublicBookingLocation; onSave: (value: PublicBookingLocation) => Promise<string | null> }) {
  const [draft, setDraft] = useState(() => locationDraft(location));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(locationDraft(location)); }, [location]);
  const save = async () => {
    setError('');
    const message = await onSave({ ...location, ...draft, displayName: draft.displayName.trim(), fullAddress: draft.fullAddress.trim(), city: draft.city.trim(), state: draft.state.trim().toUpperCase(), googleMapsUrl: draft.googleMapsUrl.trim() });
    if (message) setError(message);
  };
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid={`location-row-${location.id}`}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Nome do local<input value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Endereço completo<input value={draft.fullAddress} onChange={event => setDraft({ ...draft, fullAddress: event.target.value })} className={`${inputClass} mt-1`} placeholder="Preencher posteriormente" /></label><label className="text-xs font-bold text-slate-600">Cidade<input value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Estado<input value={draft.state} onChange={event => setDraft({ ...draft, state: event.target.value })} maxLength={2} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600 sm:col-span-2">Link do Google Maps<input value={draft.googleMapsUrl} onChange={event => setDraft({ ...draft, googleMapsUrl: event.target.value })} className={`${inputClass} mt-1`} placeholder="https://maps.google.com/..." /></label></div><div className="mt-3 flex flex-wrap items-center gap-3"><label className="text-xs font-bold text-slate-600">Ordem<input type="number" min="1" value={draft.sortOrder} onChange={event => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={`${inputClass} mt-1 w-24`} /></label><label className="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} /> Ativo</label><button type="button" onClick={() => void save()} className={`${primaryButton} ml-auto`}><Save size={15} /> Salvar local</button></div>{error && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{error}</p>}</div>;
}

function ServiceRow({ service, locations, onSave }: { key?: React.Key; service: PublicBookingService; locations: PublicBookingLocation[]; onSave: (value: PublicBookingService) => Promise<void> }) {
  const [draft, setDraft] = useState(service);
  useEffect(() => { setDraft(service); }, [service]);
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid={`service-row-${service.id}`}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Serviço<input readOnly value={draft.name} className={`${inputClass} mt-1 bg-white`} /><span className="mt-1 block text-[11px] font-semibold text-slate-500">Catálogo canônico de Atendimentos.</span></label><label className="text-xs font-bold text-slate-600">Duração interna (minutos)<input readOnly type="number" value={draft.durationMinutes} className={`${inputClass} mt-1 bg-white`} /><span className="mt-1 block text-[11px] font-semibold text-slate-500">Alterada em Atendimentos.</span></label><label className="text-xs font-bold text-slate-600">Ordem<input type="number" min="1" value={draft.sortOrder} onChange={event => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><div className="flex flex-wrap items-end gap-3 pb-1"><label className="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} /> Publicado</label><label className="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" checked={draft.onlineEnabled} onChange={event => setDraft({ ...draft, onlineEnabled: event.target.checked })} /> Online</label><label className="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" checked={draft.inPersonEnabled} onChange={event => setDraft({ ...draft, inPersonEnabled: event.target.checked })} /> Presencial</label></div></div>{draft.inPersonEnabled && locations.length > 0 && <fieldset className="mt-3"><legend className="text-xs font-bold text-slate-600">Locais permitidos para este serviço</legend><div className="mt-2 flex flex-wrap gap-2">{locations.map(location => <label key={location.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={draft.allowedLocationIds.includes(location.id)} onChange={event => setDraft({ ...draft, allowedLocationIds: event.target.checked ? [...new Set([...draft.allowedLocationIds, location.id])] : draft.allowedLocationIds.filter(id => id !== location.id) })} /> {location.displayName}</label>)}</div></fieldset>}<button type="button" onClick={() => void onSave({ ...draft, name: service.name, durationMinutes: service.durationMinutes, sortOrder: Math.max(1, draft.sortOrder) })} className={`${primaryButton} mt-3`}><Save size={15} /> Salvar publicação</button></div>;
}

const availabilityDayLabels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

type HabitualDayDraft = { dayOfWeek: number; enabled: boolean; periods: PublicBookingAvailabilityPeriod[] };

function habitualDraftFromSettings(settings: PublicBookingSettings): HabitualDayDraft[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const periods = settings.publicBookingAvailability.filter(period => period.dayOfWeek === dayOfWeek).map(period => ({ ...period }));
    return { dayOfWeek, enabled: periods.some(period => period.enabled), periods };
  });
}

function calendarDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calendarMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

function PublicBookingAvailabilitySettings({ settings, onSave }: { settings: PublicBookingSettings; onSave: (patch: Partial<PublicBookingSettings>, message: string) => Promise<void> }) {
  const today = new Date();
  const [habitualDays, setHabitualDays] = useState<HabitualDayDraft[]>(() => habitualDraftFromSettings(settings));
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState('');
  const [availabilityArea, setAvailabilityArea] = useState<'routine' | 'exceptions'>('routine');
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [exceptionStart, setExceptionStart] = useState('15:00');
  const [exceptionEnd, setExceptionEnd] = useState('17:00');
  const [exceptionError, setExceptionError] = useState('');
  useEffect(() => { setHabitualDays(habitualDraftFromSettings(settings)); }, [settings.publicBookingAvailability]);

  const updateDay = (dayOfWeek: number, patch: Partial<HabitualDayDraft>) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day));
  const updatePeriod = (dayOfWeek: number, index: number, patch: Partial<PublicBookingAvailabilityPeriod>) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.map((period, periodIndex) => periodIndex === index ? { ...period, ...patch } : period) } : day));
  const addHabitualPeriod = (dayOfWeek: number) => {
    const first = habitualDays[dayOfWeek]?.periods[0];
    const period: PublicBookingAvailabilityPeriod = { dayOfWeek, enabled: true, startTime: '13:00', endTime: '17:00', modalities: first?.modalities || settings.publishedModalities.filter(item => item.active).map(item => item.id), locationIds: first?.locationIds || settings.locations.filter(item => item.active).map(item => item.id) };
    setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, enabled: true, periods: [...day.periods, period] } : day));
  };
  const removeHabitualPeriod = (dayOfWeek: number, index: number) => setHabitualDays(current => current.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.filter((_, periodIndex) => periodIndex !== index) } : day));
  const saveHabitual = async () => {
    const invalid = habitualDays.some(day => day.periods.some(period => period.endTime <= period.startTime));
    if (invalid) { setExceptionError('Corrija os períodos habituais: o fim precisa ser depois do início.'); return false; }
    setExceptionError('');
    await onSave({ publicBookingAvailability: habitualDays.flatMap(day => day.periods.map(period => ({ ...period, enabled: day.enabled }))) }, 'Horários habituais do agendamento online salvos neste navegador.');
    return true;
  };

  const monthYear = calendarMonth.getFullYear();
  const monthIndex = calendarMonth.getMonth();
  const daysInMonth = new Date(monthYear, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(monthYear, monthIndex, 1).getDay();
  const calendarCells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => calendarDateKey(monthYear, monthIndex, index + 1))];
  const exceptionsForSelectedDate = settings.publicBookingExceptions.filter(exception => exception.civilDate === selectedDate);
  const exceptionStatus = (date: string): 'NORMAL' | 'ALTERADO' | 'INDISPONÍVEL' => {
    const exceptions = settings.publicBookingExceptions.filter(exception => exception.civilDate === date);
    return exceptions.some(exception => exception.type === 'BLOCK_DAY') ? 'INDISPONÍVEL' : exceptions.length ? 'ALTERADO' : 'NORMAL';
  };
  const saveException = async (type: PublicBookingExceptionType) => {
    setExceptionError('');
    if (type !== 'BLOCK_DAY' && exceptionEnd <= exceptionStart) { setExceptionError('O fim precisa ser depois do início.'); return; }
    const now = new Date().toISOString();
    const base: PublicBookingException = { id: `public-exception-${Date.now().toString(36)}`, professionalId: settings.professionalId, civilDate: selectedDate, type, startTime: type === 'BLOCK_DAY' ? undefined : exceptionStart, endTime: type === 'BLOCK_DAY' ? undefined : exceptionEnd, note: undefined, createdAt: now, updatedAt: now };
    const retained = settings.publicBookingExceptions.filter(exception => exception.civilDate !== selectedDate || (type !== 'BLOCK_DAY' && exception.type !== 'BLOCK_DAY'));
    await onSave({ publicBookingExceptions: [...retained, base] }, type === 'BLOCK_DAY' ? 'Dia bloqueado para novos agendamentos públicos.' : type === 'BLOCK_PERIOD' ? 'Período bloqueado para novos agendamentos públicos.' : 'Horário extra liberado para novos agendamentos públicos.');
  };
  const resetSelectedDate = async () => {
    await onSave({ publicBookingExceptions: settings.publicBookingExceptions.filter(exception => exception.civilDate !== selectedDate) }, 'A data voltou a usar a programação habitual.');
  };

  const monthlyExceptionCount = settings.publicBookingExceptions.filter(exception => exception.civilDate.startsWith(`${monthYear}-${String(monthIndex + 1).padStart(2, '0')}-`)).length;
  const routineSummary = habitualDays.filter(day => day.enabled && day.periods.length).map(day => `${availabilityDayLabels[day.dayOfWeek].slice(0, 3)} ${day.periods.map(period => `${period.startTime}–${period.endTime}`).join(' · ')}`).join(' · ') || 'Indisponível';

  return <PublicBookingAvailabilityEditor settings={settings} onSave={onSave} />;

  return <section className={sectionClass} data-testid="psychology-public-availability-settings"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Disponibilidade para agendamento</p><h4 className="mt-1 text-lg font-black text-violet-950">Horários públicos flexíveis</h4><p className="mt-1 text-sm text-slate-600">Ajuste somente novas vagas. Sessions, Agenda Pessoal e demais bloqueios reais sempre vencem liberações extras.</p></div><CalendarDays className="shrink-0 text-violet-700" size={21} /></div><div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black text-slate-900">Horários habituais</p><p className="text-xs font-semibold text-slate-500">Programação pública semanal, com múltiplos períodos por dia.</p></div><button type="button" onClick={() => void saveHabitual()} className={primaryButton}><Save size={15} /> Salvar horários</button></div><div className="mt-3 space-y-2">{habitualDays.map(day => <div key={day.dayOfWeek} className="rounded-xl border border-slate-200 bg-white p-3"><label className="flex items-center gap-2 text-sm font-black text-slate-800"><input type="checkbox" checked={day.enabled} onChange={event => updateDay(day.dayOfWeek, { enabled: event.target.checked })} /> {availabilityDayLabels[day.dayOfWeek]}</label>{day.enabled && <div className="mt-3 space-y-2 pl-6">{day.periods.map((period, index) => <div key={`${day.dayOfWeek}-${index}`} className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold text-slate-600">Início<input aria-label={`${availabilityDayLabels[day.dayOfWeek]} início público ${index + 1}`} type="time" value={period.startTime} onChange={event => updatePeriod(day.dayOfWeek, index, { startTime: event.target.value })} className={`${inputClass} mt-1`} /></label><span className="pb-2 text-slate-400">—</span><label className="text-xs font-bold text-slate-600">Fim<input aria-label={`${availabilityDayLabels[day.dayOfWeek]} fim público ${index + 1}`} type="time" value={period.endTime} onChange={event => updatePeriod(day.dayOfWeek, index, { endTime: event.target.value })} className={`${inputClass} mt-1`} /></label><button type="button" onClick={() => removeHabitualPeriod(day.dayOfWeek, index)} className="rounded-lg px-2 py-2 text-xs font-black text-slate-500 hover:bg-rose-50 hover:text-rose-700">Remover</button></div>)}<button type="button" onClick={() => addHabitualPeriod(day.dayOfWeek)} className="rounded-lg px-2 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-100">+ Adicionar período</button></div>}</div>)}</div></div><div className="mt-4 rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black text-slate-900">Exceções e ajustes</p><p className="text-xs font-semibold text-slate-500">NORMAL segue o padrão · ALTERADO tem ajuste · INDISPONÍVEL bloqueia o dia.</p></div><div className="flex gap-1"><button type="button" aria-label="Mês anterior" onClick={() => setCalendarMonth(new Date(monthYear, monthIndex - 1, 1))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronLeft size={17} /></button><span className="min-w-32 py-2 text-center text-sm font-black capitalize">{calendarMonthLabel(monthYear, monthIndex)}</span><button type="button" aria-label="Próximo mês" onClick={() => setCalendarMonth(new Date(monthYear, monthIndex + 1, 1))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><ChevronRight size={17} /></button></div></div><div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-slate-500">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}{calendarCells.map((date, index) => date ? <button type="button" key={date} onClick={() => setSelectedDate(date)} aria-label={`${date} · ${exceptionStatus(date)}`} className={`min-h-10 rounded-lg border p-1 text-xs font-black transition ${selectedDate === date ? 'border-violet-600 bg-violet-100 text-violet-900' : exceptionStatus(date) === 'INDISPONÍVEL' ? 'border-rose-200 bg-rose-50 text-rose-700' : exceptionStatus(date) === 'ALTERADO' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-100 bg-slate-50 text-slate-700'}`}>{Number(date.slice(-2))}</button> : <span key={`empty-${index}`} />)}</div><div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3"><p className="text-sm font-black text-violet-950">Data selecionada: {selectedDate}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Início do ajuste<input type="time" value={exceptionStart} onChange={event => setExceptionStart(event.target.value)} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Fim do ajuste<input type="time" value={exceptionEnd} onChange={event => setExceptionEnd(event.target.value)} className={`${inputClass} mt-1`} /></label></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void saveException('BLOCK_DAY')} className={secondaryButton}>Bloquear dia inteiro</button><button type="button" onClick={() => void saveException('BLOCK_PERIOD')} className={secondaryButton}>Bloquear período</button><button type="button" onClick={() => void saveException('OPEN_PERIOD')} className={primaryButton}>Liberar horário extra</button><button type="button" onClick={() => void resetSelectedDate()} disabled={!exceptionsForSelectedDate.length} className={secondaryButton}>Usar programação habitual</button></div>{exceptionsForSelectedDate.length > 0 && <div className="mt-3 space-y-1 text-xs font-bold text-slate-600">{exceptionsForSelectedDate.map(exception => <p key={exception.id}>{exception.type === 'BLOCK_DAY' ? 'Dia inteiro bloqueado' : `${exception.type === 'BLOCK_PERIOD' ? 'Período bloqueado' : 'Horário extra'} · ${exception.startTime}–${exception.endTime}`}</p>)}</div>}{exceptionError && <p role="alert" className="mt-3 text-xs font-bold text-rose-700">{exceptionError}</p>}</div></div></section>;
}

function LegacyPublicBookingSettingsPanel() {
  const repository = useMemo(() => createLocalPublicBookingRepository({ storage: window.localStorage }), []);
  const [settings, setSettings] = useState<PublicBookingSettings | null>(null);
  const [form, setForm] = useState({ active: true, professionalSlug: '', maxAdvanceDays: 21, minNoticeHours: 24, cancellationEnabled: true, cancellationCutoffHours: 16, whatsappContactPhoneE164: '' });
  const [newLocation, setNewLocation] = useState({ displayName: '', fullAddress: '', city: '', state: '', googleMapsUrl: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void repository.getSettings().then(value => { if (!value) return; setSettings(value); setForm({ active: value.active, professionalSlug: value.professionalSlug, maxAdvanceDays: value.maxAdvanceDays, minNoticeHours: value.minNoticeHours, cancellationEnabled: value.cancellationEnabled, cancellationCutoffHours: value.cancellationCutoffHours, whatsappContactPhoneE164: value.whatsappContactPhoneE164 }); }); }, [repository]);
  const save = async () => {
    const professionalSlug = normalizeProfessionalSlug(form.professionalSlug);
    if (!professionalSlug) { setError('Informe um slug público válido.'); return; }
    setError('');
    const next = await repository.updateSettings({ ...form, professionalSlug });
    setSettings(next); setForm({ active: next.active, professionalSlug: next.professionalSlug, maxAdvanceDays: next.maxAdvanceDays, minNoticeHours: next.minNoticeHours, cancellationEnabled: next.cancellationEnabled, cancellationCutoffHours: next.cancellationCutoffHours, whatsappContactPhoneE164: next.whatsappContactPhoneE164 }); setNotice('Configurações de agendamento online salvas neste navegador.');
  };
  const saveLocation = async (location: PublicBookingLocation): Promise<string | null> => {
    if (!location.displayName.trim()) return 'Informe o nome do local.';
    if (!isValidGoogleMapsUrl(location.googleMapsUrl)) return 'Informe uma URL HTTPS válida do Google Maps.';
    const next = await repository.updateSettings({ locations: settings?.locations.map(item => item.id === location.id ? location : item) || [] });
    setSettings(next); setNotice('Local presencial atualizado neste navegador.'); return null;
  };
  const addLocation = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!newLocation.displayName.trim()) { setError('Informe o nome do novo local.'); return; }
    if (!isValidGoogleMapsUrl(newLocation.googleMapsUrl)) { setError('Informe uma URL HTTPS válida do Google Maps.'); return; }
    const locations = [...(settings?.locations || []), { id: `location-${Date.now().toString(36)}`, professionalId: settings?.professionalId || '', displayName: newLocation.displayName.trim(), fullAddress: newLocation.fullAddress.trim(), city: newLocation.city.trim(), state: newLocation.state.trim().toUpperCase(), googleMapsUrl: newLocation.googleMapsUrl.trim(), active: true, sortOrder: (settings?.locations || []).reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1 }];
    const next = await repository.updateSettings({ locations }); setSettings(next); setNewLocation({ displayName: '', fullAddress: '', city: '', state: '', googleMapsUrl: '' }); setNotice('Novo local presencial cadastrado neste navegador.');
  };
  const saveService = async (service: PublicBookingService) => { const next = await repository.updateSettings({ publishedServices: settings?.publishedServices.map(item => item.id === service.id ? service : item) || [] }); setSettings(next); setNotice('Serviço atualizado neste navegador.'); };
  const saveAvailability = async (patch: Partial<PublicBookingSettings>, message: string) => { const next = await repository.updateSettings(patch); setSettings(next); setNotice(message); };
  if (!settings) return <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5" data-testid="psychology-online-booking-settings"><p className="font-black text-violet-950">Agendamento Online</p><p className="mt-2 text-sm text-violet-800">Carregando configuração local…</p></section>;
  const publicUrl = `${window.location.origin}/agendar/${form.professionalSlug || settings.professionalSlug}`;
  const sortedLocations = [...settings.locations].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortedServices = [...settings.publishedServices].sort((a, b) => a.sortOrder - b.sortOrder);
  return <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm" data-testid="psychology-online-booking-settings"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · Agendamento Online</p><h3 className="mt-1 text-xl font-black text-violet-950">Link público da Psicologia</h3><p className="mt-1 max-w-2xl text-sm text-violet-900">Configure a publicação local sem alterar a Agenda semanal aprovada. A disponibilidade pública é um recorte dos horários habituais.</p></div><div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${form.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}><Globe2 size={14} /> {form.active ? 'Publicado' : 'Desativado'}</div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Slug público<input value={form.professionalSlug} onChange={event => setForm({ ...form, professionalSlug: event.target.value })} className={`${inputClass} mt-1`} placeholder="leila-chaves" /></label><label className="text-xs font-bold text-slate-600">WhatsApp para solicitações<input value={form.whatsappContactPhoneE164} onChange={event => setForm({ ...form, whatsappContactPhoneE164: event.target.value })} className={`${inputClass} mt-1`} placeholder="552799529638" inputMode="tel" /><span className="mt-1 block text-[11px] font-semibold text-slate-500">Cada profissional poderá registrar seu próprio número.</span></label><label className="text-xs font-bold text-slate-600">Antecedência máxima<input type="number" min="1" max="90" value={form.maxAdvanceDays} onChange={event => setForm({ ...form, maxAdvanceDays: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Antecedência mínima (horas)<input type="number" min="0" max="168" value={form.minNoticeHours} onChange={event => setForm({ ...form, minNoticeHours: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><label className="flex items-center gap-3 rounded-xl border border-violet-100 bg-white px-3 py-3 text-sm font-black text-slate-700"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Publicar agendamento online</label><label className="flex items-center gap-3 rounded-xl border border-violet-100 bg-white px-3 py-3 text-sm font-black text-slate-700"><input type="checkbox" checked={form.cancellationEnabled} onChange={event => setForm({ ...form, cancellationEnabled: event.target.checked })} /> Permitir cancelamento pelo paciente</label><label className="text-xs font-bold text-slate-600">Limite para cancelamento (horas)<input type="number" min="0" max="168" value={form.cancellationCutoffHours} onChange={event => setForm({ ...form, cancellationCutoffHours: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label></div><div className="mt-5 rounded-2xl border border-violet-100 bg-white p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Identidade pública</p><p className="mt-2 font-black text-slate-900">{settings.clinicDisplayName} · {settings.professionalName}</p><p className="mt-1 break-all text-sm font-semibold text-violet-700">{publicUrl}</p><div className="mt-4 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-3"><span><CheckCircle2 size={14} className="mr-1 inline text-emerald-600" />{settings.publishedServices.filter(item => item.active).length} serviço(s) publicado(s)</span><span><CheckCircle2 size={14} className="mr-1 inline text-emerald-600" />{settings.publishedModalities.filter(item => item.active).length} modalidade(s)</span><span><CheckCircle2 size={14} className="mr-1 inline text-emerald-600" />{settings.locations.filter(item => item.active).length} local(is)</span></div><div className="mt-3 flex flex-wrap gap-2">{settings.publicBookingAvailability.filter(item => item.enabled).map(item => <span key={item.dayOfWeek} className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">{publicBookingWeekdayLabel(item.dayOfWeek)} · {item.startTime}–{item.endTime}</span>)}</div></div><PublicBookingAvailabilitySettings settings={settings} onSave={saveAvailability} /><section className={sectionClass}><div className="flex items-start justify-between gap-3"><div><h4 className="font-black text-slate-900">Locais de atendimento presencial</h4><p className="mt-1 text-xs font-semibold text-slate-500">O mesmo cadastro alimenta o agendamento público, a Agenda e a página segura da consulta. Endereço e Maps podem ser preenchidos depois.</p></div><MapPin className="shrink-0 text-violet-700" size={20} /></div><div className="mt-4 space-y-3">{sortedLocations.map(location => <LocationRow key={location.id} location={location} onSave={saveLocation} />)}</div><form onSubmit={event => void addLocation(event)} className="mt-4 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 p-3"><p className="text-xs font-black uppercase tracking-wide text-violet-700">Adicionar local</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><input aria-label="Nome do novo local" value={newLocation.displayName} onChange={event => setNewLocation({ ...newLocation, displayName: event.target.value })} className={inputClass} placeholder="Nome do local" /><input aria-label="Endereço completo do novo local" value={newLocation.fullAddress} onChange={event => setNewLocation({ ...newLocation, fullAddress: event.target.value })} className={inputClass} placeholder="Endereço completo (opcional)" /><input aria-label="Cidade do novo local" value={newLocation.city} onChange={event => setNewLocation({ ...newLocation, city: event.target.value })} className={inputClass} placeholder="Cidade" /><input aria-label="Estado do novo local" value={newLocation.state} onChange={event => setNewLocation({ ...newLocation, state: event.target.value })} maxLength={2} className={inputClass} placeholder="UF" /><input aria-label="Google Maps do novo local" value={newLocation.googleMapsUrl} onChange={event => setNewLocation({ ...newLocation, googleMapsUrl: event.target.value })} className={`${inputClass} sm:col-span-2`} placeholder="Link do Google Maps (opcional)" /></div><button type="submit" className={`${secondaryButton} mt-3`}><Plus size={15} /> Cadastrar local</button></form></section><section className={sectionClass}><h4 className="font-black text-slate-900">Serviços publicados</h4><p className="mt-1 text-xs font-semibold text-slate-500">A duração é interna para calcular a agenda; não é exibida na página pública. As modalidades são controladas nesta configuração.</p><div className="mt-4 space-y-3">{sortedServices.map(service => <ServiceRow key={service.id} service={service} locations={sortedLocations} onSave={saveService} />)}</div></section>{notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{notice}</p>}{error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void save()} className={primaryButton}>Salvar configurações</button><a href={publicUrl} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={16} /> Abrir link público</a></div></section>;
}

type PublicBookingSettingsPanelSection = 'overview' | 'availability' | 'services' | 'rules' | 'confirmation';

function LocalPublicBookingSettingsPanel() {
  const repository = useMemo(() => createLocalPublicBookingRepository({ storage: window.localStorage }), []);
  const [settings, setSettings] = useState<PublicBookingSettings | null>(null);
  const [activeSection, setActiveSection] = useState<PublicBookingSettingsPanelSection>('overview');
  const [form, setForm] = useState({ active: true, professionalSlug: '', maxAdvanceDays: 21, minNoticeHours: 24, cancellationEnabled: true, cancellationCutoffHours: 16, whatsappContactPhoneE164: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void repository.getSettings().then(value => { if (!value) return; setSettings(value); setForm({ active: value.active, professionalSlug: value.professionalSlug, maxAdvanceDays: value.maxAdvanceDays, minNoticeHours: value.minNoticeHours, cancellationEnabled: value.cancellationEnabled, cancellationCutoffHours: value.cancellationCutoffHours, whatsappContactPhoneE164: value.whatsappContactPhoneE164 }); }); }, [repository]);
  const persistSettings = async (patch: Partial<PublicBookingSettings>) => {
    const next = await repository.updateSettings(patch);
    await syncLocalPublicBookingSettings(next);
    return next;
  };
  const save = async () => {
    const professionalSlug = normalizeProfessionalSlug(form.professionalSlug);
    if (!professionalSlug) { setError('Informe um slug público válido.'); return; }
    setError('');
    const next = await persistSettings({ ...form, professionalSlug });
    setSettings(next); setForm({ active: next.active, professionalSlug: next.professionalSlug, maxAdvanceDays: next.maxAdvanceDays, minNoticeHours: next.minNoticeHours, cancellationEnabled: next.cancellationEnabled, cancellationCutoffHours: next.cancellationCutoffHours, whatsappContactPhoneE164: next.whatsappContactPhoneE164 }); setNotice('Configurações de agendamento online salvas neste navegador.');
  };
  const saveAvailability = async (patch: Partial<PublicBookingSettings>, message: string) => { const next = await persistSettings(patch); setSettings(next); setNotice(message); };
  const saveService = async (service: PublicBookingService) => { const next = await persistSettings({ publishedServices: settings?.publishedServices.map(item => item.id === service.id ? service : item) || [] }); setSettings(next); setNotice('Serviço publicado atualizado neste navegador.'); };
  if (!settings) return <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5" data-testid="psychology-online-booking-settings"><p className="font-black text-violet-950">Agendamento Online</p><p className="mt-2 text-sm text-violet-800">Carregando configuração local…</p></section>;
  const publicUrl = `${window.location.origin}/agendar/${form.professionalSlug || settings.professionalSlug}`;
  const sortedServices = [...settings.publishedServices].sort((a, b) => a.sortOrder - b.sortOrder);
  const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  const selectSection = (section: PublicBookingSettingsPanelSection) => setActiveSection(current => current === section ? 'overview' : section);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="psychology-online-booking-settings"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · Psicologia</p><h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">Agendamento Online</h3><p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">Configure o link público, a disponibilidade e as regras sem deixar todos os formulários abertos ao mesmo tempo.</p></div><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${form.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}><Globe2 size={14} /> {form.active ? 'Ativo' : 'Inativo'}</span></div>{activeSection === 'overview' && <div className="mt-5 space-y-3" data-testid="psychology-online-booking-overview"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Link público</p><p className="mt-2 break-all text-sm font-black text-violet-800">{publicUrl}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { void navigator.clipboard?.writeText(publicUrl).then(() => setNotice('Link público copiado.')).catch(() => setNotice('Copie o link exibido manualmente.')); }} className={secondaryButton}>Copiar link</button><a href={publicUrl} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={15} /> Abrir página</a></div></div><div className="grid gap-3 md:grid-cols-2"><button type="button" onClick={() => selectSection('availability')} className={`${cardClass} text-left hover:border-violet-300`}><p className="text-sm font-black text-slate-900">Disponibilidade pública</p><p className="mt-1 text-xs text-slate-500">{settings.publicBookingAvailability.filter(item => item.enabled).length} faixas habituais · {settings.publicBookingExceptions.length} exceções</p><span className="mt-3 inline-flex rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-700">Gerenciar</span></button><button type="button" onClick={() => selectSection('services')} className={`${cardClass} text-left hover:border-violet-300`}><p className="text-sm font-black text-slate-900">Serviços publicados</p><p className="mt-1 text-xs text-slate-500">{settings.publishedServices.filter(item => item.active).length} ativos · modalidades públicas preservadas</p><span className="mt-3 inline-flex rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-700">Gerenciar</span></button><button type="button" onClick={() => selectSection('rules')} className={`${cardClass} text-left hover:border-violet-300`}><p className="text-sm font-black text-slate-900">Regras de agendamento</p><p className="mt-1 text-xs text-slate-500">Até {form.maxAdvanceDays} dias · mínimo {form.minNoticeHours}h</p><span className="mt-3 inline-flex rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-700">Editar</span></button><button type="button" onClick={() => selectSection('confirmation')} className={`${cardClass} text-left hover:border-violet-300`}><p className="text-sm font-black text-slate-900">Confirmação e cancelamento</p><p className="mt-1 text-xs text-slate-500">Link de gestão · cancelamento conforme antecedência · reagendamento por WhatsApp</p><span className="mt-3 inline-flex rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-black text-violet-700">Editar</span></button></div></div>}{activeSection !== 'overview' && <div className="mt-4"><button type="button" onClick={() => setActiveSection('overview')} className="mb-3 rounded-lg px-2 py-1 text-xs font-black text-violet-700 hover:bg-violet-100">← Voltar ao resumo</button>{activeSection === 'availability' && <PublicBookingAvailabilitySettings settings={settings} onSave={saveAvailability} />}{activeSection === 'services' && <section className={cardClass} data-testid="psychology-public-services-settings"><p className="text-sm font-black text-slate-900">Serviços publicados</p><p className="mt-1 text-xs text-slate-500">Nome, ativo, ordem, duração, modalidades e locais permitidos continuam no contrato público canônico.</p><div className="mt-3 space-y-3">{sortedServices.map(service => <ServiceRow key={service.id} service={service} locations={settings.locations} onSave={saveService} />)}</div></section>}{(activeSection === 'rules' || activeSection === 'confirmation') && <section className={cardClass} data-testid={`psychology-online-${activeSection}-editor`}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Slug público<input value={form.professionalSlug} onChange={event => setForm({ ...form, professionalSlug: event.target.value })} className={`${inputClass} mt-1`} /></label>{activeSection === 'confirmation' && <label className="text-xs font-bold text-slate-600">WhatsApp para solicitações<input value={form.whatsappContactPhoneE164} onChange={event => setForm({ ...form, whatsappContactPhoneE164: event.target.value })} className={`${inputClass} mt-1`} placeholder="552799529638" inputMode="tel" /><span className="mt-1 block text-[11px] font-semibold text-slate-500">Cada profissional poderá registrar seu próprio número.</span></label>}{activeSection === 'rules' && <><label className="text-xs font-bold text-slate-600">Antecedência máxima<input type="number" min="1" max="90" value={form.maxAdvanceDays} onChange={event => setForm({ ...form, maxAdvanceDays: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Antecedência mínima (horas)<input type="number" min="0" max="168" value={form.minNoticeHours} onChange={event => setForm({ ...form, minNoticeHours: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label></>}{activeSection === 'confirmation' && <label className="text-xs font-bold text-slate-600">Limite para cancelamento (horas)<input type="number" min="0" max="168" value={form.cancellationCutoffHours} onChange={event => setForm({ ...form, cancellationCutoffHours: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-slate-700"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Agendamento online ativo</label>{activeSection === 'confirmation' && <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-slate-700"><input type="checkbox" checked={form.cancellationEnabled} onChange={event => setForm({ ...form, cancellationEnabled: event.target.checked })} /> Permitir cancelamento pelo paciente</label>}</div><button type="button" onClick={() => void save()} className={`${primaryButton} mt-4`}>Salvar alterações</button>{error && <p role="alert" className="mt-3 text-xs font-bold text-rose-700">{error}</p>}</section>}</div>}{notice && <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{notice}</p>}</section>;
}

type RemotePublicBookingSettingsPanelProps = {
  services: PsychologyService[];
  locations: PsychologyLocation[];
  onSave: (services: PsychologyService[]) => boolean | Promise<boolean>;
};

function toPublicBookingLocation(location: PsychologyLocation): PublicBookingLocation {
  return {
    id: location.id,
    professionalId: location.professionalId,
    displayName: location.displayName,
    fullAddress: location.fullAddress || location.address || '',
    city: location.city || '',
    state: location.state || '',
    googleMapsUrl: location.googleMapsUrl || '',
    active: location.active !== false,
    sortOrder: location.sortOrder || 1,
  };
}

function toPublicBookingService(service: PsychologyService, index: number): PublicBookingService {
  const publication = service.publicBooking;
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.defaultDurationMinutes,
    active: service.active && (publication?.active ?? true),
    sortOrder: publication?.sortOrder || index + 1,
    onlineEnabled: publication?.onlineEnabled ?? service.modality !== 'PRESENTIAL',
    inPersonEnabled: publication?.inPersonEnabled ?? service.modality !== 'ONLINE',
    allowedLocationIds: [...(publication?.allowedLocationIds || [])],
  };
}

function RemotePublicBookingServicesPanel({ services, locations, onSave }: RemotePublicBookingSettingsPanelProps) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const publicLocations = useMemo(() => locations.map(toPublicBookingLocation).sort((a, b) => a.sortOrder - b.sortOrder), [locations]);
  const sortedServices = useMemo(() => services
    .map((service, index) => toPublicBookingService(service, index))
    .sort((a, b) => a.sortOrder - b.sortOrder), [services]);

  const saveService = async (publicService: PublicBookingService) => {
    setError('');
    const nextServices = services.map(service => {
      if (service.id !== publicService.id) return service;
      return {
        ...service,
        publicBooking: {
          active: publicService.active,
          onlineEnabled: publicService.onlineEnabled,
          inPersonEnabled: publicService.inPersonEnabled,
          allowedLocationIds: [...publicService.allowedLocationIds],
          sortOrder: Math.max(1, publicService.sortOrder),
        },
      };
    });
    const saved = await onSave(nextServices);
    if (!saved) {
      setError('O provider remoto não confirmou a publicação do serviço.');
      return;
    }
    setNotice('Publicação do serviço salva no provider remoto.');
  };

  return <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm" data-testid="psychology-online-booking-settings"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · Agendamento Online</p><h3 className="mt-1 text-xl font-black text-violet-950">Publicação remota da Psicologia</h3><p className="mt-1 max-w-3xl text-sm text-violet-900">Serviços, modalidades, ordem e locais permitidos são persistidos no catálogo remoto oficial. Este painel não usa localStorage para confirmar alterações.</p></div><div className="mt-5 space-y-3">{sortedServices.map(service => <ServiceRow key={service.id} service={service} locations={publicLocations} onSave={saveService} />)}</div>{notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{notice}</p>}{error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}</section>;
}

type PublicBookingSettingsPanelProps = {
  remoteServices?: PsychologyService[];
  remoteLocations?: PsychologyLocation[];
  onSaveRemoteServices?: (services: PsychologyService[]) => boolean | Promise<boolean>;
};

export default function PublicBookingSettingsPanel({ remoteServices, remoteLocations, onSaveRemoteServices }: PublicBookingSettingsPanelProps = {}) {
  if (onSaveRemoteServices && remoteServices && remoteLocations) {
    return <RemotePublicBookingServicesPanel services={remoteServices} locations={remoteLocations} onSave={onSaveRemoteServices} />;
  }
  return <LocalPublicBookingSettingsPanel />;
}
