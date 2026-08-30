import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Video } from 'lucide-react';
import { addDaysToDateKey, formatDateKey, serviceAllowsModality } from './bookingDomain';
import { createPublicBookingApiClient } from './publicApiClient';
import PublicBookingLocationDetails from './PublicBookingLocationDetails';
import { civilDateFromDate, requiresResponsible, validatePsychologyPatientAdministrativeInput } from '../../lib/psychologyPatientAdministrative';
import type {
  PublicBookingLocation,
  PublicBookingModality,
  PublicBookingRequest,
  PublicBookingResult,
  PublicBookingService,
  PublicBookingSettings,
  PublicBookingSlot,
} from './types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base text-slate-900 outline-none transition focus:border-violet-600 focus:ring-4 focus:ring-violet-100';
const buttonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const quietButtonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50';

function PublicBookingShell({ settings, children }: { settings?: PublicBookingSettings; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[linear-gradient(145deg,#f8f7ff_0%,#f8fafc_58%,#eefcf8_100%)] px-4 py-5 text-slate-900 sm:px-6 sm:py-8" data-testid="public-booking-shell"><div className="mx-auto w-full max-w-2xl"><header className="mb-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{settings?.clinicDisplayName || 'Gestão Clínica'}</p><h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Agendamento online</h1></header>{children}<footer className="mt-6 text-center text-xs font-semibold text-slate-500">Atendimento organizado com privacidade · nenhum dado é compartilhado nesta prévia local</footer></div></div>;
}

function StepHeader({ step, title, text }: { step: number; title: string; text: string }) {
  return <div className="mb-5"><div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-violet-700"><span className="grid h-7 w-7 place-items-center rounded-full bg-violet-100">{step}</span><span>Agendamento online</span></div><h2 className="text-2xl font-black tracking-tight text-slate-950">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p></div>;
}

function ChoiceCard({ selected, title, text, icon, onClick }: { key?: React.Key; selected: boolean; title: string; text: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`flex min-h-20 w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${selected ? 'border-violet-600 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40'}`}><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${selected ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{icon}</span><span className="min-w-0"><span className="block font-black text-slate-900">{title}</span><span className="mt-1 block text-xs font-semibold text-slate-500">{text}</span></span></button>;
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(parsed).replace('.', '');
}

function longDateLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
}

type CalendarDay = { date: Date; dateKey: string; inMonth: boolean };

const calendarWeekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

function calendarMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function calendarMonthLabel(date: Date): string {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function buildMonthlyCalendarDays(month: Date): CalendarDay[] {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return { date, dateKey: formatDateKey(date), inMonth: date.getMonth() === month.getMonth() };
  });
}

function MonthlyCalendar({ dates, selectedDate, month, onMonthChange, onSelectDate }: { dates: string[]; selectedDate: string; month: Date; onMonthChange: (nextMonth: Date) => void; onSelectDate: (date: string) => void }) {
  const todayKey = formatDateKey(new Date());
  const availableDates = useMemo(() => new Set(dates), [dates]);
  const calendarDays = useMemo(() => buildMonthlyCalendarDays(month), [month]);
  const currentMonthKey = calendarMonthKey(new Date());
  const lastAvailableMonthKey = dates.length ? calendarMonthKey(new Date(`${[...dates].sort().at(-1)}T12:00:00`)) : currentMonthKey;
  const monthKey = calendarMonthKey(month);
  const previousDisabled = monthKey <= currentMonthKey;
  const nextDisabled = monthKey > lastAvailableMonthKey;
  const moveMonth = (offset: number) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1));

  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4" data-testid="public-booking-calendar">
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={() => moveMonth(-1)} disabled={previousDisabled} aria-label="Mês anterior" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-violet-300 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={18} aria-hidden="true" /></button>
      <h3 className="text-center text-base font-black text-slate-950" data-testid="public-booking-calendar-month">{calendarMonthLabel(month)}</h3>
      <button type="button" onClick={() => moveMonth(1)} disabled={nextDisabled} aria-label="Próximo mês" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-violet-300 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-[0.65rem] font-black tracking-wide text-slate-500" role="row" data-testid="public-booking-weekdays">{calendarWeekdays.map(weekday => <span key={weekday} role="columnheader">{weekday}</span>)}</div>
    <div className="mt-1.5 grid grid-cols-7 gap-1.5" role="grid" aria-label={`Calendário de ${calendarMonthLabel(month)}`}>
      {calendarDays.map(({ date, dateKey, inMonth }) => {
        const isToday = dateKey === todayKey;
        const isPast = dateKey < todayKey;
        const isAvailable = inMonth && !isPast && availableDates.has(dateKey);
        const isSelected = selectedDate === dateKey;
        const dateDescription = `${dateLabel(dateKey)}, ${isAvailable ? 'disponível' : 'indisponível'}${isToday ? ', hoje' : ''}`;
        return <button type="button" key={dateKey} role="gridcell" disabled={!isAvailable} aria-label={dateDescription} aria-selected={isSelected} aria-current={isToday ? 'date' : undefined} data-testid={`public-booking-date-${dateKey}`} onClick={() => onSelectDate(dateKey)} className={`relative flex aspect-square min-h-11 min-w-0 items-center justify-center rounded-xl border text-sm font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 ${!inMonth ? 'border-transparent bg-transparent text-slate-300' : isAvailable ? isSelected ? 'border-violet-700 bg-violet-700 text-white shadow-sm' : 'border-violet-200 bg-white text-slate-900 hover:border-violet-500 hover:bg-violet-50' : 'border-slate-200 bg-white text-slate-400'} disabled:cursor-not-allowed`}>
          <span>{date.getDate()}</span>
          {isToday && <span className={`absolute top-1 h-1 w-1 rounded-full ${isSelected ? 'bg-violet-200' : 'bg-violet-600'}`} aria-hidden="true" />}
          {isAvailable && <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} aria-hidden="true" />}
        </button>;
      })}
    </div>
    <p className="mt-3 text-xs font-semibold text-slate-500"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Dias com horário disponível</p>
  </div>;
}

function DateSelectionStep({ progressStep, totalSteps, dates, datesLoading, selectedDate, calendarMonth, onMonthChange, onSelectDate, onBack }: { progressStep: number; totalSteps: number; dates: string[]; datesLoading: boolean; selectedDate: string; calendarMonth: Date; onMonthChange: (nextMonth: Date) => void; onSelectDate: (date: string) => void; onBack: () => void }) {
  return <section className={cardClass} data-testid="public-booking-date-step">
    <button type="button" onClick={onBack} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Voltar</button>
    <p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500">Etapa {progressStep} de {totalSteps}</p>
    <StepHeader step={progressStep} title="Escolha uma data" text="Selecione um dia disponível para ver os horários." />
    {datesLoading ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-600">Verificando disponibilidade, duração e conflitos da agenda.</div> : <><MonthlyCalendar dates={dates} selectedDate={selectedDate} month={calendarMonth} onMonthChange={onMonthChange} onSelectDate={onSelectDate} />{!dates.length && <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"><CalendarDays className="mx-auto text-slate-400" size={24} /><p className="mt-2 font-black">Nenhuma data disponível</p><p className="mt-1 text-sm text-slate-500">Escolha outra modalidade ou local, ou tente novamente mais tarde.</p></div>}</>}
  </section>;
}

function locationLabel(location: PublicBookingLocation | undefined): string {
  return location?.displayName || location?.name || 'Local presencial';
}

type PublicPatientDraft = {
  name: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  administrativeResponsible: { fullName: string; relationship: string; phone: string; email: string };
};

function PublicFieldError({ message }: { message?: string }) {
  return message ? <span className="mt-1 block text-xs font-bold text-rose-700">{message}</span> : null;
}

function PublicPatientStep({ patient, errors, progressStep, referenceDate, onChange, onResponsibleChange, onSubmit }: { patient: PublicPatientDraft; errors: Record<string, string>; progressStep: number; referenceDate: string; onChange: (patch: Partial<PublicPatientDraft>) => void; onResponsibleChange: (patch: Partial<PublicPatientDraft['administrativeResponsible']>) => void; onSubmit: (event: React.FormEvent) => void }) {
  const showResponsible = requiresResponsible(patient.dateOfBirth, referenceDate);
  return <section className={cardClass}><StepHeader step={progressStep} title="Seus dados" text="Todos os dados exibidos são necessários para revisar o agendamento." /><form onSubmit={onSubmit} className="space-y-4"><label className="block text-sm font-black">Nome completo *<input required minLength={2} value={patient.name} onChange={event => onChange({ name: event.target.value })} className={inputClass} autoComplete="name" aria-invalid={Boolean(errors.name)} /><PublicFieldError message={errors.name} /></label><label className="block text-sm font-black">Data de nascimento *<input required type="date" max={referenceDate} value={patient.dateOfBirth} onChange={event => onChange({ dateOfBirth: event.target.value })} className={inputClass} aria-invalid={Boolean(errors.dateOfBirth)} /><PublicFieldError message={errors.dateOfBirth} /></label><label className="block text-sm font-black">Telefone *<input required minLength={8} value={patient.phone} onChange={event => onChange({ phone: event.target.value })} className={inputClass} autoComplete="tel" aria-invalid={Boolean(errors.phone)} /><PublicFieldError message={errors.phone} /></label><label className="block text-sm font-black">E-mail *<input required type="email" value={patient.email} onChange={event => onChange({ email: event.target.value })} className={inputClass} autoComplete="email" aria-invalid={Boolean(errors.email)} /><PublicFieldError message={errors.email} /></label>{showResponsible && <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4" data-testid="public-booking-responsible"><div><p className="text-sm font-black text-amber-950">Dados do responsável</p><p className="mt-1 text-xs font-semibold text-amber-900">A idade na data do atendimento exige o preenchimento dos quatro campos.</p></div><label className="block text-sm font-black text-slate-900">Nome completo do responsável *<input required value={patient.administrativeResponsible.fullName} onChange={event => onResponsibleChange({ fullName: event.target.value })} className={inputClass} autoComplete="name" /><PublicFieldError message={errors['administrativeResponsible.fullName']} /></label><label className="block text-sm font-black text-slate-900">Vínculo / parentesco *<input required value={patient.administrativeResponsible.relationship} onChange={event => onResponsibleChange({ relationship: event.target.value })} className={inputClass} /><PublicFieldError message={errors['administrativeResponsible.relationship']} /></label><label className="block text-sm font-black text-slate-900">Telefone do responsável *<input required minLength={8} value={patient.administrativeResponsible.phone} onChange={event => onResponsibleChange({ phone: event.target.value })} className={inputClass} autoComplete="tel" /><PublicFieldError message={errors['administrativeResponsible.phone']} /></label><label className="block text-sm font-black text-slate-900">E-mail do responsável *<input required type="email" value={patient.administrativeResponsible.email} onChange={event => onResponsibleChange({ email: event.target.value })} className={inputClass} autoComplete="email" /><PublicFieldError message={errors['administrativeResponsible.email']} /></label></div>}{errors.form && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{errors.form}</p>}<button type="submit" className={`${buttonClass} w-full`}>Revisar agendamento <ArrowRight size={17} /></button></form></section>;
}

function PublicBookingReview({ settings, service, modality, selectedSlot, selectedLocation, patient, patientRequiresResponsible, onBack, onSubmit, saving }: { settings: PublicBookingSettings; service: PublicBookingService; modality: PublicBookingModality; selectedSlot: PublicBookingSlot; selectedLocation?: PublicBookingLocation; patient: PublicPatientDraft; patientRequiresResponsible: boolean; onBack: () => void; onSubmit: () => void; saving: boolean }) {
  const rows = [
    ['Profissional', settings.professionalName],
    ['Serviço', service.name],
    ['Quando', `${dateLabel(selectedSlot.date)} · ${selectedSlot.time}`],
    ['Tipo de atendimento', modality === 'ONLINE' ? 'Online' : 'Presencial'],
    ['Paciente', patient.name],
    ['Data de nascimento', patient.dateOfBirth.split('-').reverse().join('/')],
  ];

  return (
    <section className={cardClass}>
      <button type="button" onClick={onBack} className="mb-5 text-sm font-black text-violet-700">
        <ArrowLeft size={15} className="mr-1 inline" /> Editar dados
      </button>
      <StepHeader step={modality === 'ONLINE' ? 6 : 7} title="Revise antes de confirmar" text="Confira os dados administrativos e os detalhes do seu agendamento." />
      <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50">
        {rows.slice(0, 4).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 p-4">
            <dt className="text-sm font-semibold text-slate-500">{label}</dt>
            <dd className="text-right text-sm font-black">{value}</dd>
          </div>
        ))}
        {modality === 'PRESENCIAL' && selectedLocation && (
          <>
            <div className="flex justify-between gap-4 p-4">
              <dt className="text-sm font-semibold text-slate-500">Local</dt>
              <dd className="text-right text-sm font-black">{selectedLocation.displayName}</dd>
            </div>
            {selectedLocation.fullAddress && (
              <div className="flex justify-between gap-4 p-4">
                <dt className="text-sm font-semibold text-slate-500">Endereço</dt>
                <dd className="whitespace-pre-line text-right text-sm font-black">{selectedLocation.fullAddress}</dd>
              </div>
            )}
            {selectedLocation.googleMapsUrl && (
              <div className="flex justify-between gap-4 p-4">
                <dt className="text-sm font-semibold text-slate-500">Como chegar</dt>
                <dd className="text-right text-sm font-black"><a href={selectedLocation.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">Abrir no Google Maps</a></dd>
              </div>
            )}
          </>
        )}
        {rows.slice(4).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 p-4">
            <dt className="text-sm font-semibold text-slate-500">{label}</dt>
            <dd className="text-right text-sm font-black">{value}</dd>
          </div>
        ))}
        {patientRequiresResponsible && (
          <>
            {[
              ['Responsável', patient.administrativeResponsible.fullName],
              ['Vínculo', patient.administrativeResponsible.relationship],
              ['Telefone do responsável', patient.administrativeResponsible.phone],
              ['E-mail do responsável', patient.administrativeResponsible.email],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 p-4">
                <dt className="text-sm font-semibold text-slate-500">{label}</dt>
                <dd className="text-right text-sm font-black">{value}</dd>
              </div>
            ))}
          </>
        )}
      </dl>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onBack} className={`${quietButtonClass} flex-1`}>Voltar</button>
        <button type="button" onClick={onSubmit} disabled={saving} className={`${buttonClass} flex-1`}>{saving ? 'Confirmando…' : 'Confirmar agendamento'}</button>
      </div>
    </section>
  );
}

export default function PublicBookingPage({ professionalSlug }: { professionalSlug: string }) {
  const repository = useMemo(() => createPublicBookingApiClient(), []);
  const [settings, setSettings] = useState<PublicBookingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [service, setService] = useState<PublicBookingService | null>(null);
  const [modality, setModality] = useState<PublicBookingModality | null>(null);
  const [locationId, setLocationId] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<PublicBookingSlot | null>(null);
  const [slots, setSlots] = useState<PublicBookingSlot[]>([]);
  const [patient, setPatient] = useState({ name: '', dateOfBirth: '', phone: '', email: '', administrativeResponsible: { fullName: '', relationship: '', phone: '', email: '' } });
  const [patientErrors, setPatientErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<PublicBookingResult | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [datesLoading, setDatesLoading] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  useEffect(() => {
    let active = true;
    void repository.getSettings(professionalSlug).then(value => { if (active) { setSettings(value); setLoading(false); } });
    document.title = 'Agendar consulta · Gestão Clínica';
    const robots = document.querySelector('meta[name="robots"]') || document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex,nofollow');
    if (!robots.parentElement) document.head.appendChild(robots);
    return () => { active = false; };
  }, [professionalSlug, repository]);

  useEffect(() => {
    if (!settings || !service || !modality || !selectedDate) return;
    void repository.listPublishedSlots({ professionalSlug, serviceId: service.id, modality, locationId, fromDate: selectedDate, throughDate: selectedDate }).then(setSlots).catch(() => setSlots([]));
  }, [locationId, modality, professionalSlug, repository, selectedDate, service, settings]);

  useEffect(() => {
    if (!settings || !service || !modality || (modality === 'PRESENCIAL' && !locationId)) { setDates([]); setDatesLoading(false); return; }
    let active = true;
    const fromDate = formatDateKey(new Date());
    const throughDate = addDaysToDateKey(fromDate, settings.maxAdvanceDays);
    setDatesLoading(true);
    void repository.listPublishedSlots({ professionalSlug, serviceId: service.id, modality, locationId, fromDate, throughDate })
      .then(slotsInRange => { if (active) setDates([...new Set(slotsInRange.map(slot => slot.date))]); })
      .catch(() => { if (active) setDates([]); })
      .finally(() => { if (active) setDatesLoading(false); });
    return () => { active = false; };
  }, [locationId, modality, professionalSlug, repository, service, settings]);

  useEffect(() => {
    if (!dates.length) return;
    const firstAvailableDate = [...dates].sort()[0];
    if (!firstAvailableDate) return;
    const parsed = new Date(`${firstAvailableDate}T12:00:00`);
    setCalendarMonth(current => current.getFullYear() === parsed.getFullYear() && current.getMonth() === parsed.getMonth() ? current : new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  }, [dates]);

  const activeServices = [...(settings?.publishedServices.filter(item => item.active) || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeModalities = settings?.publishedModalities.filter(item => item.active && (!service || serviceAllowsModality(service, item.id))) || [];
  const activeLocations = [...(settings?.locations.filter(item => item.active) || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedLocation = activeLocations.find(item => item.id === locationId);
  const progressMap = modality === 'ONLINE' ? { 1: 1, 2: 2, 5: 3, 6: 4, 7: 5, 8: 6 } : { 1: 1, 2: 2, 3: 3, 5: 4, 6: 5, 7: 6, 8: 7 };
  const progressStep = progressMap[step as keyof typeof progressMap] || 1;
  const totalSteps = modality === 'ONLINE' ? 6 : 7;
  const patientReferenceDate = selectedSlot?.date || civilDateFromDate(new Date());
  const patientRequiresResponsible = requiresResponsible(patient.dateOfBirth, patientReferenceDate);
  const patientValidation = useMemo(() => validatePsychologyPatientAdministrativeInput(patient, patientReferenceDate), [patient, patientReferenceDate]);
  const resetFrom = (nextStep: number) => { setError(''); setPatientErrors({}); setStep(nextStep); };
  const selectDate = (date: string) => { setSelectedDate(date); setSelectedSlot(null); setSlots([]); setError(''); setStep(6); };

  const completeBooking = async () => {
    if (!settings || !service || !modality || !selectedSlot) return;
    setSaving(true); setError('');
    const request: PublicBookingRequest = { professionalSlug, serviceId: service.id, modality, locationId, date: selectedSlot.date, time: selectedSlot.time, name: patient.name, dateOfBirth: patient.dateOfBirth, phone: patient.phone, email: patient.email, administrativeResponsible: patientRequiresResponsible ? patient.administrativeResponsible : undefined, source: new URLSearchParams(window.location.search).get('source') || 'site' };
    const result = await repository.createBooking(request);
    setSaving(false);
    if ('conflict' in result) { setError(result.message); setStep(7); return; }
    setSuccess(result);
  };

  if (settings && step === 7 && selectedSlot) return <PublicBookingShell settings={settings}><div className="mb-5"><button type="button" onClick={() => resetFrom(6)} className="text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Trocar horário</button></div><PublicPatientStep patient={patient} errors={patientErrors} progressStep={progressStep} referenceDate={patientReferenceDate} onChange={patch => { setPatient(current => ({ ...current, ...patch })); setPatientErrors(current => ({ ...current, ...Object.keys(patch).reduce<Record<string, string>>((next, key) => ({ ...next, [key]: '' }), {}) })); }} onResponsibleChange={patch => { setPatient(current => ({ ...current, administrativeResponsible: { ...current.administrativeResponsible, ...patch } })); setPatientErrors(current => ({ ...current, ...Object.keys(patch).reduce<Record<string, string>>((next, key) => ({ ...next, [`administrativeResponsible.${key}`]: '' }), {}) })); }} onSubmit={event => { event.preventDefault(); setPatientErrors(patientValidation); if (Object.keys(patientValidation).length > 0) { setPatientErrors(current => ({ ...current, form: 'Revise os campos destacados para continuar.' })); return; } setError(''); setStep(8); }} /></PublicBookingShell>;
  if (settings && step === 8 && selectedSlot && service && modality) return <PublicBookingShell settings={settings}><PublicBookingReview settings={settings} service={service} modality={modality} selectedSlot={selectedSlot} selectedLocation={selectedLocation} patient={patient} patientRequiresResponsible={patientRequiresResponsible} onBack={() => resetFrom(7)} onSubmit={() => void completeBooking()} saving={saving} /></PublicBookingShell>;

  const chooseModality = (next: PublicBookingModality) => {
    setModality(next);
    setLocationId(next === 'PRESENCIAL' ? activeLocations[0]?.id : undefined);
    setSelectedDate('');
    setSelectedSlot(null);
    resetFrom(next === 'PRESENCIAL' && activeLocations.length ? 3 : 5);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings || !service || !modality || !selectedSlot) return;
    setSaving(true); setError('');
    const request: PublicBookingRequest = { professionalSlug, serviceId: service.id, modality, locationId, date: selectedSlot.date, time: selectedSlot.time, name: patient.name, dateOfBirth: patient.dateOfBirth, phone: patient.phone, email: patient.email, administrativeResponsible: patientRequiresResponsible ? patient.administrativeResponsible : undefined, source: new URLSearchParams(window.location.search).get('source') || 'site' };
    const result = await repository.createBooking(request);
    setSaving(false);
    if ('conflict' in result) { setError(result.message); setStep(5); return; }
    setSuccess(result);
  };

  if (loading) return <PublicBookingShell><div className={cardClass}><div className="animate-pulse space-y-4"><div className="h-6 w-2/3 rounded bg-slate-200" /><div className="h-4 w-full rounded bg-slate-100" /><div className="h-24 rounded-2xl bg-slate-100" /></div></div></PublicBookingShell>;
  if (!settings || !settings.active) return <PublicBookingShell><div className={cardClass}><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Agendamento online</p><h2 className="mt-2 text-2xl font-black">Página não disponível</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Este endereço não está publicado ou foi desativado.</p></div></PublicBookingShell>;
  if (success) { const confirmedLocation = success.appointment.modality === 'PRESENCIAL' ? activeLocations.find(item => item.id === success.appointment.locationId) : undefined; return <PublicBookingShell settings={settings}><div className={`${cardClass} text-center`} data-testid="public-booking-success"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={32} /></div><h2 className="mt-5 text-2xl font-black">Agendamento confirmado</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Sua consulta com {settings.professionalName} foi registrada no ambiente local.</p><div className="mt-5 rounded-2xl bg-slate-50 p-4 text-left"><p className="font-black">{success.appointment.date.split('-').reverse().join('/')} · {success.appointment.time}</p><p className="mt-1 text-sm font-semibold text-slate-600">{service?.name} · {modality === 'ONLINE' ? 'Online' : locationLabel(confirmedLocation)}</p></div>{confirmedLocation && <PublicBookingLocationDetails location={confirmedLocation} />}<a href={success.managementUrl} className={`${buttonClass} mt-5 w-full`} data-testid="manage-appointment-link">Gerenciar minha consulta <ArrowRight size={17} /></a><p className="mt-3 text-xs font-semibold text-slate-500">Guarde este link para confirmar, cancelar ou reagendar sua consulta.</p></div></PublicBookingShell>; }
  if ((step === 4 || step === 5)) return <PublicBookingShell settings={settings}><div className="mb-4 flex items-center gap-1" aria-label={`Etapa ${progressStep} de ${totalSteps}`}>{Array.from({ length: totalSteps }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index + 1 <= progressStep ? 'bg-violet-700' : 'bg-violet-100'}`} />)}</div><DateSelectionStep progressStep={progressStep} totalSteps={totalSteps} dates={dates} datesLoading={datesLoading} selectedDate={selectedDate} calendarMonth={calendarMonth} onMonthChange={setCalendarMonth} onSelectDate={selectDate} onBack={() => resetFrom(modality === 'PRESENCIAL' ? 3 : 2)} /></PublicBookingShell>;

  return <PublicBookingShell settings={settings}><div className="mb-4 flex items-center gap-1" aria-label={`Etapa ${progressStep} de ${totalSteps}`}>{Array.from({ length: totalSteps }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index + 1 <= progressStep ? 'bg-violet-700' : 'bg-violet-100'}`} />)}</div>{step === 1 && <section className={cardClass}><StepHeader step={1} title={`Olá, sou ${settings.professionalName}`} text="Escolha um serviço publicado para começar seu agendamento." /><label className="block text-sm font-black text-slate-900">Escolha o Atendimento<select aria-label="Escolha o Atendimento" value={service?.id || ''} onChange={event => { const next = activeServices.find(item => item.id === event.target.value) || null; setService(next); setModality(null); setLocationId(undefined); setSelectedDate(''); setSelectedSlot(null); resetFrom(next ? 2 : 1); }} className={inputClass}><option value="">Selecione o atendimento</option>{activeServices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>}
    {step === 2 && <section className={cardClass}><button type="button" onClick={() => resetFrom(1)} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Voltar</button><StepHeader step={2} title="Como você prefere?" text="Selecione a modalidade disponível para este serviço." /><div className="space-y-3">{activeModalities.map(item => <ChoiceCard key={item.id} selected={modality === item.id} title={item.label} text={item.id === 'ONLINE' ? 'Atendimento por videochamada' : 'Atendimento em local publicado'} icon={item.id === 'ONLINE' ? <Video size={19} /> : <MapPin size={19} />} onClick={() => chooseModality(item.id)} />)}</div></section>}
    {step === 3 && <section className={cardClass}><button type="button" onClick={() => resetFrom(2)} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Voltar</button><StepHeader step={3} title="Escolha o local" text="Selecione onde deseja ser atendido presencialmente." /><div className="space-y-3">{activeLocations.map(item => <ChoiceCard key={item.id} selected={locationId === item.id} title={item.displayName || item.name || 'Local presencial'} text={[item.fullAddress, item.city && item.state ? `${item.city} / ${item.state}` : item.city || item.state].filter(Boolean).join(' · ') || 'Endereço a ser informado pelo profissional'} icon={<MapPin size={19} />} onClick={() => { setLocationId(item.id); resetFrom(5); }} />)}</div></section>}
    {step === 6 && <section className={cardClass}><button type="button" onClick={() => resetFrom(5)} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Trocar dia</button><p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500">Etapa {progressStep} de {totalSteps}</p><StepHeader step={progressStep} title="Escolha uma data" text="Selecione um dia disponível para ver os horários." /><MonthlyCalendar dates={dates} selectedDate={selectedDate} month={calendarMonth} onMonthChange={setCalendarMonth} onSelectDate={selectDate} /><div className="mt-5" data-testid="public-booking-time-slots"><h3 className="text-lg font-black text-slate-950">Horários disponíveis</h3><p className="mt-1 mb-4 text-sm leading-relaxed text-slate-600">{selectedDate ? `Horários em ${longDateLabel(selectedDate)}.` : 'Escolha um dia para continuar.'}</p>{error && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}{slots.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{slots.map(slot => <button type="button" key={`${slot.date}-${slot.time}`} onClick={() => { setSelectedSlot(slot); setError(''); resetFrom(7); }} className={`min-h-14 rounded-2xl border p-3 text-left transition ${selectedSlot?.time === slot.time ? 'border-violet-600 bg-violet-50' : 'border-slate-200 bg-white hover:border-violet-300'}`}><span className="block text-lg font-black">{slot.time}</span><span className="text-xs font-semibold text-slate-500">até {slot.endTime}</span></button>)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"><CalendarDays className="mx-auto text-slate-400" size={24} /><p className="mt-2 font-black">Nenhum horário disponível neste dia</p><p className="mt-1 text-sm text-slate-500">Escolha outra data publicada.</p></div>}</div></section>}
    {step === 7 && <section className={cardClass}><button type="button" onClick={() => resetFrom(6)} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Trocar horário</button><StepHeader step={progressStep} title="Seus dados" text="Informe apenas o necessário para confirmar o agendamento." /><form onSubmit={event => { event.preventDefault(); setError(''); setStep(8); }} className="space-y-4"><label className="block text-sm font-black">Nome completo<input required minLength={2} value={patient.name} onChange={event => setPatient({ ...patient, name: event.target.value })} className={inputClass} autoComplete="name" /></label><label className="block text-sm font-black">Telefone<input required minLength={8} value={patient.phone} onChange={event => setPatient({ ...patient, phone: event.target.value })} className={inputClass} autoComplete="tel" /></label><label className="block text-sm font-black">E-mail<input required type="email" value={patient.email} onChange={event => setPatient({ ...patient, email: event.target.value })} className={inputClass} autoComplete="email" /></label>{error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}<button type="submit" disabled={!selectedSlot} className={`${buttonClass} w-full`}>Revisar agendamento <ArrowRight size={17} /></button></form></section>}
    {step === 8 && selectedSlot && service && modality && <section className={cardClass}><button type="button" onClick={() => resetFrom(7)} className="mb-5 text-sm font-black text-violet-700"><ArrowLeft size={15} className="mr-1 inline" /> Editar dados</button><StepHeader step={progressStep} title="Revise antes de confirmar" text="Confira os detalhes do seu agendamento." /><dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50"><div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Profissional</dt><dd className="text-right text-sm font-black">{settings.professionalName}</dd></div><div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Serviço</dt><dd className="text-right text-sm font-black">{service.name}</dd></div><div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Quando</dt><dd className="text-right text-sm font-black">{dateLabel(selectedSlot.date)} · {selectedSlot.time}</dd></div><div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Tipo de atendimento</dt><dd className="text-right text-sm font-black">{modality === 'ONLINE' ? 'Online' : 'Presencial'}</dd></div>{modality === 'PRESENCIAL' && selectedLocation && <><div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Local</dt><dd className="text-right text-sm font-black">{selectedLocation.displayName}</dd></div>{selectedLocation.fullAddress && <div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Endereço</dt><dd className="whitespace-pre-line text-right text-sm font-black">{selectedLocation.fullAddress}</dd></div>}{selectedLocation.googleMapsUrl && <div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Como chegar</dt><dd className="text-right text-sm font-black"><a href={selectedLocation.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">Abrir no Google Maps</a></dd></div>}</>}<div className="flex justify-between gap-4 p-4"><dt className="text-sm font-semibold text-slate-500">Paciente</dt><dd className="text-right text-sm font-black">{patient.name}</dd></div></dl><div className="mt-5 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={() => resetFrom(7)} className={`${quietButtonClass} flex-1`}>Voltar</button><button type="button" onClick={() => void submit({ preventDefault: () => undefined } as React.FormEvent)} disabled={saving} className={`${buttonClass} flex-1`}>{saving ? 'Confirmando…' : 'Confirmar agendamento'}</button></div></section>}</PublicBookingShell>;
}
