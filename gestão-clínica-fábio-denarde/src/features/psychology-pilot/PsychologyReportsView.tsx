import { useMemo, useState } from 'react';
import { BarChart3, CalendarRange, CheckCircle2, Clock3, Download, FileSpreadsheet, FileText, Filter, UsersRound, WalletCards } from 'lucide-react';
import type { PsychologyStore } from './psychologyDomain';
import {
  createPsychologyReportFilter,
  formatPsychologyReportDate,
  formatPsychologyReportDateTime,
  formatPsychologyReportMoney,
  getPsychologyReport,
  psychologyReportChargeStatusLabels,
  psychologyReportPaymentMethodLabels,
  type PsychologyAgendaReport,
  type PsychologyFinanceReport,
  type PsychologyPatientStatusFilter,
  type PsychologyPatientsReport,
  type PsychologyReport,
  type PsychologyReportFilter,
  type PsychologyReportKind,
  type PsychologySessionsReport,
} from './psychologyReports';
import { createPsychologyPeriod } from './psychologyFinancialLedger';
import { downloadPsychologyReportCsv, downloadPsychologyReportPdf, type PsychologyFinanceExportView, type PsychologyReportExportPayload } from './psychologyReportExports';
import { createPsychologyPersistenceScope, resolvePsychologyRuntimeIdentity } from '../psychology-persistence';
import { formatPhoneDisplay } from '../../../shared/phoneNormalization.js';

const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100';

function reportPhoneLabel(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  try {
    return formatPhoneDisplay(raw);
  } catch {
    return raw;
  }
}

const reportOptions: Array<{ id: PsychologyReportKind; label: string; description: string; icon: typeof FileText }> = [
  { id: 'sessions', label: 'Atendimentos e status', description: 'Compare sessões realizadas, faltas e cancelamentos.', icon: CheckCircle2 },
  { id: 'finance', label: 'Financeiro', description: 'Visualize caixa, cobranças, pagamentos e despesas.', icon: WalletCards },
  { id: 'agenda', label: 'Agenda e ocupação', description: 'Entenda o uso dos horários configurados.', icon: CalendarRange },
  { id: 'patients', label: 'Pacientes e status', description: 'Acompanhe a carteira administrativa de pacientes.', icon: UsersRound },
];

function formatRate(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1).replace('.', ',')}%`;
}

function periodLabel(filter: PsychologyReportFilter): string {
  return `${formatPsychologyReportDate(filter.period.startDate)} a ${formatPsychologyReportDate(filter.period.endDate)}`;
}

function filterLabel(filter: PsychologyReportFilter, store: PsychologyStore): string {
  const labels = [`Período: ${periodLabel(filter)}`];
  if (filter.patientId && filter.patientId !== 'all') labels.push(`Paciente: ${store.patients.find(item => item.id === filter.patientId)?.name || 'selecionado'}`);
  if (filter.sessionStatus && filter.sessionStatus !== 'all') labels.push(`Status: ${filter.sessionStatus}`);
  if (filter.modality && filter.modality !== 'all') labels.push(`Modalidade: ${filter.modality === 'online' ? 'Online' : 'Presencial'}`);
  if (filter.locationId && filter.locationId !== 'all') labels.push(`Local: ${store.locations.find(item => item.id === filter.locationId)?.displayName || 'selecionado'}`);
  if (filter.serviceId && filter.serviceId !== 'all') labels.push(`Serviço: ${store.services.find(item => item.id === filter.serviceId)?.name || 'selecionado'}`);
  if (filter.patientStatus && filter.patientStatus !== 'all') labels.push(`Carteira: ${filter.patientStatus}`);
  return labels.join(' · ');
}

function exportPayload(store: PsychologyStore, kind: PsychologyReportKind, report: PsychologyReport, filter: PsychologyReportFilter, financeView: PsychologyFinanceExportView): PsychologyReportExportPayload {
  const identity = resolvePsychologyRuntimeIdentity({
    scope: createPsychologyPersistenceScope(store.scope.professionalId),
    presentationProfile: store.settings.professionalProfile,
  });
  return {
    kind,
    report,
    store,
    financeView,
    meta: {
      professionalName: identity.profile.displayName,
      specialty: identity.profile.professionalTitle,
      professionalId: store.scope.professionalId,
      crp: identity.profile.professionalRegistration,
      clinicName: identity.profile.clinicDisplayName || undefined,
      periodLabel: periodLabel(filter),
      periodEndDate: filter.period.endDate,
      filtersLabel: filterLabel(filter, store),
    },
  };
}

function StatCard({ label, value, hint, tone = 'slate' }: { label: string; value: string | number; hint?: string; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'violet' }) {
  const tones = { slate: 'border-slate-200 bg-white', emerald: 'border-emerald-200 bg-emerald-50/50', amber: 'border-amber-200 bg-amber-50/50', rose: 'border-rose-200 bg-rose-50/50', violet: 'border-violet-200 bg-violet-50/50' };
  return <article className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}><p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>{hint && <p className="mt-1 text-xs font-bold text-slate-500">{hint}</p>}</article>;
}

function EmptyState({ children }: { children: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500">{children}</div>;
}

function SessionsPreview({ report }: { report: PsychologySessionsReport }) {
  return report.rows.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr>{['Data', 'Horário', 'Paciente', 'Modalidade / Local', 'Serviço', 'Duração', 'Status'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.session.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDate(row.session.date)}</td><td className="px-4 py-3 font-bold">{row.session.time}</td><td className="px-4 py-3 font-black">{row.patientName}</td><td className="px-4 py-3 text-slate-600">{row.modalityLabel} · {row.locationLabel}</td><td className="px-4 py-3 text-slate-600">{row.serviceLabel}</td><td className="px-4 py-3 text-slate-600">{row.session.durationMinutes} min</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{row.statusLabel}</span></td></tr>)}</tbody></table></div> : <EmptyState>Nenhum atendimento encontrado neste período.</EmptyState>;
}

function FinancePreview({ report, store, view, onView }: { report: PsychologyFinanceReport; store: PsychologyStore; view: PsychologyFinanceExportView; onView: (view: PsychologyFinanceExportView) => void }) {
  const tabs: Array<[PsychologyFinanceExportView, string]> = [['summary', 'Resumo'], ['charges', 'Cobranças'], ['payments', 'Pagamentos'], ['expenses', 'Despesas']];
 return <div className="space-y-4"><div className="flex flex-wrap gap-2" role="tablist" aria-label="Visões do relatório financeiro">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => onView(id)} className={`rounded-xl px-3 py-2 text-sm font-black ${view === id ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div>{view === 'summary' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{report.receivedByMethod.map(item => <div key={item.method} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-bold text-slate-500">{item.label}</p><p className="mt-1 font-black text-slate-900">{formatPsychologyReportMoney(item.amount)}</p></div>)}</div>}{view === 'charges' && (report.chargeRows.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr>{['Paciente', 'Descrição', 'Valor', 'Recebido', 'Saldo', 'Vencimento', 'Status'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{report.chargeRows.map(entry => <tr key={entry.charge.id} className="border-t border-slate-100"><td className="px-4 py-3 font-black">{entry.charge.patientId ? store.patients.find(item => item.id === entry.charge.patientId)?.name || 'Paciente' : 'Paciente excluído'}</td><td className="px-4 py-3 text-slate-600">{entry.charge.description}</td><td className="px-4 py-3 font-bold">{formatPsychologyReportMoney(entry.charge.amount)}</td><td className="px-4 py-3 text-emerald-700">{formatPsychologyReportMoney(entry.received)}</td><td className="px-4 py-3 text-amber-700">{formatPsychologyReportMoney(entry.balance)}</td><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDate(entry.charge.dueDate)}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{psychologyReportChargeStatusLabels[entry.status]}</span></td></tr>)}</tbody></table></div> : <EmptyState>Nenhuma movimentação financeira encontrada.</EmptyState>)}{view === 'payments' && (report.paymentRows.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr>{['Data', 'Paciente', 'Cobrança', 'Valor', 'Método', 'Status'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{report.paymentRows.map(payment => <tr key={payment.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDate(payment.date)}</td><td className="px-4 py-3 font-black">{payment.patientId ? store.patients.find(item => item.id === payment.patientId)?.name || 'Paciente' : 'Paciente excluído'}</td><td className="px-4 py-3 text-slate-600">{report.chargeRows.find(entry => entry.charge.id === payment.chargeId)?.charge.description || 'Cobrança vinculada'}</td><td className="px-4 py-3 font-bold text-emerald-700">{formatPsychologyReportMoney(payment.amount)}</td><td className="px-4 py-3">{psychologyReportPaymentMethodLabels[payment.method]}</td><td className="px-4 py-3">{payment.status === 'active' ? 'Ativo' : 'Estornado'}</td></tr>)}</tbody></table></div> : <EmptyState>Nenhum pagamento encontrado neste período.</EmptyState>)}{view === 'expenses' && (report.expenseRows.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr>{['Data', 'Descrição', 'Categoria', 'Valor', 'Status'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{report.expenseRows.map(expense => <tr key={expense.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDate(expense.date)}</td><td className="px-4 py-3 font-black">{expense.description}</td><td className="px-4 py-3 text-slate-600">{expense.category}</td><td className="px-4 py-3 font-bold">{formatPsychologyReportMoney(expense.amount)}</td><td className="px-4 py-3">{expense.status === 'REALIZED' ? 'Realizada' : expense.status === 'PENDING' ? 'Pendente' : 'Estornada'}</td></tr>)}</tbody></table></div> : <EmptyState>Nenhuma despesa encontrada neste período.</EmptyState>)}</div>;
}

function AgendaPreview({ report }: { report: PsychologyAgendaReport }) {
  const distribution = [...report.byDay.map(item => ({ ...item, type: 'Dia' })), ...report.byModality.map(item => ({ ...item, type: 'Modalidade' })), ...report.byLocation.map(item => ({ ...item, type: 'Local' }))];
  return <div className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 text-violet-700" size={18} /><div><p className="font-black">Como a ocupação é calculada</p><p className="mt-1 text-sm text-slate-600">Sessões clínicas que não estão canceladas ocupam o horário. A base disponível usa os dias e horários configurados em Ajustes. Compromissos pessoais e mentoria não são sessões.</p></div></div></div>{distribution.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Dimensão</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Sessões</th><th className="px-4 py-3">Duração</th></tr></thead><tbody>{distribution.map((item, index) => <tr key={`${item.type}-${item.label}-${index}`} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-500">{item.type}</td><td className="px-4 py-3 font-black">{item.label}</td><td className="px-4 py-3">{item.count}</td><td className="px-4 py-3">{(item.minutes / 60).toFixed(2).replace('.', ',')} h</td></tr>)}</tbody></table></div> : <EmptyState>Nenhum atendimento encontrado neste período.</EmptyState>}{!report.availabilityConfigured && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800">Taxa de ocupação: Não disponível com a configuração atual.</p>}</div>;
}

function PatientsPreview({ report: sourceReport }: { report: PsychologyPatientsReport }) {
  const report = { ...sourceReport, rows: sourceReport.rows.map(row => ({ ...row, patient: { ...row.patient, phone: reportPhoneLabel(row.patient.phone) } })) };
  return report.rows.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr>{['Paciente', 'Telefone', 'E-mail', 'Status', 'Última sessão', 'Próxima sessão', 'Modalidade', 'Pacote ativo'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.patient.id} className="border-t border-slate-100"><td className="px-4 py-3 font-black">{row.patient.name}</td><td className="px-4 py-3 text-slate-600">{row.patient.phone || '—'}</td><td className="px-4 py-3 text-slate-600">{row.patient.email || '—'}</td><td className="px-4 py-3">{row.patient.active ? 'Ativo' : 'Inativo'}</td><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDate(row.lastSessionDate)}</td><td className="px-4 py-3 text-slate-600">{formatPsychologyReportDateTime(row.nextSession?.date, row.nextSession?.time)}</td><td className="px-4 py-3">{row.preferredModalityLabel}</td><td className="px-4 py-3">{row.activePackageName || '—'}</td></tr>)}</tbody></table></div> : <EmptyState>Nenhum paciente corresponde aos filtros.</EmptyState>;
}

export default function PsychologyReportsView({ store }: { store: PsychologyStore }) {
  const initialFilter = useMemo(() => createPsychologyReportFilter('month'), []);
  const [kind, setKind] = useState<PsychologyReportKind>('sessions');
  const [filter, setFilter] = useState<PsychologyReportFilter>(initialFilter);
  const [customStart, setCustomStart] = useState(initialFilter.period.startDate);
  const [customEnd, setCustomEnd] = useState(initialFilter.period.endDate);
  const [financeView, setFinanceView] = useState<PsychologyFinanceExportView>('summary');
  const [notice, setNotice] = useState('');
  const report = useMemo(() => getPsychologyReport(store, kind, filter), [filter, kind, store]);
  const activeOption = reportOptions.find(option => option.id === kind) || reportOptions[0];

  const setPreset = (preset: 'week' | 'month' | 'year' | 'custom') => {
    const period = preset === 'custom' ? createPsychologyPeriod('custom', undefined, customStart, customEnd) : createPsychologyPeriod(preset);
    setFilter(current => ({ ...current, period }));
  };

  const resetFilters = () => {
    const next = createPsychologyReportFilter('month');
    setFilter(next);
    setCustomStart(next.period.startDate);
    setCustomEnd(next.period.endDate);
  };

  const payload = () => exportPayload(store, kind, report, filter, financeView);
  const exportPdf = () => { const filename = downloadPsychologyReportPdf(payload()); setNotice(`${filename} gerado localmente.`); };
  const exportCsv = () => { const filename = downloadPsychologyReportCsv(payload()); setNotice(`${filename} gerado localmente.`); };

  return <section className="space-y-5" data-testid="psychology-reports"><div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Relatórios · Psicologia</p><h3 className="mt-1 text-xl font-black text-slate-950">Analise seus atendimentos, agenda, pacientes e movimentação financeira.</h3><p className="mt-2 text-sm text-slate-600">Visões administrativas locais, filtradas pelo profissional e pelo contexto PSICOLOGIA. Nenhum registro clínico é exibido ou exportado.</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={exportPdf} className={secondaryButton}><FileText size={16} /> Exportar PDF</button><button type="button" onClick={exportCsv} className={primaryButton}><FileSpreadsheet size={16} /> Exportar CSV</button></div></div></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{reportOptions.map(option => { const Icon = option.icon; return <button key={option.id} type="button" onClick={() => { setKind(option.id); setNotice(''); }} className={`rounded-2xl border p-4 text-left shadow-sm transition ${kind === option.id ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-slate-50'}`}><div className="flex items-start gap-3"><span className={`rounded-xl p-2 ${kind === option.id ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600'}`}><Icon size={18} /></span><span><strong className="block text-sm font-black text-slate-900">{option.label}</strong><span className="mt-1 block text-xs font-bold leading-relaxed text-slate-500">{option.description}</span></span></div></button>; })}</div>

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Filter size={17} className="text-violet-700" /><div><p className="text-sm font-black">Filtros do relatório</p><p className="text-xs font-bold text-slate-500">{periodLabel(filter)}</p></div></div><button type="button" onClick={resetFilters} className="text-xs font-black text-violet-700 hover:underline">Limpar filtros</button></div><div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Período do relatório">{([['week', 'Esta semana'], ['month', 'Este mês'], ['year', 'Este ano'], ['custom', 'Personalizado']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setPreset(id)} className={`rounded-xl px-3 py-2 text-xs font-black ${filter.period.preset === id ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div>{filter.period.preset === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Data inicial<input type="date" value={customStart} onChange={event => { setCustomStart(event.target.value); setFilter(current => ({ ...current, period: createPsychologyPeriod('custom', undefined, event.target.value, customEnd) })); }} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Data final<input type="date" value={customEnd} onChange={event => { setCustomEnd(event.target.value); setFilter(current => ({ ...current, period: createPsychologyPeriod('custom', undefined, customStart, event.target.value) })); }} className={`${inputClass} mt-1`} /></label></div>}
      {(kind === 'sessions' || kind === 'agenda' || kind === 'finance') && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(kind === 'sessions' || kind === 'agenda' || kind === 'finance') && <label className="text-xs font-bold text-slate-600">Paciente<select value={filter.patientId || 'all'} onChange={event => setFilter(current => ({ ...current, patientId: event.target.value === 'all' ? undefined : event.target.value }))} className={`${inputClass} mt-1`}><option value="all">Todos</option>{store.patients.filter(patient => patient.context === 'PSICOLOGIA' && patient.professionalId === store.scope.professionalId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}{(kind === 'sessions' || kind === 'agenda') && <><label className="text-xs font-bold text-slate-600">Status<select value={filter.sessionStatus || 'all'} onChange={event => setFilter(current => ({ ...current, sessionStatus: event.target.value as PsychologyReportFilter['sessionStatus'] }))} className={`${inputClass} mt-1`}><option value="all">Todos</option><option value="agendada">Agendada</option><option value="realizada">Realizada</option><option value="falta">Falta</option><option value="cancelada">Cancelada</option></select></label><label className="text-xs font-bold text-slate-600">Modalidade<select value={filter.modality || 'all'} onChange={event => setFilter(current => ({ ...current, modality: event.target.value as PsychologyReportFilter['modality'] }))} className={`${inputClass} mt-1`}><option value="all">Todas</option><option value="online">Online</option><option value="presencial">Presencial</option></select></label><label className="text-xs font-bold text-slate-600">Local<select value={filter.locationId || 'all'} onChange={event => setFilter(current => ({ ...current, locationId: event.target.value === 'all' ? undefined : event.target.value }))} className={`${inputClass} mt-1`}><option value="all">Todos</option>{store.locations.filter(location => location.context === 'PSICOLOGIA' && location.professionalId === store.scope.professionalId).map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Serviço<select value={filter.serviceId || 'all'} onChange={event => setFilter(current => ({ ...current, serviceId: event.target.value === 'all' ? undefined : event.target.value }))} className={`${inputClass} mt-1`}><option value="all">Todos</option>{store.services.filter(service => service.context === 'PSICOLOGIA' && service.professionalId === store.scope.professionalId).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label></>}</div>}
      {kind === 'patients' && <div className="mt-3 max-w-sm"><label className="text-xs font-bold text-slate-600">Carteira<select value={filter.patientStatus || 'all'} onChange={event => setFilter(current => ({ ...current, patientStatus: event.target.value as PsychologyPatientStatusFilter }))} className={`${inputClass} mt-1`}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="with-next">Com próxima sessão</option><option value="without-next">Sem próxima sessão</option><option value="with-package">Com pacote</option><option value="without-package">Sem pacote</option></select></label></div>}</section>

    {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" role="status">{notice}</p>}
    <section className="space-y-4" data-testid={`psychology-report-${kind}`}><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-black uppercase tracking-[0.15em] text-violet-700">Prévia administrativa</p><h4 className="mt-1 text-xl font-black">{activeOption.label}</h4><p className="mt-1 text-sm text-slate-500">{filterLabel(filter, store)}</p></div><div className="flex gap-2"><button type="button" onClick={exportPdf} className={secondaryButton}><Download size={15} /> PDF</button><button type="button" onClick={exportCsv} className={primaryButton}><Download size={15} /> CSV</button></div></div>
      {kind === 'sessions' && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><StatCard label="Total de sessões" value={(report as PsychologySessionsReport).total} /><StatCard label="Realizadas" value={(report as PsychologySessionsReport).realized} tone="emerald" /><StatCard label="Agendadas" value={(report as PsychologySessionsReport).scheduled} tone="amber" /><StatCard label="Faltas" value={(report as PsychologySessionsReport).absences} tone="rose" /><StatCard label="Canceladas" value={(report as PsychologySessionsReport).cancelled} /><StatCard label="Comparecimento" value={formatRate((report as PsychologySessionsReport).attendanceRate)} hint="Realizadas ÷ (realizadas + faltas)" tone="violet" /></div><SessionsPreview report={report as PsychologySessionsReport} /></>}
      {kind === 'finance' && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><StatCard label="Recebido no período" value={formatPsychologyReportMoney((report as PsychologyFinanceReport).overview.received)} tone="emerald" /><StatCard label="A receber" value={formatPsychologyReportMoney((report as PsychologyFinanceReport).overview.receivable)} tone="amber" /><StatCard label="Vencido" value={formatPsychologyReportMoney((report as PsychologyFinanceReport).overview.overdue)} hint="Subconjunto de a receber" tone="rose" /><StatCard label="Despesas realizadas" value={formatPsychologyReportMoney((report as PsychologyFinanceReport).overview.expenses)} /><StatCard label="Saldo realizado" value={formatPsychologyReportMoney((report as PsychologyFinanceReport).overview.balance)} tone="violet" /></div><FinancePreview report={report as PsychologyFinanceReport} store={store} view={financeView} onView={setFinanceView} /></>}
      {kind === 'agenda' && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><StatCard label="Sessões agendadas" value={(report as PsychologyAgendaReport).scheduledSessions} /><StatCard label="Horas agendadas" value={`${((report as PsychologyAgendaReport).scheduledMinutes / 60).toFixed(2).replace('.', ',')} h`} tone="violet" /><StatCard label="Horas realizadas" value={`${((report as PsychologyAgendaReport).realizedMinutes / 60).toFixed(2).replace('.', ',')} h`} tone="emerald" /><StatCard label="Horas disponíveis" value={(report as PsychologyAgendaReport).availableMinutes === null ? '—' : `${((report as PsychologyAgendaReport).availableMinutes / 60).toFixed(2).replace('.', ',')} h`} /><StatCard label="Taxa de ocupação" value={formatRate((report as PsychologyAgendaReport).occupancyRate)} hint={(report as PsychologyAgendaReport).availabilityConfigured ? 'Baseada na configuração da agenda' : 'Não disponível com a configuração atual'} tone="amber" /></div><AgendaPreview report={report as PsychologyAgendaReport} /></>}
      {kind === 'patients' && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><StatCard label="Pacientes ativos" value={(report as PsychologyPatientsReport).active} tone="emerald" /><StatCard label="Pacientes inativos" value={(report as PsychologyPatientsReport).inactive} /><StatCard label="Com próxima sessão" value={(report as PsychologyPatientsReport).withNext} tone="violet" /><StatCard label="Sem próxima sessão" value={(report as PsychologyPatientsReport).withoutNext} tone="amber" /><StatCard label="Com pacote ativo" value={(report as PsychologyPatientsReport).withPackage} /></div><PatientsPreview report={report as PsychologyPatientsReport} /></>}
    </section>
    <p className="text-xs font-bold text-slate-500">Relatórios administrativos locais. Conteúdo clínico, registros de sessão, anamnese e documentos não fazem parte desta Central.</p>
  </section>;
}
