import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  Clock3,
  Images,
  Info,
  LayoutDashboard,
  Loader2,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { getMonitoringPanelData } from '../../lib/accessApi';
import { calculateAge, cn, getStatusColor, safeFormatDate } from '../../lib/utils';
import type { MonitoringPanelData, MonitoringPatient, MonitoringSession } from '../../types/access';
import {
  buildMonitoringPatientSummary,
  filterMonitoringSummaries,
  getMonitoringUpcomingSessionGroups,
  getSaoPauloWeekRange,
  groupMonitoringSessionsByDate,
  isMonitoringPatientVisible,
  normalizeMonitoringText,
} from '../../../shared/monitoringPanel.js';
import BrandLogo from '../Common/BrandLogo';
import PatientPhoto from '../Common/PatientPhoto';
import ResponsibleGooglePhotosGallery from '../GooglePhotosAlbums/ResponsibleGooglePhotosGallery';

type MonitoringTab = 'dashboard' | 'agenda' | 'galeria';
type MonitoringSummary = ReturnType<typeof buildMonitoringPatientSummary>;

interface MonitoringPanelProps {
  adminPreview?: boolean;
  embedded?: boolean;
  onExitPreview?: () => void;
  onLogout?: () => void;
}

function patientDisplayName(patient: MonitoringPatient): string {
  return patient.fullName || patient.name || 'Atendente';
}

function patientInitials(patient: MonitoringPatient): string {
  return patientDisplayName(patient)
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'AT';
}

function formatWeekRange(start: string, end: string): string {
  return `${safeFormatDate(start, 'dd/MM')} a ${safeFormatDate(end, 'dd/MM/yyyy')}`;
}

function formatSessionTime(session: MonitoringSession): string {
  return session.time || '--:--';
}

function formatDayHeading(date: string): string {
  const parsed = new Date(`${date}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return safeFormatDate(date, 'dd/MM/yyyy');
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).format(parsed);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getPackageNumber(summary: MonitoringSummary): number {
  const realized = Number(summary.sessionsRealized) || 0;
  return Math.max(1, Math.ceil(Math.max(realized, 1) / 10));
}

function getProgressBarClass(percentage: number | null): string {
  if (percentage === null) return 'bg-clinic-text-faint';
  if (percentage >= 80) return 'bg-status-green-text';
  if (percentage >= 40) return 'bg-amber-500';
  return 'bg-clinic-primary';
}

function getSessionReference(session: MonitoringSession, summary: MonitoringSummary | undefined): string {
  const planned = Number(summary?.sessionsPlanned) || 10;
  const realized = Number(summary?.currentPackageRealized) || 0;
  const nextNumber = Math.min(planned, Math.max(1, realized + 1));
  const inferredPackage = Math.max(1, Math.ceil(Math.max(Number(summary?.sessionsRealized) || 0, 1) / 10));
  const packageLabel = `Pacote ${session.packageNumber || inferredPackage}`;
  return `${packageLabel} • Sessão prevista ${nextNumber} de ${planned}`;
}

export default function MonitoringPanel({
  adminPreview = false,
  embedded = false,
  onExitPreview,
  onLogout,
}: MonitoringPanelProps) {
  const [data, setData] = useState<MonitoringPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<MonitoringTab>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [detailPatientId, setDetailPatientId] = useState('');
  const [gallerySearch, setGallerySearch] = useState('');
  const [filters, setFilters] = useState({
    name: '',
    status: '',
    activeState: 'all',
    minProgress: '',
    maxProgress: '',
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getMonitoringPanelData({ adminPreview })
      .then(result => {
        if (!active) return;
        setData(result);
        setSelectedPatientId(current => (
          current && result.patients.some(patient => patient.id === current)
            ? current
            : ''
        ));
      })
      .catch(caughtError => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar o Monitoramento.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [adminPreview]);

  const activityCounts = useMemo(() => (
    new Map((data?.activityCounts || []).map(item => [item.patientId, item.count]))
  ), [data?.activityCounts]);

  const summaries = useMemo(() => (
    (data?.patients || []).map(patient => buildMonitoringPatientSummary(
      patient,
      data?.sessions || [],
      activityCounts.get(patient.id) || 0,
      10,
    ))
  ), [activityCounts, data?.patients, data?.sessions]);

  const visibleSummaries = useMemo(() => (
    summaries.filter(summary => isMonitoringPatientVisible(summary.patient))
  ), [summaries]);

  const visiblePatientIds = useMemo(() => (
    new Set(visibleSummaries.map(summary => summary.patient.id))
  ), [visibleSummaries]);

  const summariesByPatientId = useMemo(() => (
    new Map(visibleSummaries.map(summary => [summary.patient.id, summary]))
  ), [visibleSummaries]);

  const filteredSummaries = useMemo(() => filterMonitoringSummaries(visibleSummaries, {
    ...filters,
    minProgress: filters.minProgress === '' ? null : filters.minProgress,
    maxProgress: filters.maxProgress === '' ? null : filters.maxProgress,
  }), [filters, visibleSummaries]);

  const gallerySummaries = visibleSummaries;

  const filteredGallerySummaries = useMemo(() => {
    const query = normalizeMonitoringText(gallerySearch);
    if (!query) return gallerySummaries;
    return gallerySummaries.filter(summary => normalizeMonitoringText(patientDisplayName(summary.patient)).includes(query));
  }, [gallerySearch, gallerySummaries]);

  const selectedSummary = gallerySummaries.find(summary => summary.patient.id === selectedPatientId) || null;
  const detailSummary = visibleSummaries.find(summary => summary.patient.id === detailPatientId) || null;
  const weekRange = data?.weekRange || getSaoPauloWeekRange();
  const weekSessions = useMemo(() => (
    (data?.weekSessions || [])
      .filter(session => visiblePatientIds.has(session.patientId))
      .slice()
      .sort((left, right) => (
        `${left.date}T${left.time}|${left.id}`.localeCompare(`${right.date}T${right.time}|${right.id}`)
      ))
  ), [data?.weekSessions, visiblePatientIds]);
  const agendaDays = useMemo(() => groupMonitoringSessionsByDate(weekSessions), [weekSessions]);
  const upcoming = useMemo(() => getMonitoringUpcomingSessionGroups(
    (data?.sessions || []).filter(session => visiblePatientIds.has(session.patientId)),
  ), [data?.sessions, visiblePatientIds]);
  const monitoringUserName = data?.viewer.displayName || data?.viewer.email || 'Usuário do Monitoramento';

  const tabs: Array<{ id: MonitoringTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'agenda', label: 'Agenda', icon: Calendar },
    { id: 'galeria', label: 'Galeria de Atividades', icon: Images },
  ];

  const shellClass = embedded
    ? 'py-6'
    : 'min-h-screen bg-clinic-bg px-3 py-4 sm:px-5 lg:px-8';

  const renderUpcomingSession = (session: MonitoringSession) => {
    const summary = summariesByPatientId.get(session.patientId);
    return (
      <article key={session.id} className="grid gap-3 rounded-xl border border-clinic-border bg-white p-3 sm:grid-cols-[72px_1fr_auto] sm:items-center">
        <div className="text-lg font-black text-clinic-primary">{formatSessionTime(session)}</div>
        <div className="min-w-0">
          <p className="truncate font-black text-clinic-text">{session.patientName}</p>
          <p className="mt-0.5 text-xs text-clinic-text-muted">{getSessionReference(session, summary)}</p>
        </div>
        <span className={cn('w-fit rounded-full px-2.5 py-1 text-[10px] font-black uppercase', getStatusColor(session.status))}>
          {session.status || 'Agendada'}
        </span>
      </article>
    );
  };

  return (
    <div className={cn(shellClass, 'monitoring-theme-green')}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
              <div className="w-full rounded-xl border border-white/15 bg-clinic-header px-4 py-3 text-white shadow-sm sm:w-auto sm:min-w-[300px]">
                <BrandLogo
                  variant="sidebar"
                  theme="health-balance"
                  name={data?.settings.name}
                  subtitle={data?.settings.title}
                  className="w-full min-w-0"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-clinic-primary">Monitoramento</p>
                <h1 className="mt-1 text-2xl font-black text-clinic-text">Monitoramento</h1>
                <p className="mt-1 text-sm text-clinic-text-muted">
                  Visualização somente leitura dos atendentes vinculados ao profissional Fábio Denarde.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
              <div className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2">
                <UserRound size={17} className="shrink-0 text-clinic-primary" />
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-wide text-clinic-text-faint">Usuário do Monitoramento</p>
                  <p className="truncate text-sm font-black text-clinic-text">{monitoringUserName}</p>
                </div>
              </div>
              {adminPreview && (
                <div className="inline-flex items-center gap-2 rounded-xl border border-status-green-text/20 bg-status-green-bg px-3 py-2 text-xs font-black text-status-green-text">
                  <ShieldCheck size={16} />
                  Você está visualizando o perfil Monitoramento.
                </div>
              )}
              {adminPreview && onExitPreview && (
                <button type="button" onClick={onExitPreview} className="rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase text-white">
                  Retornar ao modo Administrador
                </button>
              )}
              {!embedded && onLogout && (
                <button type="button" onClick={onLogout} className="rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-xs font-black uppercase text-clinic-text">
                  Sair
                </button>
              )}
            </div>
          </div>
          <nav className="mt-4 grid gap-2 sm:grid-cols-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-black uppercase transition',
                  activeTab === tab.id
                    ? 'border-clinic-primary bg-clinic-primary text-white'
                    : 'border-clinic-border bg-clinic-bg text-clinic-text-muted hover:text-clinic-primary',
                )}
              >
                <tab.icon size={17} />
                {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {loading && (
          <div className="flex min-h-80 items-center justify-center gap-3 rounded-xl border border-clinic-border bg-clinic-surface text-sm font-bold text-clinic-text-muted">
            <Loader2 className="animate-spin text-clinic-primary" />
            Carregando Monitoramento...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">
            {error}
          </div>
        )}

        {!loading && !error && data && activeTab === 'dashboard' && (
          <section className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic lg:grid-cols-[1fr_180px_180px_150px_150px]">
              <label className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-clinic-text-faint" />
                <input className="clinic-input pl-10" placeholder="Nome do atendente" value={filters.name} onChange={event => setFilters(current => ({ ...current, name: event.target.value }))} />
              </label>
              <input className="clinic-input" placeholder="Situação" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} />
              <select className="clinic-input" value={filters.activeState} onChange={event => setFilters(current => ({ ...current, activeState: event.target.value }))}>
                <option value="all">Todos</option>
                <option value="active">Ativos</option>
                <option value="closed">Encerrados</option>
              </select>
              <input className="clinic-input" type="number" min="0" max="100" placeholder="And. mín." value={filters.minProgress} onChange={event => setFilters(current => ({ ...current, minProgress: event.target.value }))} />
              <input className="clinic-input" type="number" min="0" max="100" placeholder="And. máx." value={filters.maxProgress} onChange={event => setFilters(current => ({ ...current, maxProgress: event.target.value }))} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
              <section className="rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
                <div className="flex items-center justify-between gap-3 border-b border-clinic-border pb-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Andamento do acompanhamento</p>
                    <h2 className="mt-1 text-xl font-black text-clinic-text">Progresso dos Atendentes</h2>
                  </div>
                  <span className="rounded-full bg-clinic-bg px-3 py-1 text-xs font-black text-clinic-text-muted">
                    {filteredSummaries.length} atendente(s)
                  </span>
                </div>

                {filteredSummaries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-8 text-center text-clinic-text-muted">
                    Nenhum atendente encontrado com os filtros atuais.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {filteredSummaries.map(summary => (
                      <button
                        key={summary.patient.id}
                        type="button"
                        onClick={() => setDetailPatientId(summary.patient.id)}
                        className="block w-full rounded-xl border border-transparent p-2 text-left transition hover:border-clinic-border hover:bg-clinic-bg/70"
                      >
                        <div className="flex items-center gap-3">
                          <PatientPhoto
                            patient={{ name: patientDisplayName(summary.patient), photoUrl: summary.patient.photoUrl }}
                            alt={patientDisplayName(summary.patient)}
                            className="h-10 w-10 shrink-0 rounded-xl object-cover"
                            fallbackClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-clinic-primary text-xs font-black text-white"
                            fallbackText={patientInitials(summary.patient)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate font-black text-clinic-text">{patientDisplayName(summary.patient)}</p>
                              <p className="shrink-0 text-sm font-black text-clinic-text-muted">
                                {summary.currentPackageRealized}/{summary.sessionsPlanned || '--'}
                              </p>
                            </div>
                            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-status-green-bg">
                              <div
                                className={cn('h-full rounded-full transition-all', getProgressBarClass(summary.progressPercentage))}
                                style={{ width: `${summary.progressPercentage ?? 0}%` }}
                              />
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-clinic-text-muted">
                              <span>{summary.progressLabel} do pacote atual</span>
                              <span>{summary.activityCount} atividade(s)</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
                <div className="border-b border-clinic-border pb-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Agenda resumida</p>
                  <h2 className="mt-1 text-xl font-black text-clinic-text">Próximas Sessões — Hoje</h2>
                </div>

                <div className="mt-4 space-y-3">
                  {upcoming.todaySessions.length > 0 ? (
                    upcoming.todaySessions.map(renderUpcomingSession)
                  ) : (
                    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-5 text-center">
                      <Info size={28} className="text-clinic-text-faint" />
                      <p className="mt-3 text-sm font-bold text-clinic-text-muted">Nenhuma sessão marcada para hoje.</p>
                    </div>
                  )}
                </div>

                <div className="mt-5 border-t border-clinic-border pt-4">
                  <h3 className="font-black text-clinic-text">
                    {upcoming.nextDate ? `Próximas Sessões — ${formatDayHeading(upcoming.nextDate)}` : 'Próximas Sessões'}
                  </h3>
                  <div className="mt-3 space-y-3">
                    {upcoming.nextSessions.length > 0 ? (
                      upcoming.nextSessions.map(renderUpcomingSession)
                    ) : (
                      <p className="rounded-xl bg-clinic-bg p-4 text-sm text-clinic-text-muted">Nenhuma sessão futura encontrada.</p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </section>
        )}

        {!loading && !error && data && activeTab === 'agenda' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Somente horários preenchidos</p>
                <h2 className="mt-1 text-xl font-black text-clinic-text">Agenda Semanal</h2>
                <p className="mt-1 text-sm text-clinic-text-muted">Semana atual: {formatWeekRange(weekRange.start, weekRange.end)}.</p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-status-green-text/20 bg-status-green-bg px-3 py-2 text-xs font-black text-status-green-text">
                <CalendarDays size={16} />
                {weekSessions.length} sessão(ões) preenchida(s)
              </div>
            </div>

            {agendaDays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-clinic-border bg-clinic-surface p-8 text-center text-clinic-text-muted">
                Nenhum atendimento encontrado na semana atual.
              </div>
            ) : (
              <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                {agendaDays.map(day => (
                  <article key={day.date} className="overflow-hidden rounded-xl border border-clinic-border bg-clinic-surface shadow-clinic">
                    <header className="bg-status-green-text px-3 py-2.5 text-center text-white">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em]">{formatDayHeading(day.date).split(',')[0]}</p>
                      <p className="text-lg font-black">{safeFormatDate(day.date, 'dd/MM')}</p>
                    </header>
                    <div className="space-y-2 p-2.5">
                      {day.sessions.map(session => (
                        <div key={session.id} className="rounded-lg border border-clinic-border bg-white p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="inline-flex items-center gap-1 text-sm font-black text-clinic-primary">
                              <Clock3 size={14} />
                              {formatSessionTime(session)}
                            </div>
                            <span className={cn('rounded-full px-2 py-0.5 text-[8px] font-black uppercase', getStatusColor(session.status))}>
                              {session.status || 'Agendada'}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-sm font-black text-clinic-text">{session.patientName}</p>
                          <p className="mt-0.5 text-[10px] text-clinic-text-muted">{session.type || 'Atendimento'} • {session.durationMinutes} min</p>
                          <p className="mt-1 truncate text-[10px] font-bold text-clinic-text-faint">{session.professionalName}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && !error && data && activeTab === 'galeria' && (
          <section className="space-y-4">
            <div className="rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-status-green-bg p-2.5 text-status-green-text"><Images size={20} /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-status-green-text">Álbuns externos por pacote</p>
                  <h2 className="mt-1 text-xl font-black text-clinic-text">Galeria externa de atividades</h2>
                  <p className="mt-1 text-sm text-clinic-text-muted">Selecione um atendente para abrir somente as atividades autorizadas.</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-status-green-text">Seleção obrigatória</p>
                  <h3 className="mt-1 font-black text-clinic-text">Selecione o atendente</h3>
                  <p className="mt-1 text-xs text-clinic-text-muted">A galeria carrega o pacote somente depois do clique no card.</p>
                </div>
                <label className="relative w-full lg:max-w-xs">
                  <span className="mb-1 block text-[9px] font-black uppercase tracking-wide text-clinic-text-faint">Pesquisar por nome</span>
                  <Search className="absolute bottom-3 left-3 h-4 w-4 text-clinic-text-faint" />
                  <input
                    className="clinic-input pl-10"
                    placeholder="Digite o nome do atendente"
                    value={gallerySearch}
                    onChange={event => setGallerySearch(event.target.value)}
                  />
                </label>
              </div>

              {filteredGallerySummaries.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-6 text-center text-clinic-text-muted">
                  Nenhum atendente encontrado na Galeria do Monitoramento.
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredGallerySummaries.map(summary => {
                    const selected = selectedPatientId === summary.patient.id;
                    return (
                      <article
                        key={summary.patient.id}
                        onClick={() => setSelectedPatientId(summary.patient.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedPatientId(summary.patient.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-clinic-primary/30',
                          selected
                            ? 'border-clinic-primary ring-2 ring-clinic-primary/15'
                            : 'border-clinic-border hover:border-clinic-primary/60',
                        )}
                      >
                        <PatientPhoto
                          patient={{ name: patientDisplayName(summary.patient), photoUrl: summary.patient.photoUrl }}
                          alt={patientDisplayName(summary.patient)}
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                          expandable
                          fallbackClassName="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-clinic-border bg-clinic-bg text-xs font-black text-clinic-primary"
                          fallbackText={patientInitials(summary.patient)}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-clinic-text">{patientDisplayName(summary.patient)}</p>
                          <p className="mt-0.5 text-[10px] text-clinic-text-muted">Pacote atual {getPackageNumber(summary)} • Sessão {summary.currentPackageRealized} de {summary.sessionsPlanned || 10}</p>
                          <p className="mt-1 text-[10px] text-clinic-text-faint">Última sessão: {summary.lastSession ? safeFormatDate(summary.lastSession.date, 'dd/MM/yyyy') : 'Não informada'}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedSummary ? (
              <ResponsibleGooglePhotosGallery
                patientId={selectedSummary.patient.id}
                patientName={patientDisplayName(selectedSummary.patient)}
                packageNumber={getPackageNumber(selectedSummary)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-clinic-border bg-clinic-surface p-8 text-center text-clinic-text-muted">
                Selecione um atendente para visualizar as atividades autorizadas.
              </div>
            )}
          </section>
        )}

        {detailSummary && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-clinic-surface shadow-2xl">
              <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-clinic-border bg-clinic-surface p-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-clinic-primary">Detalhes do atendente</p>
                  <h2 className="text-xl font-black text-clinic-text">{patientDisplayName(detailSummary.patient)}</h2>
                </div>
                <button type="button" onClick={() => setDetailPatientId('')} className="rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs font-black text-clinic-text">Fechar</button>
              </header>
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <section className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
                  <h3 className="font-black text-clinic-text">Resumo do acompanhamento</h3>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Andamento do acompanhamento</dt><dd>{detailSummary.progressLabel}</dd></div>
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Sessões realizadas</dt><dd>{detailSummary.sessionsRealized}</dd></div>
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Próxima sessão</dt><dd>{detailSummary.nextSession ? `${safeFormatDate(detailSummary.nextSession.date, 'dd/MM/yyyy')} às ${detailSummary.nextSession.time}` : 'Não informada'}</dd></div>
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Atividades autorizadas</dt><dd>{detailSummary.activityCount}</dd></div>
                  </dl>
                </section>
                <section className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
                  <h3 className="font-black text-clinic-text">Responsável</h3>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Nome completo</dt><dd>{detailSummary.patient.guardianName || 'Não informado'}</dd></div>
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">Parentesco</dt><dd>{detailSummary.patient.guardianKinship || 'Responsável'}</dd></div>
                    <div><dt className="text-xs font-black uppercase text-clinic-text-faint">WhatsApp</dt><dd>{detailSummary.patient.whatsapp || 'Não informado'}</dd></div>
                  </dl>
                </section>
                <section className="rounded-xl border border-clinic-border bg-clinic-bg p-4 lg:col-span-2">
                  <h3 className="font-black text-clinic-text">Linha do tempo simplificada</h3>
                  <div className="mt-3 grid gap-2">
                    {detailSummary.sessions.slice(-8).reverse().map(session => (
                      <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-clinic-border bg-white px-3 py-2 text-sm">
                        <span>{safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time}</span>
                        <span>{session.type}</span>
                        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-black uppercase', getStatusColor(session.status))}>{session.status}</span>
                      </div>
                    ))}
                    {detailSummary.sessions.length === 0 && <p className="text-sm text-clinic-text-muted">Nenhuma sessão permitida para exibição.</p>}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        <footer className="flex items-start gap-3 rounded-xl border border-status-green-text/20 bg-status-green-bg/60 p-3 text-xs text-clinic-text-muted">
          <ShieldCheck size={18} className="shrink-0 text-status-green-text" />
          <p>Ambiente somente leitura. Não há controles de cadastro, edição, exclusão, financeiro, anamnese, registros clínicos restritos, laudos ou pareceres nesta visualização.</p>
        </footer>
      </div>
    </div>
  );
}
