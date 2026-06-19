import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileImage,
  Filter,
  History,
  ImagePlus,
  Images,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { Patient, Session } from '../../types';
import type { AccessRole } from '../../types/access';
import type {
  ActivityGalleryAuditEntry,
  ActivityGalleryJustificationReason,
  ActivityGallerySessionSummary,
  ProfessionalActivityGalleryFilters,
  ProfessionalActivityGalleryPatient,
  ProfessionalActivityGalleryResponse,
} from '../../types/activityGallery';
import {
  ACTIVITY_GALLERY_CHANGED_EVENT,
  getProfessionalActivityGallery,
  getActivityRecordErrorMessage,
  listActivitySessionAudit,
  removeActivitySessionNoMediaJustification,
  saveActivitySessionNoMediaJustification,
} from '../../lib/activityRecordsApi';
import { safeFormatDate } from '../../lib/utils';
import { buildActivityMediaPackageModel, getCurrentActivityMediaSessions } from '../../lib/activityMediaPackages';
import { showToast } from '../Common/Toast';
import Modal from '../Common/Modal';
import PatientPhoto from '../Common/PatientPhoto';
import ActivityRecordModal from './ActivityRecordModal';
import ActivityRecordsTab from './ActivityRecordsTab';

interface Props {
  patients: Patient[];
  sessions: Session[];
  currentUserId: string;
  currentUserName: string;
  accessRole: AccessRole;
  initialPatientId?: string | null;
  onInitialPatientConsumed?: () => void;
}

const PAGE_SIZE = 20;

const JUSTIFICATION_REASONS: ActivityGalleryJustificationReason[] = [
  'atividade sem registro visual',
  'responsável não autorizou',
  'sessão administrativa',
  'atendimento virtual',
  'mídia não produzida',
  'problema técnico',
  'outro',
];

const EMPTY_RESPONSE: ProfessionalActivityGalleryResponse = {
  monitoringStart: null,
  metrics: {
    latePatientCount: 0,
    waitingSessionCount: 0,
    regularizedTodayCount: 0,
    lateSessionCount: 0,
    nextTransitionAt: null,
  },
  items: [],
  professionals: [],
  patientOptions: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  hasMore: false,
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Não registrado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não registrado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatElapsedHours(hours: number): string {
  const totalMinutes = Math.max(0, Math.floor((Number(hours) || 0) * 60));
  const days = Math.floor(totalMinutes / 1440);
  const remainder = totalMinutes % 1440;
  const wholeHours = Math.floor(remainder / 60);
  const minutes = remainder % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  if (wholeHours > 0) parts.push(`${wholeHours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(' e ');
}

function getStatusPresentation(item: Pick<ProfessionalActivityGalleryPatient, 'status'>) {
  switch (item.status) {
    case 'overdue':
      return { label: 'Upload atrasado', card: 'border-status-red-text/35 bg-status-red-bg/35', badge: 'bg-status-red-bg text-status-red-text', icon: AlertTriangle };
    case 'waiting':
      return { label: 'Aguardando upload', card: 'border-amber-300 bg-amber-50/60', badge: 'bg-amber-100 text-amber-900', icon: Clock3 };
    case 'sent':
      return { label: 'Mídia enviada', card: 'border-status-green-text/25 bg-status-green-bg/35', badge: 'bg-status-green-bg text-status-green-text', icon: CheckCircle2 };
    case 'excused':
      return { label: 'Sessão sem mídia', card: 'border-purple-300 bg-purple-50/70', badge: 'bg-purple-100 text-purple-800', icon: ShieldCheck };
    default:
      return { label: 'Sem sessão recente', card: 'border-clinic-border bg-white', badge: 'bg-clinic-bg text-clinic-text-muted', icon: Clock3 };
  }
}

function getSessionPresentation(session: ActivityGallerySessionSummary) {
  if (session.state === 'overdue') {
    const escalation = session.escalation >= 72 ? ' • acima de 72h' : session.escalation >= 48 ? ' • acima de 48h' : '';
    return {
      label: `Upload atrasado${escalation}`,
      style: session.escalation >= 72
        ? 'border-red-500 bg-red-100 text-red-900'
        : session.escalation >= 48
          ? 'border-status-red-text/50 bg-status-red-bg text-status-red-text'
          : 'border-status-red-text/30 bg-status-red-bg/60 text-status-red-text',
    };
  }
  if (session.state === 'waiting') return { label: 'Aguardando upload', style: 'border-amber-300 bg-amber-50 text-amber-900' };
  if (session.state === 'sent') return { label: 'Mídia enviada', style: 'border-status-green-text/20 bg-status-green-bg text-status-green-text' };
  if (session.state === 'excused') return { label: 'Sessão sem mídia', style: 'border-purple-300 bg-purple-50 text-purple-800' };
  return { label: 'Sem alerta', style: 'border-clinic-border bg-clinic-bg text-clinic-text-muted' };
}

function getSessionMessage(session: ActivityGallerySessionSummary): string {
  const base = `Sessão realizada em ${safeFormatDate(session.date, 'dd/MM/yyyy')} às ${session.time}`;
  if (session.state === 'overdue') return `${base} — upload atrasado há ${formatElapsedHours(session.overdueHours)}.`;
  if (session.state === 'waiting') {
    const remaining = Math.max(0, 24 - session.elapsedHours);
    return `${base} — prazo restante aproximado: ${formatElapsedHours(remaining)}.`;
  }
  if (session.state === 'sent') return `${base} — ${session.mediaCount} ${session.mediaCount === 1 ? 'mídia vinculada' : 'mídias vinculadas'}.`;
  if (session.state === 'excused') return `${base} — ${session.justification?.reason || 'dispensada de mídia'}.`;
  return base;
}

export default function ProfessionalActivityGallery({
  patients,
  sessions,
  currentUserId,
  currentUserName,
  accessRole,
  initialPatientId,
  onInitialPatientConsumed,
}: Props) {
  const [response, setResponse] = useState<ProfessionalActivityGalleryResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<ProfessionalActivityGalleryFilters>({
    status: 'all',
    professional: 'all',
    patientId: 'all',
    archive: 'active',
    search: '',
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedGalleryPackageNumber, setSelectedGalleryPackageNumber] = useState<number | null>(null);
  const [selectedGallerySessionId, setSelectedGallerySessionId] = useState('');
  const [registerTarget, setRegisterTarget] = useState<{ patient: Patient; sessions: Session[]; availableSessions: Session[] } | null>(null);
  const [justificationTarget, setJustificationTarget] = useState<{ patient: Patient; session: ActivityGallerySessionSummary } | null>(null);
  const [justificationReason, setJustificationReason] = useState<ActivityGalleryJustificationReason>('atividade sem registro visual');
  const [justificationNote, setJustificationNote] = useState('');
  const [justificationBusy, setJustificationBusy] = useState(false);
  const [auditTarget, setAuditTarget] = useState<{ patient: Patient; session: ActivityGallerySessionSummary } | null>(null);
  const [auditEntries, setAuditEntries] = useState<ActivityGalleryAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const refreshRequestRef = useRef(0);

  const load = useCallback(async ({
    append = false,
    page = 1,
    force = false,
  }: {
    append?: boolean;
    page?: number;
    force?: boolean;
  } = {}) => {
    const requestId = ++refreshRequestRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const result = await getProfessionalActivityGallery(
        { ...filters, page, pageSize: PAGE_SIZE },
        { force },
      );
      if (requestId !== refreshRequestRef.current) return;
      setResponse(current => append
        ? { ...result, items: [...current.items, ...result.items] }
        : result);
    } catch (loadError) {
      if (requestId !== refreshRequestRef.current) return;
      setError(getActivityRecordErrorMessage(loadError));
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters(current => {
        const normalized = searchDraft.trim();
        if (current.search === normalized) return current;
        return { ...current, search: normalized, page: 1 };
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load({ force: true });
    window.addEventListener(ACTIVITY_GALLERY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVITY_GALLERY_CHANGED_EVENT, refresh);
  }, [load]);

  useEffect(() => {
    const next = response.metrics.nextTransitionAt ? new Date(response.metrics.nextTransitionAt).getTime() : 0;
    if (!next || Number.isNaN(next)) return;
    const delay = Math.max(1000, Math.min(next - Date.now() + 1500, 2_147_000_000));
    const timeout = window.setTimeout(() => void load({ force: true }), delay);
    return () => window.clearTimeout(timeout);
  }, [load, response.metrics.nextTransitionAt]);

  useEffect(() => {
    if (!initialPatientId) return;
    const patient = patients.find(item => item.id === initialPatientId)
      || response.items.find(item => item.patient.id === initialPatientId)?.patient;
    if (patient) {
      setSelectedPatientId(patient.id);
      onInitialPatientConsumed?.();
    }
  }, [initialPatientId, onInitialPatientConsumed, patients, response.items]);

  const selectedItem = useMemo(
    () => response.items.find(item => item.patient.id === selectedPatientId) || null,
    [response.items, selectedPatientId],
  );
  const selectedPatient = useMemo(
    () => patients.find(item => item.id === selectedPatientId) || selectedItem?.patient || null,
    [patients, selectedItem, selectedPatientId],
  );
  const selectedPatientAllSessions = useMemo(() => {
    const merged = new Map<string, Session>();
    for (const session of sessions.filter(item => item.patientId === selectedPatientId)) merged.set(session.id, session);
    for (const session of selectedItem?.sessions || []) merged.set(session.id, session);
    return Array.from(merged.values());
  }, [selectedItem?.sessions, selectedPatientId, sessions]);

  const selectedPatientPackageModel = useMemo(() => buildActivityMediaPackageModel({
    patientId: selectedPatientId || '',
    sessions: selectedPatientAllSessions,
  }), [selectedPatientAllSessions, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId) {
      setSelectedGalleryPackageNumber(null);
      setSelectedGallerySessionId('');
      return;
    }
    setSelectedGalleryPackageNumber(selectedPatientPackageModel.currentPackageNumber);
    setSelectedGallerySessionId('');
  }, [selectedPatientId, selectedPatientPackageModel.currentPackageNumber]);

  const selectedGalleryPackage = useMemo(() => (
    selectedPatientPackageModel.packages.find(pkg => pkg.number === selectedGalleryPackageNumber)
    || selectedPatientPackageModel.packages.find(pkg => pkg.number === selectedPatientPackageModel.currentPackageNumber)
    || null
  ), [selectedGalleryPackageNumber, selectedPatientPackageModel]);

  const selectedPatientSessions = useMemo(
    () => selectedGalleryPackage?.sessions || [],
    [selectedGalleryPackage],
  );

  const selectedGallerySession = useMemo(
    () => selectedPatientSessions.find(session => session.id === selectedGallerySessionId) || null,
    [selectedGallerySessionId, selectedPatientSessions],
  );

  const viewingCurrentPackage = selectedGalleryPackage?.number === selectedPatientPackageModel.currentPackageNumber;

  const resetFilters = () => {
    setSearchDraft('');
    setFilters({ status: 'all', professional: 'all', patientId: 'all', archive: 'active', search: '', page: 1, pageSize: PAGE_SIZE });
  };

  const openRegister = (item: ProfessionalActivityGalleryPatient, targetSessions?: ActivityGallerySessionSummary[]) => {
    const patient = patients.find(candidate => candidate.id === item.patient.id) || item.patient;
    const availableById = new Map<string, Session>();
    for (const session of sessions.filter(candidate => candidate.patientId === patient.id)) availableById.set(session.id, session);
    for (const session of item.sessions) availableById.set(session.id, session);
    const allPatientSessions = Array.from(availableById.values());
    const availableSessions = getCurrentActivityMediaSessions({ patientId: patient.id, sessions: allPatientSessions });
    if (availableSessions.length === 0) {
      showToast('Nenhuma sessão do pacote atual disponível até o momento.', 'info');
      return;
    }
    const ids = new Set((targetSessions || item.sessions.filter(session => ['waiting', 'overdue'].includes(session.state)).slice(0, 1)).map(session => session.id));
    const related = availableSessions.filter(session => ids.has(session.id));
    const fallback = availableSessions.slice(0, 1);
    setRegisterTarget({ patient, sessions: related.length > 0 ? related : fallback, availableSessions: allPatientSessions });
  };

  const openJustification = (patient: Patient, session: ActivityGallerySessionSummary) => {
    setJustificationTarget({ patient, session });
    setJustificationReason(session.justification?.reason || 'atividade sem registro visual');
    setJustificationNote(session.justification?.note || '');
  };

  const saveJustification = async () => {
    if (!justificationTarget) return;
    if (justificationReason === 'outro' && !justificationNote.trim()) {
      showToast('Descreva a justificativa selecionada como Outro.', 'error');
      return;
    }
    setJustificationBusy(true);
    try {
      await saveActivitySessionNoMediaJustification({
        patientId: justificationTarget.patient.id,
        sessionId: justificationTarget.session.id,
        reason: justificationReason,
        note: justificationNote.trim(),
      });
      showToast('Sessão registrada como sem mídia.', 'success');
      setJustificationTarget(null);
      await load();
    } catch (saveError) {
      showToast(getActivityRecordErrorMessage(saveError), 'error');
    } finally {
      setJustificationBusy(false);
    }
  };

  const removeJustification = async () => {
    if (!justificationTarget || !justificationTarget.session.justification?.active) return;
    if (!window.confirm('Remover esta justificativa e recalcular a pendência da sessão?')) return;
    setJustificationBusy(true);
    try {
      await removeActivitySessionNoMediaJustification({
        patientId: justificationTarget.patient.id,
        sessionId: justificationTarget.session.id,
      });
      showToast('Justificativa removida. A pendência foi recalculada.', 'success');
      setJustificationTarget(null);
      await load();
    } catch (removeError) {
      showToast(getActivityRecordErrorMessage(removeError), 'error');
    } finally {
      setJustificationBusy(false);
    }
  };

  const openAudit = async (patient: Patient, session: ActivityGallerySessionSummary) => {
    setAuditTarget({ patient, session });
    setAuditEntries([]);
    setAuditLoading(true);
    try {
      setAuditEntries(await listActivitySessionAudit({ patientId: patient.id, sessionId: session.id }));
    } catch (auditError) {
      showToast(getActivityRecordErrorMessage(auditError), 'error');
      setAuditTarget(null);
    } finally {
      setAuditLoading(false);
    }
  };

  if (selectedPatient) {
    return (
      <div className="space-y-5 py-6">
        <button
          type="button"
          onClick={() => setSelectedPatientId(null)}
          className="inline-flex items-center gap-2 rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-xs font-black uppercase text-clinic-primary shadow-sm"
        >
          <ArrowLeft size={16} /> Voltar para todos os atendentes
        </button>
        <section className="rounded-2xl border border-clinic-border bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Galeria do atendente</p>
              <h2 className="mt-1 text-xl font-black text-clinic-text">{selectedPatient.name}</h2>
              <p className="mt-1 text-sm text-clinic-text-muted">O pacote atual é exibido primeiro. Pacotes anteriores são carregados somente quando selecionados.</p>
            </div>
            <div className="grid w-full gap-3 md:grid-cols-2 xl:max-w-3xl">
              <label>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Selecionar pacote</span>
                <select
                  value={selectedGalleryPackage?.number || ''}
                  onChange={event => {
                    setSelectedGalleryPackageNumber(Number(event.target.value) || selectedPatientPackageModel.currentPackageNumber);
                    setSelectedGallerySessionId('');
                  }}
                  className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
                  aria-label="Selecionar pacote da galeria"
                >
                  {selectedPatientPackageModel.packages.map(pkg => (
                    <option key={pkg.number} value={pkg.number}>
                      {pkg.number === selectedPatientPackageModel.currentPackageNumber
                        ? `Pacote atual • Pacote ${pkg.number}`
                        : `Pacote ${pkg.number} • anterior`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Selecionar sessão da galeria</span>
                <select
                  value={selectedGallerySessionId}
                  onChange={event => setSelectedGallerySessionId(event.target.value)}
                  disabled={selectedPatientSessions.length === 0}
                  className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Selecionar sessão da galeria"
                >
                  <option value="">Selecione uma data de sessão</option>
                  {selectedPatientSessions.map(session => (
                    <option key={session.id} value={session.id}>
                      {safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time} • Sessão {session.activitySessionNumber}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {!selectedGallerySession && (
          <div className="rounded-2xl border border-dashed border-clinic-border bg-clinic-bg/40 p-10 text-center">
            <CalendarDays className="mx-auto text-clinic-text-faint" size={34} />
            <p className="mt-3 font-black text-clinic-text">
              {selectedPatientSessions.length === 0 ? 'Nenhuma sessão disponível' : 'Selecione uma sessão'}
            </p>
            <p className="mt-1 text-sm text-clinic-text-muted">
              {selectedPatientSessions.length === 0
                ? (viewingCurrentPackage
                    ? 'Nenhuma sessão do pacote atual disponível até o momento.'
                    : 'Este pacote anterior não possui sessões disponíveis para a galeria.')
                : 'Nenhuma mídia será carregada até que uma data seja escolhida.'}
            </p>
          </div>
        )}

        {selectedGallerySession && (
          <ActivityRecordsTab
            patient={selectedPatient}
            sessions={selectedPatientAllSessions}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            selectedSessionId={selectedGallerySession.id}
            sessionScoped
            allowNewRecord={viewingCurrentPackage}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 py-6 pb-20">
      <section className="rounded-2xl border border-clinic-border bg-gradient-to-br from-clinic-bg to-white p-5 shadow-clinic">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Images className="text-clinic-primary" size={24} />
              <h2 className="text-xl font-black text-clinic-text sm:text-2xl">Galeria de atividades</h2>
            </div>
            <p className="mt-1 text-sm text-clinic-text-muted">Controle profissional de fotos, vídeos e sessões realizadas ainda sem mídia.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-primary disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </section>

      {!response.monitoringStart && !loading && (
        <div className="rounded-2xl border border-purple-300 bg-purple-50 p-4 text-sm text-purple-900">
          <p className="font-black">Monitoramento ainda não ativado</p>
          <p className="mt-1">Defina em Ajustes a data e a hora de início do monitoramento. As mídias antigas continuam disponíveis sem gerar alertas retroativos.</p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-status-red-text/25 bg-status-red-bg p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-status-red-text">Atendentes com upload atrasado</p>
          <p className="mt-2 text-3xl font-black text-status-red-text">{response.metrics.latePatientCount}</p>
          <p className="mt-1 text-xs text-status-red-text/80">{response.metrics.lateSessionCount} sessões atrasadas</p>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-900">Sessões aguardando upload</p>
          <p className="mt-2 text-3xl font-black text-amber-900">{response.metrics.waitingSessionCount}</p>
          <p className="mt-1 text-xs text-amber-800">Dentro das primeiras 24 horas</p>
        </div>
        <div className="rounded-2xl border border-status-green-text/25 bg-status-green-bg p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-status-green-text">Sessões regularizadas hoje</p>
          <p className="mt-2 text-3xl font-black text-status-green-text">{response.metrics.regularizedTodayCount}</p>
          <p className="mt-1 text-xs text-status-green-text/80">Por mídia ou justificativa</p>
        </div>
      </section>

      <section className="rounded-2xl border border-clinic-border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" />
            <input
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
              placeholder="Pesquisar atendente..."
              className="w-full rounded-xl border border-clinic-border bg-clinic-bg py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-clinic-primary"
            />
          </label>
          <button type="button" onClick={() => setFiltersOpen(open => !open)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-xs font-black uppercase text-clinic-primary lg:hidden">
            <Filter size={16} /> Filtros {filtersOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button type="button" onClick={resetFilters} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">
            <X size={15} /> Limpar
          </button>
        </div>

        <div className={`${filtersOpen ? 'grid' : 'hidden'} mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-6`}>
          <select value={filters.status || 'all'} onChange={event => setFilters(current => ({ ...current, status: event.target.value as ProfessionalActivityGalleryFilters['status'], page: 1 }))} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs">
            <option value="all">Todos os estados</option>
            <option value="overdue">Upload atrasado</option>
            <option value="waiting">Aguardando upload</option>
            <option value="sent">Regularizados</option>
            <option value="no-media">Sem nenhuma mídia</option>
            <option value="excused">Dispensados</option>
          </select>
          <select value={filters.professional || 'all'} onChange={event => setFilters(current => ({ ...current, professional: event.target.value, page: 1 }))} disabled={accessRole === 'professional'} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs disabled:opacity-60">
            <option value="all">Todos os profissionais</option>
            {response.professionals.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={filters.patientId || 'all'} onChange={event => setFilters(current => ({ ...current, patientId: event.target.value, page: 1 }))} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs">
            <option value="all">Todos os atendentes</option>
            {response.patientOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <select value={filters.archive || 'active'} onChange={event => setFilters(current => ({ ...current, archive: event.target.value as ProfessionalActivityGalleryFilters['archive'], page: 1 }))} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs">
            <option value="active">Atendentes ativos</option>
            <option value="archived">Arquivados</option>
            <option value="all">Ativos e arquivados</option>
          </select>
          <input type="date" value={filters.dateFrom || ''} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value, page: 1 }))} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs" aria-label="Data inicial" />
          <input type="date" value={filters.dateTo || ''} onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value, page: 1 }))} className="rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-xs" aria-label="Data final" />
        </div>
      </section>

      {loading && (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-clinic-border bg-white"><Loader2 className="animate-spin text-clinic-primary" size={32} /></div>
      )}
      {!loading && error && (
        <div className="rounded-2xl border border-status-red-text/25 bg-status-red-bg p-5 text-center text-sm font-bold text-status-red-text">{error}</div>
      )}
      {!loading && !error && response.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-clinic-border bg-clinic-bg/40 p-10 text-center">
          <FileImage className="mx-auto text-clinic-text-faint" size={34} />
          <p className="mt-3 font-black text-clinic-text">Nenhum atendente encontrado</p>
          <p className="mt-1 text-sm text-clinic-text-muted">Revise os filtros ou aguarde o carregamento das sessões monitoradas.</p>
        </div>
      )}

      {!loading && !error && response.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {response.items.map(item => {
            const presentation = getStatusPresentation(item);
            const StatusIcon = presentation.icon;
            const patient = patients.find(candidate => candidate.id === item.patient.id) || item.patient;
            const pendingSessions = item.sessions.filter(session => ['waiting', 'overdue'].includes(session.state));
            return (
              <article key={item.patient.id} className={`rounded-2xl border p-4 shadow-sm ${presentation.card}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-clinic-border bg-white text-clinic-primary">
                    {(patient.photoUrl || patient.photoDriveFileId) ? (
                      <PatientPhoto
                        patient={patient}
                        expandable
                        className="h-full w-full object-cover"
                        fallbackClassName="flex h-full w-full items-center justify-center text-xs font-black uppercase text-clinic-primary"
                      />
                    ) : <UserRound size={24} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="truncate font-black text-clinic-text">{patient.name}</h3>
                        <p className="mt-0.5 text-xs text-clinic-text-muted">{item.professionalNames.length > 0 ? item.professionalNames.join(', ') : 'Profissional não vinculado'}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${presentation.badge}`}><StatusIcon size={12} /> {presentation.label}</span>
                    </div>
                    {item.hasAnyMedia === false && <p className="mt-2 text-xs font-black text-clinic-text-muted">Nenhuma mídia registrada</p>}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-white/75 p-3">
                    <p className="text-[9px] font-black uppercase text-clinic-text-faint">Última sessão</p>
                    <p className="mt-1 font-bold text-clinic-text">{item.latestSession ? `${safeFormatDate(item.latestSession.date, 'dd/MM/yyyy')} • ${item.latestSession.time}` : 'Sem sessão recente'}</p>
                  </div>
                  <div className="rounded-xl bg-white/75 p-3">
                    <p className="text-[9px] font-black uppercase text-clinic-text-faint">Último upload</p>
                    <p className="mt-1 font-bold text-clinic-text">{formatDateTime(item.latestUploadAt)}</p>
                  </div>
                </div>

                {(item.pendingCount > 0 || item.overdueCount > 0) && (
                  <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs font-bold text-clinic-text">
                    {item.pendingCount} {item.pendingCount === 1 ? 'sessão pendente' : 'sessões pendentes'} • {item.overdueCount} atrasada(s)
                  </div>
                )}

                {item.sessions.slice(0, 4).map(session => {
                  const sessionPresentation = getSessionPresentation(session);
                  return (
                    <div key={session.id} className={`mt-3 rounded-xl border p-3 ${sessionPresentation.style}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-black uppercase">{sessionPresentation.label}</p>
                          <p className="mt-1 text-xs font-semibold leading-relaxed">{getSessionMessage(session)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {['waiting', 'overdue'].includes(session.state) && (
                            <button type="button" onClick={() => openRegister(item, [session])} className="rounded-lg bg-clinic-primary px-2.5 py-2 text-[9px] font-black uppercase text-white"><ImagePlus size={13} className="inline" /> Registrar</button>
                          )}
                          {['waiting', 'overdue', 'excused'].includes(session.state) && (
                            <button type="button" onClick={() => openJustification(patient, session)} className="rounded-lg border border-current/20 bg-white/80 px-2.5 py-2 text-[9px] font-black uppercase">Sem mídia</button>
                          )}
                          {accessRole === 'admin' && (
                            <button type="button" onClick={() => void openAudit(patient, session)} className="rounded-lg border border-current/20 bg-white/80 p-2" aria-label="Abrir auditoria"><History size={13} /></button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => openRegister(item, pendingSessions.slice(0, 2))} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-3 py-3 text-xs font-black uppercase text-white"><ImagePlus size={15} /> Registrar atividade</button>
                  <button type="button" onClick={() => setSelectedPatientId(patient.id)} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-3 text-xs font-black uppercase text-clinic-primary"><Images size={15} /> Visualizar galeria</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && response.hasMore && (
        <div className="flex justify-center">
          <button type="button" disabled={loadingMore} onClick={() => void load({ append: true, page: response.page + 1 })} className="inline-flex items-center gap-2 rounded-xl border border-clinic-border bg-white px-6 py-3 text-xs font-black uppercase text-clinic-primary disabled:opacity-50">
            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />} Carregar mais
          </button>
        </div>
      )}

      {registerTarget && (
        <ActivityRecordModal
          isOpen
          onClose={() => setRegisterTarget(null)}
          patient={registerTarget.patient}
          sessions={registerTarget.availableSessions}
          initialSession={registerTarget.sessions[0] || null}
          initialSessions={registerTarget.sessions}
          currentUserName={currentUserName}
          onViewGallery={() => {
            setRegisterTarget(null);
            setSelectedPatientId(registerTarget.patient.id);
          }}
        />
      )}

      <Modal isOpen={!!justificationTarget} onClose={() => !justificationBusy && setJustificationTarget(null)} title="Esta sessão não gerou mídia" width="max-w-lg">
        {justificationTarget && (
          <div className="space-y-4">
            <div className="rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm">
              <p className="font-black text-clinic-text">{justificationTarget.patient.name}</p>
              <p className="mt-1 text-xs text-clinic-text-muted">{safeFormatDate(justificationTarget.session.date, 'dd/MM/yyyy')} às {justificationTarget.session.time}</p>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-clinic-text-faint">Justificativa</label>
              <select value={justificationReason} onChange={event => setJustificationReason(event.target.value as ActivityGalleryJustificationReason)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm">
                {JUSTIFICATION_REASONS.map(reason => <option key={reason} value={reason}>{reason.charAt(0).toUpperCase() + reason.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-clinic-text-faint">Observação {justificationReason === 'outro' ? 'obrigatória' : 'opcional'}</label>
              <textarea value={justificationNote} onChange={event => setJustificationNote(event.target.value)} className="min-h-28 w-full rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm" maxLength={1000} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div>
                {justificationTarget.session.justification?.active
                  && (accessRole === 'admin' || justificationTarget.session.justification.createdByUserId === currentUserId) && (
                  <button type="button" disabled={justificationBusy} onClick={() => void removeJustification()} className="rounded-xl bg-status-red-bg px-4 py-3 text-xs font-black uppercase text-status-red-text disabled:opacity-50">Remover justificativa</button>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" disabled={justificationBusy} onClick={() => setJustificationTarget(null)} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">Cancelar</button>
                <button type="button" disabled={justificationBusy} onClick={() => void saveJustification()} className="rounded-xl bg-purple-700 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50">{justificationBusy ? 'Salvando...' : 'Salvar justificativa'}</button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!auditTarget} onClose={() => setAuditTarget(null)} title="Histórico da sessão" width="max-w-2xl">
        {auditLoading && <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-clinic-primary" /></div>}
        {!auditLoading && auditEntries.length === 0 && <p className="rounded-xl bg-clinic-bg p-4 text-sm text-clinic-text-muted">Nenhuma ação de auditoria registrada para esta sessão.</p>}
        {!auditLoading && auditEntries.length > 0 && (
          <div className="max-h-[65vh] space-y-3 overflow-auto pr-1">
            {auditEntries.map(entry => (
              <article key={entry.id} className="rounded-xl border border-clinic-border bg-clinic-bg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase text-clinic-primary">{entry.action.replaceAll('_', ' ')}</p>
                  <p className="text-[10px] text-clinic-text-faint">{formatDateTime(entry.createdAt)}</p>
                </div>
                <p className="mt-1 text-xs font-bold text-clinic-text">{entry.actorName || 'Usuário não identificado'}</p>
                {Object.keys(entry.details || {}).length > 0 && <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-[10px] text-clinic-text-muted">{JSON.stringify(entry.details, null, 2)}</pre>}
              </article>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
