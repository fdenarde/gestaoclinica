import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, MapPin, MessageCircle, XCircle } from 'lucide-react';
import { createPublicBookingApiClient } from './publicApiClient';
import PublicBookingLocationDetails from './PublicBookingLocationDetails';
import type { PublicAppointmentSummary, PublicBookingSettings } from './types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const buttonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const quietButtonClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50';

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

function ManagementShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.title = 'Gerenciar consulta · Gestão Clínica';
    const robots = document.querySelector('meta[name="robots"]') || document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex,nofollow');
    if (!robots.parentElement) document.head.appendChild(robots);
    const referrer = document.querySelector('meta[name="referrer"]') || document.createElement('meta');
    referrer.setAttribute('name', 'referrer');
    referrer.setAttribute('content', 'no-referrer');
    if (!referrer.parentElement) document.head.appendChild(referrer);
  }, []);
  return <div className="min-h-screen bg-[linear-gradient(145deg,#f8f7ff_0%,#f8fafc_58%,#eefcf8_100%)] px-4 py-5 text-slate-900 sm:px-6 sm:py-8"><div className="mx-auto w-full max-w-2xl"><header className="mb-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">Gestão Clínica</p><h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Gerenciar minha consulta</h1></header>{children}<footer className="mt-6 text-center text-xs font-semibold text-slate-500">Este link é privado e não exibe dados clínicos ou financeiros.</footer></div></div>;
}

export default function AppointmentManagementPage({ managementToken }: { managementToken: string }) {
  const repository = useMemo(() => createPublicBookingApiClient(), []);
  const [summary, setSummary] = useState<PublicAppointmentSummary | null>(null);
  const [settings, setSettings] = useState<PublicBookingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getAppointmentByManagementToken(managementToken), repository.getSettings()]).then(([nextSummary, nextSettings]) => { if (active) { setSummary(nextSummary); setSettings(nextSettings); setLoading(false); } });
    return () => { active = false; };
  }, [managementToken, repository]);

  const runAction = async (action: 'confirm' | 'cancel') => {
    setSaving(true); setActionError(''); setActionMessage('');
    const result = action === 'confirm' ? await repository.confirmByManagementToken(managementToken) : await repository.cancelByManagementToken(managementToken);
    setSaving(false);
    if (!result.ok) { setActionError(result.message); return; }
    setSummary(result.summary);
    setActionMessage(action === 'confirm' ? 'Consulta confirmada.' : 'Consulta cancelada. O horário foi liberado.');
  };

  const requestReschedule = async () => {
    setSaving(true); setActionError(''); setActionMessage('');
    const result = await repository.requestRescheduleByManagementToken(managementToken);
    setSaving(false);
    if (!result.ok) { setActionError(result.message); return; }
    setSummary(result.summary);
    setActionMessage('Solicitação preparada. O WhatsApp foi aberto; toque manualmente em Enviar para encaminhar a mensagem.');
    window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  if (loading) return <ManagementShell><div className={cardClass}><div className="animate-pulse space-y-4"><div className="h-6 w-2/3 rounded bg-slate-200" /><div className="h-24 rounded-2xl bg-slate-100" /></div></div></ManagementShell>;
  if (!summary || !settings) return <ManagementShell><div className={`${cardClass} text-center`} data-testid="management-invalid"><XCircle className="mx-auto text-rose-600" size={34} /><h2 className="mt-4 text-2xl font-black">Link indisponível</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Não foi possível localizar esta consulta. O link pode ter expirado ou sido revogado.</p></div></ManagementShell>;

  const cancelled = summary.appointmentStatus === 'CANCELLED_BY_PATIENT';
  const confirmed = summary.patientConfirmationStatus === 'CONFIRMED';
  const managementLocation = summary.modality === 'PRESENCIAL' && summary.locationName ? { displayName: summary.locationName, fullAddress: summary.locationAddress || '', googleMapsUrl: summary.googleMapsUrl || '' } : undefined;
  return <ManagementShell><section className={cardClass} data-testid="appointment-management"><div className="flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700"><CalendarDays size={22} /></div><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">{summary.clinicDisplayName}</p><h2 className="mt-1 text-2xl font-black">Sua consulta</h2><p className="mt-1 text-sm font-semibold text-slate-600">com {summary.professionalName}</p></div></div><div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50"><div className="flex items-center gap-3 p-4"><CalendarDays size={18} className="text-violet-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Data</p><p className="mt-1 font-black capitalize">{dateLabel(summary.date)}</p></div></div><div className="flex items-center gap-3 p-4"><Clock3 size={18} className="text-violet-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Horário</p><p className="mt-1 font-black">{summary.time} – {summary.endTime}</p></div></div><div className="flex items-center gap-3 p-4">{summary.modality === 'ONLINE' ? <CheckCircle2 size={18} className="text-violet-700" /> : <MapPin size={18} className="text-violet-700" />}<div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tipo de atendimento</p><p className="mt-1 font-black">{summary.modality === 'ONLINE' ? 'Online' : 'Presencial'}</p></div></div>{managementLocation && <PublicBookingLocationDetails location={managementLocation} />}{summary.serviceName && <div className="flex items-center gap-3 p-4"><CheckCircle2 size={18} className="text-violet-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Serviço</p><p className="mt-1 font-black text-slate-900">{summary.serviceName}</p></div></div>}</div>{actionMessage && <p role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{actionMessage}</p>}{actionError && <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{actionError}</p>}{cancelled ? <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-100 p-4 text-sm font-bold text-slate-600">Esta consulta foi cancelada. Nenhuma ação adicional está disponível.</div> : <div className="mt-5 grid gap-3 sm:grid-cols-3"><button type="button" disabled={confirmed || saving} onClick={() => void runAction('confirm')} className={buttonClass}><CheckCircle2 size={17} /> {confirmed ? 'Confirmada' : saving ? 'Salvando…' : 'Confirmar'}</button><button type="button" disabled={saving} onClick={() => void requestReschedule()} className={quietButtonClass}><MessageCircle size={17} /> Solicitar reagendamento</button><button type="button" disabled={saving} onClick={() => void runAction('cancel')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-100"><XCircle size={17} /> Cancelar</button></div>}</section><a href={`/agendar/${settings.professionalSlug}`} className="mt-4 inline-flex items-center text-sm font-black text-violet-700"><ArrowLeft size={16} className="mr-1 inline" /> Voltar para agendamento</a></ManagementShell>;
}
