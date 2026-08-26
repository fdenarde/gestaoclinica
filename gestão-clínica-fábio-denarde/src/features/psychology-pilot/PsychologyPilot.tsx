import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { addDays, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subWeeks } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle, ArrowLeft, Cake, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, DollarSign, FileText, Menu, Pencil,
  Plus, Search, Trash2, UserRound, UsersRound, WalletCards, X,
} from 'lucide-react';
import { getPsychologyAgendaScale, psychologyAgendaTimeToMinutes } from './psychologyAgendaScale';
import { getPsychologyAgendaRowProgress, getPsychologyAgendaTimeProgress, isPsychologyAgendaToday } from './psychologyAgendaTemporal';
import {
  createEmptyPsychologyStore,
  createPsychologyLocation,
  createPsychologyScope,
  getPsychologyDayItems,
  getPsychologyAgendaSessionsForSlot,
  getPsychologyPatientDateOfBirth,
  getPsychologyPersonalOccurrences,
  getActivePsychologySessionPackages,
  getPsychologySessionPackageProgress,
  getPsychologySessionPackageRemaining,
  LOCAL_PSYCHOLOGY_PROFESSIONAL_ID,
  LOCAL_PSYCHOLOGY_STORAGE_KEY,
  parsePsychologyStore,
  PSYCHOLOGY_CONTEXT,
  savePsychologySessionRecord,
  serializePsychologyStore,
  type PsychologyModality,
  type PsychologyPatient,
  type PsychologyPatientInput,
  type PsychologyPersonalCommitment,
  type PsychologyPersonalInput,
  type PsychologyPersonalType,
  type PsychologySession,
  type PsychologySessionInput,
  type PsychologySessionStatus,
  type PsychologyStore,
  type PsychologySessionPackageInput,
  upsertPsychologySessionPackage,
  setPsychologyLocationActive,
  setPsychologyLocationColor,
  setPsychologyPrimaryLocation,
  updatePsychologyLocation,
  restorePsychologyDefaultColors,
  setPsychologyCategoryColor,
  updatePsychologySettings,
  upsertPsychologyPatient,
  upsertPsychologyPersonalCommitment,
  upsertPsychologySession,
  synchronizePsychologyServiceForPatient,
  updatePsychologySessionStatus,
  validatePsychologyPatient,
  validatePsychologyPatientProfile,
  validatePsychologySession,
} from './psychologyDomain';
import PsychologyPersonalAgenda from './PsychologyPersonalAgenda';
import PsychologyImportExport from '../psychology-import-export/PsychologyImportExport';
import type { PsychologyBackupGenerator } from '../psychology-import-export/PsychologyImportExport';
import { requestAuthenticatedPsychologyBackup } from '../../lib/psychologyBackupApi';
import PsychologyPatientChart from './PsychologyPatientChart';
import PsychologyFinanceView from './PsychologyFinanceView';
import PsychologyReportsView from './PsychologyReportsView';
import PublicBookingSettingsPanel from '../psychology-online-booking/PublicBookingSettingsPanel';
import { createLocalPublicBookingRepository } from '../psychology-online-booking/repository';
import { syncLocalPublicBookingSettings } from '../psychology-online-booking/publicApiClient';
import { createPublicBookingException, getPublicBookingAgendaMarker, isLocationReadyForReminder, isValidGoogleMapsUrl, LOCATION_REMINDER_INCOMPLETE_MESSAGE, minutesToTime, timeToMinutes, type PublicBookingAgendaMarker } from '../psychology-online-booking/bookingDomain';
import type { PublicBookingException, PublicBookingSettings } from '../psychology-online-booking/types';
import { civilDateFromDate, requiresResponsible } from '../../lib/psychologyPatientAdministrative';
import { createPsychologyPeriod, getPsychologyFinancialLedger, getPsychologyFinancialOverview } from './psychologyFinancialLedger';
import {
  countPsychologyPatientList,
  filterPsychologyPatientList,
  getPsychologyPatientListViewModels,
  isPsychologyPatientInReview,
  sortPsychologyPatientList,
  type PsychologyPatientLastSessionFilter,
  type PsychologyPatientListItem,
  type PsychologyPatientListSortDirection,
  type PsychologyPatientListSortKey,
  type PsychologyPatientNextSessionFilter,
  type PsychologyPatientReviewFilter,
} from './psychologyPatientList';
import { deletePsychologyPatientLocally, getPsychologyPatientDeletionAssessment, normalizePsychologyPhone } from './psychologyPatientDeletion';
import { normalizePsychologyPhoneForSearch } from './psychologyPhone';
import {
  createDoctoraliaPreview,
  DOCTORALIA_PREVIEW_STORAGE_KEY,
  DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY,
  getDoctoraliaPreviewSessionsForDate,
  getDoctoraliaPreviewSessionsForRange,
  parseDoctoraliaPreviewHiddenCancelledEventIds,
  serializeDoctoraliaPreviewBundle,
  serializeDoctoraliaPreviewHiddenCancelledEventIds,
  type DoctoraliaPreviewPayload,
  type PsychologyDoctoraliaPreview,
} from '../psychology-import-export/doctoraliaPreview';
import { ALARM_ADVANCE_OPTIONS } from '../../lib/alarmSounds';
import {
  createPsychologyPersistenceScope,
  createPsychologyRemotePatientClient,
  isPsychologyRemoteClientEnabled,
  patientStoreWithUpdates,
  patientStoreWithoutIds,
  resolvePsychologyRuntimeIdentity,
  type PsychologyRuntimeMode,
} from '../psychology-persistence';
import { allSettledWithConcurrency, PSYCHOLOGY_BULK_DELETE_CONCURRENCY } from '../psychology-persistence/bulkDeleteConcurrency';
import {
  createDefaultPsychologyProfessionalPresentation,
  PSYCHOLOGY_CATEGORY_LABELS,
  PSYCHOLOGY_COLOR_DEFAULTS,
  agendaCategoryForSession,
  colorForAgendaCategory,
  locationForSession,
  type PsychologyAgendaCategory,
  type PsychologyAgendaDayParts,
  type PsychologySettings,
  type PsychologyProfessionalPresentation,
  type PsychologyLocation,
  type PsychologyLocationInput,
  type PsychologyAgendaPeriod,
  type PsychologyDailyAvailability,
  getPsychologyAgendaDaypart,
  getPsychologyAvailabilityTimes,
  getPsychologyFirstAvailabilityTime,
  isPsychologyDateTimeWithinAvailability,
  isPsychologyTimeWithinAvailability,
  PSYCHOLOGY_AGENDA_DAYPART_LABELS,
  type PsychologyAgendaDayPart,
  PSYCHOLOGY_WEEKDAY_LABELS,
  resolvePsychologyAgendaEventStyle,
} from './psychologyR2a';

type PsychologyPage = 'day' | 'patients' | 'agenda' | 'personal' | 'finance' | 'reports' | 'settings';

export interface PsychologyBulkDeletionSummary {
  processed: number;
  deleted: number;
  failed: number;
  deletedIds?: string[];
  failedIds?: string[];
}

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const formatDate = (value: string) => value
  ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(`${value}T12:00:00`))
  : '';

const formatShortDate = (value: string) => value
  ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  : '—';

const modalityLabel: Record<PsychologyModality, string> = { presencial: 'Presencial', online: 'Online' };
const statusLabel: Record<PsychologySessionStatus, string> = {
  agendada: 'Agendada', realizada: 'Realizada', falta: 'Falta', cancelada: 'Cancelada',
};
type NewEventKind = 'session' | 'personal' | 'mentoring';
type NewEventDefaults = { date: string; time: string; kind: NewEventKind };
const DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY = 'psychology-doctoralia-preview-opt-out';
type PublicBookingQuickAction =
  | { kind: 'BLOCK_PERIOD'; civilDate: string; startTime: string; endTime: string }
  | { kind: 'BLOCK_DAY'; civilDate: string }
  | { kind: 'OPEN_PERIOD'; civilDate: string; startTime: string; endTime: string }
  | { kind: 'UNBLOCK'; civilDate: string; exceptionId?: string; type?: PublicBookingException['type']; startTime?: string; endTime?: string };

function loadLocalStore() {
  if (typeof window === 'undefined') return createEmptyPsychologyStore(createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
  return parsePsychologyStore(window.localStorage.getItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`), createPsychologyScope(LOCAL_PSYCHOLOGY_PROFESSIONAL_ID));
}

function loadHiddenDoctoraliaCancelledEventIds(): string[] {
  if (typeof window === 'undefined') return [];
  return parseDoctoraliaPreviewHiddenCancelledEventIds(window.sessionStorage.getItem(DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY));
}

function isAuthorizedCleanupFingerprint(patient: PsychologyPatient): boolean {
  const name = patient.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
  const phone = normalizePsychologyPhone(patient.phone);
  return (name === 'fabiano' && phone === '27999072659') || (name === 'gertrudes' && phone === '27999999999');
}

async function cleanAuthorizedSyntheticPatients(store: PsychologyStore): Promise<{ store: PsychologyStore; message?: string }> {
  const candidates = store.patients.filter(isAuthorizedCleanupFingerprint);
  if (!candidates.length) return { store };
  const removable = candidates.filter(patient => getPsychologyPatientDeletionAssessment(store, patient.id)?.canDelete);
  const blocked = candidates.length - removable.length;
  if (!removable.length) return { store, message: 'Limpeza local bloqueada: fingerprint divergente ou referência externa encontrada.' };
  let backupResponse: Response;
  try {
    backupResponse = await fetch('/api/psychology-local-backup', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ source: 'local-before-synthetic-test-cleanup', store }) });
  } catch {
    return { store, message: 'Limpeza local bloqueada: backup prévio indisponível.' };
  }
  if (!backupResponse.ok) return { store, message: 'Limpeza local bloqueada: backup prévio não foi criado.' };
  let next = store;
  removable.forEach(patient => { next = deletePsychologyPatientLocally(next, patient.id).store; });
  window.localStorage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serializePsychologyStore(next));
  const backup = await backupResponse.json() as { fileName?: string };
  return { store: next, message: blocked ? 'Limpeza parcial concluída; um fingerprint foi preservado para revisão.' : `Limpeza local concluída antes da prévia. Backup: ${backup.fileName || 'criado em Downloads'}.` };
}

type MovableDialogPosition = { x: number; y: number };

function useMovableDialog() {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [position, setPosition] = useState<MovableDialogPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getBounds = useCallback(() => {
    const rect = dialogRef.current?.getBoundingClientRect();
    const width = rect?.width || Math.min(window.innerWidth - 24, 640);
    const height = rect?.height || Math.min(window.innerHeight - 24, 720);
    return { width, height };
  }, []);

  const clampPosition = useCallback((next: MovableDialogPosition): MovableDialogPosition => {
    const { width, height } = getBounds();
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.min(Math.max(8, next.x), maxX),
      y: Math.min(Math.max(8, next.y), maxY),
    };
  }, [getBounds]);

  const centerPosition = useCallback((): MovableDialogPosition => {
    const { width, height } = getBounds();
    return clampPosition({
      x: (window.innerWidth - width) / 2,
      y: Math.min(window.innerHeight * 0.16, (window.innerHeight - height) / 2),
    });
  }, [clampPosition, getBounds]);

  useEffect(() => {
    if (!dialogRef.current || position) return;
    setPosition(centerPosition());
  }, [centerPosition, position]);

  useEffect(() => {
    const handleResize = () => setPosition(current => current ? clampPosition(current) : current);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea, a, [role="tab"], [data-no-dialog-drag]')) return;
    const element = dialogRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }));
  }, [clampPosition]);

  const finishPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const positionStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y, transform: 'none' }
    : { left: '50%', top: '16vh', transform: 'translateX(-50%)' };
  const dragHandleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture: finishPointer,
  };

  return { dialogRef, positionStyle, dragHandleProps, isDragging };
}

function MovableDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { dialogRef, positionStyle, dragHandleProps, isDragging } = useMovableDialog();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/45" role="dialog" aria-modal="true">
      <section ref={dialogRef} style={positionStyle} className={`absolute ${wide ? 'max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-4xl overflow-visible' : 'max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto'} rounded-3xl bg-white shadow-2xl`}>
        <header {...dragHandleProps} data-testid="psychology-dialog-drag-handle" className={`sticky top-0 z-10 flex select-none items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
          <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Arraste para mover</p><h2 className="text-lg font-black text-slate-900">{title}</h2></div>
          <button type="button" data-no-dialog-drag onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <div className={wide ? 'p-5 md:p-6' : 'p-5'}>{children}</div>
      </section>
    </div>
  );
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <MovableDialog title={title} onClose={onClose} wide={wide}>{children}</MovableDialog>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-600">{label}</span>{children}{error && <span className="block text-xs font-semibold text-red-600">{error}</span>}</label>;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-600 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50';
const compactPrimaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const compactSecondaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50';
const psychologySettingsContainerClass = 'mx-auto w-full max-w-[96rem] space-y-5';
const psychologySettingsTabClass = 'flex min-h-[4.5rem] min-w-[10rem] flex-col justify-center rounded-xl border px-3 py-2.5 text-center transition focus:outline-none focus:ring-2 focus:ring-violet-300 sm:min-h-[5rem] sm:min-w-0 sm:px-3 sm:py-3';
const psychologySettingsTabLabelClass = 'block break-words text-xs font-black leading-tight sm:text-sm';
const psychologySettingsTabDescriptionClass = 'mt-1 block text-[11px] font-semibold leading-snug sm:text-xs';

function StatusPill({ status, previewStatus, compact = false, style, labelOverride }: { status: PsychologySessionStatus; previewStatus?: PsychologySession['previewStatus']; compact?: boolean; style?: { backgroundColor: string; borderColor: string; color: string }; labelOverride?: string }) {
  const styles: Record<PsychologySessionStatus, string> = {
    agendada: 'bg-amber-50 text-amber-700', realizada: 'bg-emerald-50 text-emerald-700',
    falta: 'bg-rose-50 text-rose-700', cancelada: 'bg-slate-100 text-slate-600',
  };
  const statusFullLabel = previewStatus === 'LEGACY_ATTENDANCE_UNKNOWN' ? 'Histórico — comparecimento não informado' : previewStatus === 'CANCELLED' ? 'Cancelada' : statusLabel[status];
  const fullLabel = labelOverride || statusFullLabel;
  const label = labelOverride || (compact && previewStatus === 'LEGACY_ATTENDANCE_UNKNOWN' ? 'Histórico' : statusFullLabel);
  const className = labelOverride || previewStatus !== 'LEGACY_ATTENDANCE_UNKNOWN' ? styles[status] : 'bg-slate-100 text-slate-600';
  return <span title={fullLabel} aria-label={fullLabel} className={`rounded-full whitespace-nowrap ${compact ? 'px-1.5 py-0.5 text-[9px] leading-none' : 'px-2.5 py-1 text-[11px]'} font-black ${style ? 'border' : ''} ${className}`} style={style}>{label}</span>;
}

function RemoteProviderState({ loading }: { loading: boolean }) {
  if (loading) {
    return <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-10 text-center" role="status" data-testid="psychology-remote-loading-state"><p className="text-lg font-black text-sky-950">Carregando dados da Psicologia...</p><p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-sky-800">Aguarde a leitura autenticada do provider remoto antes de consultar ou salvar pacientes.</p></div>;
  }
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-10 text-center" role="alert" data-testid="psychology-remote-error-state"><p className="text-lg font-black text-rose-950">Não foi possível carregar os dados da Psicologia.</p><p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-rose-800">Nenhum dado local será usado como fallback e as gravações permanecem bloqueadas.</p></div>;
}

export default function PsychologyPilot({ runtimeMode }: { runtimeMode: PsychologyRuntimeMode }) {
  const [localStore, setLocalStore] = useState<PsychologyStore>(loadLocalStore);
  const remoteConfiguration = useMemo(() => {
    const env = import.meta.env as unknown as Record<string, unknown>;
    const professionalId = String(env.VITE_PSYCHOLOGY_PROFESSIONAL_ID || LOCAL_PSYCHOLOGY_PROFESSIONAL_ID).trim() || LOCAL_PSYCHOLOGY_PROFESSIONAL_ID;
    const workspaceId = String(env.VITE_PSYCHOLOGY_WORKSPACE_ID || 'psychology-remote-workspace').trim() || 'psychology-remote-workspace';
    return {
      enabled: isPsychologyRemoteClientEnabled(runtimeMode),
      scope: createPsychologyPersistenceScope(professionalId, workspaceId),
    };
  }, [runtimeMode]);
  const remoteClient = useMemo(() => remoteConfiguration.enabled
    ? createPsychologyRemotePatientClient({ scope: remoteConfiguration.scope, api: {} })
    : null, [remoteConfiguration]);
  const [remoteStore, setRemoteStore] = useState<PsychologyStore | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(remoteConfiguration.enabled);
  const [remoteError, setRemoteError] = useState('');
  const publicBookingRepository = useMemo(() => typeof window === 'undefined' ? null : createLocalPublicBookingRepository({ storage: window.localStorage }), []);
  const [publicBookingSettings, setPublicBookingSettings] = useState<PublicBookingSettings | null>(null);
  const [doctoraliaPreview, setDoctoraliaPreview] = useState<PsychologyDoctoraliaPreview | null>(null);
  const [hiddenDoctoraliaCancelledEventIds, setHiddenDoctoraliaCancelledEventIds] = useState<string[]>(loadHiddenDoctoraliaCancelledEventIds);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewLoadError, setPreviewLoadError] = useState('');
  const store = remoteConfiguration.enabled
    ? remoteStore || createEmptyPsychologyStore(createPsychologyScope(remoteConfiguration.scope.professionalId))
    : doctoraliaPreview?.store || localStore;
  const isPreview = Boolean(doctoraliaPreview);
  const [page, setPage] = useState<PsychologyPage>('agenda');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [sessionDefaults, setSessionDefaults] = useState({ date: today(), time: '09:00' });
  const [agendaWeekStart, setAgendaWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [search, setSearch] = useState('');
  const normalizedPatientSearch = useMemo(() => normalizePsychologyPhoneForSearch(search) || search, [search]);
  const [notice, setNotice] = useState('');
  const [patientDialog, setPatientDialog] = useState<PsychologyPatient | 'new' | null>(null);
  const [sessionDialog, setSessionDialog] = useState<PsychologySession | 'new' | null>(null);
  const [recordDialog, setRecordDialog] = useState<PsychologySession | null>(null);
  const [sessionActions, setSessionActions] = useState<PsychologySession | null>(null);
  const [newEventDialog, setNewEventDialog] = useState<NewEventDefaults | null>(null);
  const [patientChart, setPatientChart] = useState<PsychologyPatient | null>(null);
  const [patientDelete, setPatientDelete] = useState<PsychologyPatient | null>(null);
  const [cancelledPreviewRemoval, setCancelledPreviewRemoval] = useState<PsychologySession | null>(null);
  const [previewEndConfirmation, setPreviewEndConfirmation] = useState(false);
  const [sessionPatientId, setSessionPatientId] = useState<string | undefined>();
  const runtimeIdentity = useMemo(() => resolvePsychologyRuntimeIdentity({
    scope: createPsychologyPersistenceScope(store.scope.professionalId, remoteConfiguration.scope.workspaceId),
    presentationProfile: store.settings.professionalProfile,
  }), [remoteConfiguration.scope.workspaceId, store.scope.professionalId, store.settings.professionalProfile]);

  useEffect(() => {
    if (!remoteConfiguration.enabled || !remoteClient) return;
    let disposed = false;
    setRemoteLoading(true);
    setRemoteError('');
    void remoteClient.load()
      .then(next => { if (!disposed) setRemoteStore(next); })
      .catch(cause => { if (!disposed) setRemoteError(cause instanceof Error ? cause.message : 'Provider remoto da Psicologia indisponível.'); })
      .finally(() => { if (!disposed) setRemoteLoading(false); });
    return () => { disposed = true; };
  }, [remoteClient, remoteConfiguration.enabled]);

  useEffect(() => {
    let disposed = false;
    const loadPreview = async () => {
      if (remoteConfiguration.enabled) {
        if (!disposed) setPreviewLoading(false);
        return;
      }
      try {
        const preparation: { store: PsychologyStore; message?: string } = import.meta.env.DEV ? await cleanAuthorizedSyntheticPatients(localStore) : { store: localStore };
        const baseStore = preparation.store;
        if (preparation.message && !disposed) setNotice(preparation.message);
        if (baseStore !== localStore && !disposed) setLocalStore(baseStore);
        if (window.localStorage.getItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY) === '1' || window.sessionStorage.getItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY) === '1') return;
      } catch (cause) {
        if (!disposed) setPreviewLoadError(cause instanceof Error ? cause.message : 'Prévia Doctoralia indisponível.');
      } finally {
        if (!disposed) setPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => { disposed = true; };
  }, [remoteConfiguration.enabled]);

  useEffect(() => {
    if (remoteConfiguration.enabled || doctoraliaPreview) return;
    try {
      window.localStorage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serializePsychologyStore(localStore));
    } catch {
      setNotice('O navegador não permitiu salvar localmente. O fluxo continua disponível nesta tela.');
    }
  }, [doctoraliaPreview, localStore, remoteConfiguration.enabled]);

  useEffect(() => {
    if (!publicBookingRepository || page !== 'agenda') return;
    let disposed = false;
    void publicBookingRepository.getSettings().then(value => { if (!disposed) setPublicBookingSettings(value); });
    return () => { disposed = true; };
  }, [page, publicBookingRepository]);

  const patientMap = useMemo(() => new Map(store.patients.map(patient => [patient.id, patient])), [store.patients]);
  const dayItems = useMemo(() => getPsychologyDayItems(store, selectedDate), [selectedDate, store]);
  const agendaPersonalOccurrences = useMemo(() => getPsychologyPersonalOccurrences(store, agendaWeekStart, addDays(agendaWeekStart, 6)), [agendaWeekStart, store]);
  const visiblePatients = useMemo(() => getPsychologyPatientListViewModels(store, store.patients), [store]);
  const daySessions = useMemo(() => {
    if (!doctoraliaPreview) return store.sessions;
    const start = format(startOfWeek(new Date(`${selectedDate}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = format(endOfWeek(new Date(`${selectedDate}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return getDoctoraliaPreviewSessionsForRange(doctoraliaPreview, start, end);
  }, [doctoraliaPreview, selectedDate, store.sessions]);
  const agendaSessions = useMemo(() => doctoraliaPreview
    ? getDoctoraliaPreviewSessionsForRange(doctoraliaPreview, format(agendaWeekStart, 'yyyy-MM-dd'), format(addDays(agendaWeekStart, 6), 'yyyy-MM-dd'))
    : store.sessions, [agendaWeekStart, doctoraliaPreview, store.sessions]);
  const visibleAgendaSessions = useMemo(() => {
    if (!doctoraliaPreview || hiddenDoctoraliaCancelledEventIds.length === 0) return agendaSessions;
    const hiddenIds = new Set(hiddenDoctoraliaCancelledEventIds);
    return agendaSessions.filter(session => !hiddenIds.has(session.id));
  }, [agendaSessions, doctoraliaPreview, hiddenDoctoraliaCancelledEventIds]);
  const recordsBySession = useMemo(() => new Set(store.sessionRecords.map(record => record.sessionId)), [store.sessionRecords]);

  const persistedMutationLocks = useRef(new Set<string>());
  const updateStore = (next: PsychologyStore): boolean => {
    if (remoteConfiguration.enabled) {
      setNotice('Provider remoto ativo: esta ação ainda não está disponível neste painel.');
      return false;
    }
    if (doctoraliaPreview) {
      setNotice('Prévia Doctoralia — edição desabilitada. Encerre a prévia para voltar ao piloto local.');
      return false;
    }
    let serialized: string;
    try {
      serialized = serializePsychologyStore(next);
    } catch {
      setNotice('O navegador não permitiu salvar localmente. Nenhuma alteração foi confirmada.');
      return false;
    }
    if (persistedMutationLocks.current.has(serialized)) return false;
    persistedMutationLocks.current.add(serialized);
    try {
      window.localStorage.setItem(`${LOCAL_PSYCHOLOGY_STORAGE_KEY}:${LOCAL_PSYCHOLOGY_PROFESSIONAL_ID}`, serialized);
      setLocalStore(next);
      setNotice('');
      return true;
    } catch {
      setNotice('O navegador não permitiu salvar localmente. Nenhuma alteração foi confirmada.');
      return false;
    } finally {
      queueMicrotask(() => persistedMutationLocks.current.delete(serialized));
    }
  };

  const updateSettingsStore = (next: PsychologyStore): boolean | Promise<boolean> => {
    if (!remoteConfiguration.enabled) return updateStore(next);
    if (!remoteClient || remoteLoading || remoteError) {
      setNotice('Aguarde o carregamento do provider remoto antes de salvar Ajustes.');
      return false;
    }
    return remoteClient.updateSettings(next.settings)
      .then(saved => {
        setRemoteStore(current => current ? { ...current, settings: saved, services: saved.services, locations: saved.locations } : current);
        setNotice('Ajustes salvos no provider remoto.');
        return true;
      })
      .catch(cause => {
        setNotice(cause instanceof Error ? cause.message : 'Não foi possível salvar os Ajustes no provider remoto.');
        return false;
      });
  };

  const generatePsychologyBackup: PsychologyBackupGenerator = async () => {
    return requestAuthenticatedPsychologyBackup();
  };

  const parentMutationLocks = useRef(new Set<string>());
  const runParentMutation = (key: string, action: () => boolean): boolean => {
    if (parentMutationLocks.current.has(key)) return false;
    parentMutationLocks.current.add(key);
    try {
      return action();
    } finally {
      queueMicrotask(() => parentMutationLocks.current.delete(key));
    }
  };

  const openPage = (next: PsychologyPage) => {
    setPage(next);
    setNotice('');
  };

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMoreOpen]);

  const openNewEvent = (date = selectedDate, time = '09:00', kind: NewEventKind = 'session') => {
    if (doctoraliaPreview) {
      setNotice('Prévia Doctoralia — novos pacientes e novas sessões estão desabilitados.');
      return;
    }
    setSelectedDate(date);
    setSessionDefaults({ date, time });
    setNewEventDialog({ date, time, kind });
  };

  const applyPublicBookingQuickAction = async (action: PublicBookingQuickAction) => {
    if (doctoraliaPreview) {
      setNotice('Prévia Doctoralia — alterações de disponibilidade estão desabilitadas.');
      return;
    }
    if (!publicBookingRepository) return;
    const current = publicBookingSettings || await publicBookingRepository.getSettings();
    if (!current) {
      setNotice('A configuração do agendamento online ainda não está disponível.');
      return;
    }
    let nextExceptions: PublicBookingException[];
    if (action.kind === 'UNBLOCK') {
      const matchingException = current.publicBookingExceptions.find(exception => action.exceptionId
        ? exception.id === action.exceptionId
        : exception.civilDate === action.civilDate
          && (!action.type || exception.type === action.type)
          && (!action.startTime || exception.startTime === action.startTime)
          && (!action.endTime || exception.endTime === action.endTime));
      nextExceptions = matchingException
        ? current.publicBookingExceptions.filter(exception => exception.id !== matchingException.id)
        : current.publicBookingExceptions;
    } else {
    const retained = current.publicBookingExceptions.filter(exception => exception.civilDate !== action.civilDate || (action.kind !== 'BLOCK_DAY' && exception.type !== 'BLOCK_DAY'));
    const nextException = action.kind === 'BLOCK_DAY'
      ? createPublicBookingException({ professionalId: current.professionalId, civilDate: action.civilDate, type: 'BLOCK_DAY' })
      : createPublicBookingException({ professionalId: current.professionalId, civilDate: action.civilDate, type: action.kind, startTime: action.startTime, endTime: action.endTime });
      nextExceptions = [...retained, nextException];
    }
    const next = await publicBookingRepository.updateSettings({ publicBookingExceptions: nextExceptions });
    setPublicBookingSettings(next);
    setNotice(action.kind === 'UNBLOCK' ? 'Horário liberado para agendamento online.' : action.kind === 'BLOCK_DAY' ? 'Dia bloqueado para novos agendamentos.' : action.kind === 'OPEN_PERIOD' ? 'Horário disponibilizado excepcionalmente para agendamento online.' : 'Horário bloqueado para novos agendamentos.');
  };

  const endDoctoraliaPreview = () => {
    window.sessionStorage.removeItem(DOCTORALIA_PREVIEW_STORAGE_KEY);
    window.sessionStorage.removeItem(DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY);
    window.localStorage.setItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY, '1');
    window.sessionStorage.setItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY, '1');
    setHiddenDoctoraliaCancelledEventIds([]);
    setDoctoraliaPreview(null);
    setPreviewLoadError('');
    setNotice('Prévia Doctoralia encerrada. O piloto local original foi restaurado.');
  };

  const requestEndDoctoraliaPreview = () => setPreviewEndConfirmation(true);

  const requestHideCancelledPreviewSession = (session: PsychologySession) => {
    if (!doctoraliaPreview || session.status !== 'cancelada') return;
    setCancelledPreviewRemoval(session);
  };

  const confirmHideCancelledPreviewSession = () => {
    if (!cancelledPreviewRemoval || !doctoraliaPreview) return;
    const nextIds = [...new Set([...hiddenDoctoraliaCancelledEventIds, cancelledPreviewRemoval.id])];
    window.sessionStorage.setItem(DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY, serializeDoctoraliaPreviewHiddenCancelledEventIds(nextIds));
    setHiddenDoctoraliaCancelledEventIds(nextIds);
    setCancelledPreviewRemoval(null);
    setNotice('Consulta cancelada ocultada somente desta prévia. O backup Doctoralia permanece intacto.');
  };

  const restoreHiddenDoctoraliaCancelledEvents = () => {
    window.sessionStorage.removeItem(DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY);
    setHiddenDoctoraliaCancelledEventIds([]);
    setNotice('Consultas canceladas ocultadas foram restauradas na Agenda da prévia.');
  };

  const activateDoctoraliaPreview = async () => {
    setPreviewLoading(true);
    setPreviewLoadError('');
    try {
      window.sessionStorage.removeItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY);
      window.localStorage.removeItem(DOCTORALIA_PREVIEW_OPT_OUT_STORAGE_KEY);
      const response = await fetch('/api/psychology-doctoralia-preview', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Os CSVs Doctoralia não estão disponíveis para a prévia local.');
      const payload = await response.json() as DoctoraliaPreviewPayload;
      const preview = createDoctoraliaPreview(payload, localStore);
      window.sessionStorage.setItem(DOCTORALIA_PREVIEW_STORAGE_KEY, serializeDoctoraliaPreviewBundle(preview.bundle));
      window.sessionStorage.removeItem(DOCTORALIA_PREVIEW_HIDDEN_CANCELLED_STORAGE_KEY);
      setHiddenDoctoraliaCancelledEventIds([]);
      setDoctoraliaPreview(preview);
    } catch (cause) {
      setPreviewLoadError(cause instanceof Error ? cause.message : 'Não foi possível ativar a prévia Doctoralia.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const requestPatientDelete = (patient: PsychologyPatient) => {
    if (isPreview) {
      setNotice('Dados da prévia Doctoralia são somente leitura.');
      return;
    }
    setPatientDelete(patient);
  };

  const confirmPatientDelete = (): boolean | Promise<boolean> => {
    if (!patientDelete) return false;
    if (remoteConfiguration.enabled) {
      if (!remoteClient || remoteLoading || remoteError) {
        setNotice('Aguarde o carregamento do provider remoto antes de excluir.');
        return false;
      }
      const patientId = patientDelete.id;
      return remoteClient.deletePatient(patientId)
        .then(result => {
          if (!result.deleted) {
            setPatientDelete(null);
            setNotice(result.reason || 'Este paciente não pôde ser excluído definitivamente.');
            return false;
          }
          setRemoteStore(current => current ? patientStoreWithoutIds(current, [patientId]) : current);
          setPatientDelete(null);
          setPatientChart(null);
          setNotice('Paciente e dados vinculados removidos definitivamente pelo provider remoto.');
          return true;
        })
        .catch(cause => {
          setNotice(cause instanceof Error ? cause.message : 'Não foi possível excluir o paciente no provider remoto.');
          return false;
        });
    }
    const result = deletePsychologyPatientLocally(store, patientDelete.id);
    if (!result.removed) {
      setPatientDelete(null);
      setNotice(result.assessment.reason || 'Este paciente não pôde ser excluído definitivamente.');
      return false;
    }
    if (updateStore(result.store)) {
      setPatientDelete(null);
      setPatientChart(null);
      setNotice('Paciente e dados vinculados removidos definitivamente do ambiente local.');
      return true;
    }
    return false;
  };

  const updatePatientReview = (patientIds: string[], inReview: boolean): boolean | Promise<boolean> => {
    if (isPreview) {
      setNotice('Dados da prévia Doctoralia são somente leitura.');
      return false;
    }
    if (remoteConfiguration.enabled) {
      if (!remoteClient || remoteLoading || remoteError) {
        setNotice('Aguarde o carregamento do provider remoto antes de atualizar a revisão.');
        return false;
      }
      return remoteClient.updatePatientReview(patientIds, inReview)
        .then(patients => {
          setRemoteStore(current => current ? patientStoreWithUpdates(current, patients) : current);
          return true;
        })
        .catch(cause => {
          setNotice(cause instanceof Error ? cause.message : 'Não foi possível atualizar Em revisão no provider remoto.');
          return false;
        });
    }
    const ids = new Set(patientIds);
    const markedAt = new Date().toISOString();
    const next = {
      ...store,
      patients: store.patients.map(patient => ids.has(patient.id)
        ? { ...patient, inReview, reviewMarkedAt: inReview ? markedAt : undefined, updatedAt: markedAt }
        : patient),
    };
    return updateStore(next);
  };

  const processBulkPatientDeletion = async (patientIds: string[]): Promise<PsychologyBulkDeletionSummary> => {
    if (isPreview) return { processed: 0, deleted: 0, failed: patientIds.length };
    const uniquePatientIds = [...new Set(patientIds.filter(Boolean))];
    if (remoteConfiguration.enabled) {
      if (!remoteClient || remoteLoading || remoteError) return { processed: uniquePatientIds.length, deleted: 0, failed: uniquePatientIds.length, failedIds: uniquePatientIds };
      return remoteClient.deletePatients(uniquePatientIds)
        .then(result => {
          setRemoteStore(current => current ? patientStoreWithoutIds(current, result.deletedIds) : current);
          return {
            processed: uniquePatientIds.length,
            deleted: result.summary.deleted,
            failed: result.summary.failed,
            deletedIds: result.deletedIds,
            failedIds: result.failedIds,
          };
        })
        .catch(error => {
          console.error('Falha ao processar exclusão coletiva remota:', error);
          return { processed: uniquePatientIds.length, deleted: 0, failed: uniquePatientIds.length, failedIds: uniquePatientIds };
        });
    }
    let next = store;
    const results = await allSettledWithConcurrency(uniquePatientIds, PSYCHOLOGY_BULK_DELETE_CONCURRENCY, async patientId => {
      // The local store mutation itself is synchronous; the shared helper keeps
      // the same bounded, no-retry contract as the remote provider.
      const result = deletePsychologyPatientLocally(next, patientId);
      if (!result.removed) throw new Error(result.assessment.reason || 'Paciente não pôde ser excluído.');
      next = result.store;
      return { id: patientId };
    });
    const deletedIds = results.flatMap(result => result.status === 'fulfilled' ? [result.value.id] : []);
    const failedIds = results.flatMap((result, index) => result.status === 'rejected' ? [uniquePatientIds[index]] : []);
    const deleted = deletedIds.length;
    const failed = failedIds.length;

    if (next !== store && !updateStore(next)) {
      return { processed: uniquePatientIds.length, deleted: 0, failed: uniquePatientIds.length, failedIds: uniquePatientIds };
    }
    return { processed: uniquePatientIds.length, deleted, failed, deletedIds, failedIds };
  };

  const savePatient = (input: PsychologyPatientInput): boolean | Promise<boolean> => {
    const isNew = patientDialog === 'new';
    if (remoteConfiguration.enabled) {
      if (!remoteClient || remoteLoading || remoteError) {
        setNotice('Aguarde o carregamento do provider remoto antes de salvar.');
        return false;
      }
      const nextStore = upsertPsychologyPatient(store, input, isNew ? undefined : patientDialog?.id);
      const nextPatient = isNew ? nextStore.patients[nextStore.patients.length - 1] : nextStore.patients.find(patient => patient.id === patientDialog?.id);
      if (!nextPatient) return false;
      return remoteClient.updatePatient(nextPatient)
        .then(savedPatient => {
          setRemoteStore(current => current ? patientStoreWithUpdates(current, [savedPatient]) : current);
          setPatientDialog(null);
          setPatientChart(savedPatient);
          setNotice(isNew ? 'Paciente criado no provider remoto. A ficha está pronta para agendar a primeira sessão.' : 'Paciente atualizado no provider remoto.');
          return true;
        })
        .catch(cause => {
          setNotice(cause instanceof Error ? cause.message : 'Não foi possível salvar o paciente no provider remoto.');
          return false;
        });
    }
    return runParentMutation(`patient:${isNew ? 'new' : patientDialog?.id || 'unknown'}:${input.name}:${input.dateOfBirth || input.birthDate || ''}`, () => {
      const nextStore = upsertPsychologyPatient(store, input, isNew ? undefined : patientDialog?.id);
      if (!updateStore(nextStore)) return false;
      const savedPatient = isNew ? nextStore.patients[nextStore.patients.length - 1] : undefined;
      setPatientDialog(null);
      if (savedPatient) setPatientChart(savedPatient);
      setNotice(isNew ? 'Paciente criado. A ficha está pronta para agendar a primeira sessão.' : 'Paciente atualizado.');
      return true;
    });
  };

  const saveSession = (input: PsychologySessionInput): boolean => {
    const isNew = sessionDialog === 'new';
    return runParentMutation(`session:${isNew ? 'new' : sessionDialog?.id || 'unknown'}:${input.patientId}:${input.date}:${input.time}`, () => {
      if (!updateStore(upsertPsychologySession(store, input, isNew ? undefined : sessionDialog?.id))) return false;
      setSelectedDate(input.date);
      setSessionDialog(null);
      setSessionPatientId(undefined);
      setPage('agenda');
      setNotice(isNew ? 'Sessão agendada neste ambiente local.' : 'Sessão atualizada.');
      return true;
    });
  };

  const saveNewSession = (input: PsychologySessionInput): boolean => {
    return runParentMutation(`new-session:${input.patientId}:${input.date}:${input.time}`, () => {
      if (!updateStore(upsertPsychologySession(store, input))) return false;
      setSelectedDate(input.date);
      setNewEventDialog(null);
      setPage('agenda');
      setNotice('Sessão agendada neste ambiente local.');
      return true;
    });
  };

  const savePersonal = (input: PsychologyPersonalInput): boolean => {
    return runParentMutation(`personal:${input.date}:${input.time}:${input.title}:${input.type}`, () => {
      if (!updateStore(upsertPsychologyPersonalCommitment(store, input))) return false;
      setSelectedDate(input.date);
      setNewEventDialog(null);
      setPage('agenda');
      setNotice('Compromisso salvo neste ambiente local.');
      return true;
    });
  };

  const saveRecord = (text: string): boolean => {
    return runParentMutation(`record:${recordDialog?.id || ''}:${text}`, () => {
      if (!updateStore(savePsychologySessionRecord(store, recordDialog?.id || '', text))) return false;
      setRecordDialog(null);
      setNotice('Registro da sessão salvo com proteção local.');
      return true;
    });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900" data-testid="psychology-pilot">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6 sm:py-3">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-700 text-white shadow-sm sm:h-11 sm:w-11 sm:rounded-2xl"><UserRound size={19} className="sm:h-[22px] sm:w-[22px]" /></div>
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-violet-700">Gestão Clínica</p><h1 className="text-base font-black leading-tight sm:text-xl" data-testid="psychology-professional-header" aria-label={`${runtimeIdentity.profile.displayName} — ${runtimeIdentity.profile.professionalTitle}`}><span className="sm:hidden">Psicologia</span><span className="hidden truncate sm:inline">{runtimeIdentity.profile.displayName} — {runtimeIdentity.profile.professionalTitle}</span></h1></div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3"><span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black tracking-wide text-violet-700 sm:px-3 sm:py-2 sm:text-xs" data-testid="psychology-environment-badge">{remoteConfiguration.enabled ? <><span className="sm:hidden">REMOTO</span><span className="hidden sm:inline">Provider remoto</span></> : <><span className="sm:hidden">PILOTO</span><span className="hidden sm:inline">Piloto local</span></>}</span><a href="/" className={`${secondaryButton} psychology-desktop-link`}><ArrowLeft size={15} /> Gestão Clínica</a>{page !== 'day' && <button type="button" onClick={() => openPage('day')} aria-label="Voltar para Meu Dia" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 sm:hidden"><ArrowLeft size={19} /></button>}</div>
        </div>
      </header>

      {doctoraliaPreview && <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-amber-950 sm:px-6" role="status" data-testid="doctoralia-preview-banner"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2"><p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.12em] text-amber-800" title="Dados reais carregados somente neste ambiente local. Nenhuma informação foi migrada ou sincronizada.">PRÉVIA DOCTORALIA <span className="font-bold normal-case tracking-normal text-amber-900">· somente local · não migrado</span></p><button type="button" onClick={requestEndDoctoraliaPreview} className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-amber-900 hover:bg-amber-100">Encerrar prévia</button></div></div>}
      {remoteConfiguration.enabled && <div className="border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-sky-950 sm:px-6" role="status" data-testid="psychology-remote-provider-banner"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2"><p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.12em] text-sky-800">PROVIDER REMOTO <span className="font-bold normal-case tracking-normal text-sky-900">· fonte autenticada da Psicologia</span></p><span className="shrink-0 text-[11px] font-black">{remoteLoading ? 'Carregando…' : remoteError ? 'Indisponível' : 'Disponível'}</span></div></div>}

      <div className="psychology-mobile-content flex w-full flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8 lg:py-5">
        <aside className="hidden md:block lg:w-60 lg:shrink-0">
          <div className="mb-3 rounded-2xl border border-violet-100 bg-violet-50 p-3 text-xs text-violet-900"><p className="font-black">Contexto Psicologia</p><p className="mt-1 leading-relaxed text-violet-700">{remoteConfiguration.enabled ? 'Dados do provider remoto, escopados pelo profissional autenticado.' : 'Dados locais deste piloto, separados por profissional.'}</p></div>
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1" aria-label="Navegação da Psicologia">
            {([['day', 'Meu Dia', CalendarDays], ['patients', 'Pacientes', UsersRound], ['agenda', 'Agenda', CalendarDays], ['personal', 'Agenda Pessoal', Menu], ['finance', 'Financeiro', WalletCards], ['reports', 'Relatórios', FileText], ['settings', 'Ajustes', Pencil]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => openPage(id)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-black transition ${page === id ? 'bg-violet-700 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100'}`}><Icon size={17} />{label}</button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
             <div><p className="text-xs font-bold capitalize text-slate-500">{formatDate(selectedDate)}</p><h2 className="mt-0.5 text-xl font-black tracking-tight">{page === 'day' ? 'Meu Dia' : page === 'patients' ? 'Pacientes' : page === 'agenda' ? 'Agenda' : page === 'personal' ? 'Agenda Pessoal' : page === 'finance' ? 'Financeiro' : page === 'reports' ? 'Relatórios' : 'Ajustes'}</h2>{page !== 'agenda' && <p className="mt-1 max-w-2xl text-xs text-slate-500">{page === 'day' ? 'Veja o que tem hoje e o que precisa da sua atenção.' : page === 'finance' ? 'Acompanhe recebimentos, pendências e despesas.' : page === 'reports' ? 'Analise seus atendimentos, agenda, pacientes e movimentação financeira.' : page === 'settings' ? 'Configure seu atendimento, serviços, locais e cores.' : 'Um espaço simples para organizar sua rotina.'}</p>}</div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button type="button" onClick={() => setPatientDialog('new')} disabled={isPreview} title={isPreview ? 'Edição desabilitada nesta prévia' : undefined} className={`${compactPrimaryButton} min-h-11 px-3 text-[11px] sm:min-h-0 sm:px-3 sm:text-xs`}><Plus size={14} /> Novo paciente</button>
              {page !== 'agenda' && <button type="button" onClick={() => openNewEvent()} disabled={isPreview} title={isPreview ? 'Edição desabilitada nesta prévia' : undefined} className={`${compactSecondaryButton} min-h-11 px-3 text-[11px] sm:min-h-0 sm:px-3 sm:text-xs`}><CalendarDays size={14} /> Agendar sessão</button>}
              <button type="button" onClick={() => openNewEvent(selectedDate, '09:00', 'personal')} className={`${compactSecondaryButton} col-span-2 min-h-11 px-3 text-[11px] sm:col-span-auto sm:min-h-0 sm:px-3 sm:text-xs`}><Plus size={14} /> Novo compromisso pessoal</button>
            </div>
          </div>

          {notice && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" role="status">{notice}</div>}

           {page === 'day' && <DayView date={selectedDate} setDate={setSelectedDate} store={store} sessions={daySessions} settings={store.settings} onSchedule={() => openNewEvent()} onPersonal={() => openNewEvent(selectedDate, '09:00', 'personal')} onOpenSession={setSessionActions} />}
           {page === 'patients' && remoteConfiguration.enabled && (remoteLoading || remoteError) ? <RemoteProviderState loading={remoteLoading} /> : page === 'patients' && <PatientsView rows={visiblePatients} search={search} searchKey={normalizedPatientSearch} setSearch={setSearch} onNew={() => { if (isPreview) { setNotice('Edição desabilitada nesta prévia.'); return; } setPatientDialog('new'); }} onEdit={(patient) => { if (isPreview) { setNotice('Edição desabilitada nesta prévia.'); return; } setPatientDialog(patient); }} onOpen={setPatientChart} onDelete={requestPatientDelete} onSetReview={updatePatientReview} onBulkDelete={processBulkPatientDeletion} preview={doctoraliaPreview} />}
            {page === 'agenda' && <AgendaView sessions={visibleAgendaSessions} personalCommitments={agendaPersonalOccurrences} patientMap={patientMap} settings={store.settings} publicBookingSettings={publicBookingSettings || undefined} weekStart={agendaWeekStart} onPreviousWeek={() => setAgendaWeekStart(current => subWeeks(current, 1))} onNextWeek={() => setAgendaWeekStart(current => addWeeks(current, 1))} onToday={() => { setAgendaWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 })); }} onNew={openNewEvent} onPublicBookingAction={action => { void applyPublicBookingQuickAction(action); }} onOpenSession={setSessionActions} onRemoveCancelled={doctoraliaPreview ? requestHideCancelledPreviewSession : undefined} onOpenPersonal={(item) => { setSelectedDate(item.date); setPage('personal'); }} />}
           {page === 'personal' && <PsychologyPersonalAgenda commitments={store.personalCommitments} scope={store.scope} onPersist={(commitments) => updateStore({ ...store, personalCommitments: commitments })} />}
           {page === 'finance' && <PsychologyFinanceView store={store} onStoreChange={updateStore} onNotice={setNotice} />}
           {page === 'reports' && <PsychologyReportsView store={store} />}
          {page === 'settings' && <PsychologySettingsView store={store} settings={store.settings} patients={store.patients} sessionPackages={store.sessionPackages} onUpdatePackage={input => updateSettingsStore(upsertPsychologySessionPackage(store, input, undefined))} onUpdate={patch => updateSettingsStore(updatePsychologySettings(store, patch))} onUpdateLocation={(id, patch) => updateSettingsStore(updatePsychologyLocation(store, id, patch))} onCreateLocation={input => updateSettingsStore(createPsychologyLocation(store, input))} onSetLocationColor={(id, color) => updateSettingsStore(setPsychologyLocationColor(store, id, color))} onSetPrimary={id => updateSettingsStore(setPsychologyPrimaryLocation(store, id))} onSetActive={(id, active) => updateSettingsStore(setPsychologyLocationActive(store, id, active))} onSetColor={(category, color) => updateSettingsStore(setPsychologyCategoryColor(store, category, color))} onRestoreColors={() => updateSettingsStore(restorePsychologyDefaultColors(store))} preview={doctoraliaPreview} hiddenCancelledEventCount={hiddenDoctoraliaCancelledEventIds.length} onRestoreHiddenCancelled={restoreHiddenDoctoraliaCancelledEvents} previewLoading={previewLoading} previewLoadError={previewLoadError} onActivatePreview={activateDoctoraliaPreview} onEndPreview={requestEndDoctoraliaPreview} onGenerateBackup={remoteConfiguration.enabled ? generatePsychologyBackup : undefined} />}
        </main>
      </div>

      <nav className="psychology-bottom-nav md:hidden" aria-label="Navegação móvel da Psicologia" data-testid="psychology-bottom-nav">
        {([['day', 'Meu Dia', CalendarDays], ['patients', 'Pacientes', UsersRound], ['agenda', 'Agenda', CalendarDays]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => openPage(id)} aria-current={page === id ? 'page' : undefined} className={`psychology-bottom-nav-item ${page === id ? 'is-active' : ''}`}>
            <Icon size={20} strokeWidth={page === id ? 2.5 : 2} /><span>{label}</span>
          </button>
        ))}
        <button type="button" onClick={() => setMobileMoreOpen(true)} aria-expanded={mobileMoreOpen} aria-haspopup="dialog" className={`psychology-bottom-nav-item ${mobileMoreOpen || ['personal', 'finance', 'reports', 'settings'].includes(page) ? 'is-active' : ''}`} data-testid="psychology-more-button">
          <Menu size={20} strokeWidth={mobileMoreOpen ? 2.5 : 2} /><span>Mais</span>
        </button>
      </nav>

      {mobileMoreOpen && <div className="psychology-more-sheet-backdrop md:hidden" role="presentation" onClick={() => setMobileMoreOpen(false)}>
        <section className="psychology-more-sheet" role="dialog" aria-modal="true" aria-label="Mais opções da Psicologia" onClick={event => event.stopPropagation()}>
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Navegação</p><h2 className="mt-1 text-lg font-black text-slate-900">Mais opções</h2></div>
            <button type="button" onClick={() => setMobileMoreOpen(false)} aria-label="Fechar menu Mais" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
          </div>
          <div className="mt-4 grid gap-2">
            {([['personal', 'Agenda Pessoal', WalletCards], ['finance', 'Financeiro', DollarSign], ['reports', 'Relatórios', FileText], ['settings', 'Ajustes', Pencil]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => { openPage(id); setMobileMoreOpen(false); }} aria-current={page === id ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${page === id ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                <Icon size={19} className={page === id ? 'text-violet-700' : 'text-slate-500'} /><span>{label}</span>{page === id && <span className="ml-auto text-xs font-black text-violet-700">Atual</span>}
              </button>
            ))}
          </div>
        </section>
      </div>}

      {patientChart && <PsychologyPatientChart store={store} patientId={patientChart.id} previewDetails={doctoraliaPreview?.patientDetailsById.get(patientChart.id)} previewClinicalBackground={doctoraliaPreview?.bundle.clinicalBackgrounds.find(item => item.externalPatientId === doctoraliaPreview.patientDetailsById.get(patientChart.id)?.externalPatientId)} readOnly={isPreview} onClose={() => setPatientChart(null)} onDelete={requestPatientDelete} onEdit={(patient) => { if (isPreview) { setNotice('Edição desabilitada nesta prévia.'); return; } setPatientChart(null); setPatientDialog(patient); }} onSchedule={(patient) => { if (isPreview) { setNotice('Novas sessões estão desabilitadas nesta prévia.'); return; } setPatientChart(null); setSessionPatientId(patient.id); setSessionDefaults({ date: today(), time: '09:00' }); setSessionDialog('new'); }} onOpenSession={setSessionActions} onStoreChange={updateStore} onStatus={(sessionId, status) => updateStore(updatePsychologySessionStatus(store, sessionId, status))} onRecord={setRecordDialog} />}
      {previewEndConfirmation && <Dialog title="Encerrar prévia Doctoralia?" onClose={() => setPreviewEndConfirmation(false)}><p className="text-sm leading-relaxed text-slate-600">Os dados deixarão de aparecer temporariamente, mas os arquivos originais não serão alterados e a prévia poderá ser ativada novamente.</p><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setPreviewEndConfirmation(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setPreviewEndConfirmation(false); endDoctoraliaPreview(); }} className="inline-flex items-center justify-center rounded-xl bg-amber-700 px-4 py-3 text-sm font-black text-white hover:bg-amber-800">Encerrar prévia</button></div></Dialog>}
      {cancelledPreviewRemoval && <Dialog title="Remover consulta cancelada da Agenda?" onClose={() => setCancelledPreviewRemoval(null)}><p className="text-sm leading-relaxed text-slate-600">Ela será apenas ocultada desta prévia. O backup da Doctoralia não será alterado.</p><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setCancelledPreviewRemoval(null)} className={secondaryButton}>Cancelar</button><button type="button" onClick={confirmHideCancelledPreviewSession} className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-white hover:bg-slate-900">Remover da Agenda</button></div></Dialog>}
          {patientDialog && <PatientDialogR2F3E value={patientDialog === 'new' ? null : patientDialog} onClose={() => setPatientDialog(null)} onSave={savePatient} />}
          {patientDelete && <DeletePatientDialog assessment={getPsychologyPatientDeletionAssessment(store, patientDelete.id)} onClose={() => setPatientDelete(null)} onConfirm={confirmPatientDelete} />}
          {sessionDialog && <SessionDialog value={sessionDialog === 'new' ? null : sessionDialog} store={store} settings={store.settings} defaultPatientId={sessionDialog === 'new' ? sessionPatientId : undefined} defaultDate={sessionDialog === 'new' ? sessionDefaults.date : selectedDate} defaultTime={sessionDialog === 'new' ? sessionDefaults.time : undefined} onClose={() => { setSessionDialog(null); setSessionPatientId(undefined); }} onSave={saveSession} />}
          {newEventDialog && <EventCreationDialog defaults={newEventDialog} store={store} settings={store.settings} onClose={() => setNewEventDialog(null)} onNewPatient={() => setPatientDialog('new')} onSaveSession={saveNewSession} onSavePersonal={savePersonal} />}
          {recordDialog && <RecordDialog session={recordDialog} patient={patientMap.get(recordDialog.patientId)} existingText={store.sessionRecords.find(record => record.sessionId === recordDialog.id)?.text || ''} onClose={() => setRecordDialog(null)} onSave={saveRecord} />}
      {sessionActions && <SessionActionsDialog session={sessionActions} patient={patientMap.get(sessionActions.patientId)} hasRecord={recordsBySession.has(sessionActions.id)} onClose={() => setSessionActions(null)} onEdit={() => { setSessionDialog(sessionActions); setSessionActions(null); }} onStatus={(status) => { updateStore(updatePsychologySessionStatus(store, sessionActions.id, status)); setSessionActions(null); }} onRecord={() => { setRecordDialog(sessionActions); setSessionActions(null); }} readOnly={isPreview} />}
    </div>
  );
}

function sessionCategory(session: PsychologySession): PsychologyAgendaCategory {
  return agendaCategoryForSession(session);
}

function sessionLocationLabel(session: PsychologySession, settings: PsychologySettings): string {
  if (session.modality === 'online') return 'Online';
  return locationForSession(settings, session)?.displayName || 'Presencial';
}

function sessionBookingOriginLabel(session: PsychologySession): 'Agendado pelo Paciente' | 'Agendada' | '' {
  if (session.bookingOrigin === 'PATIENT_SELF_BOOKING') return 'Agendado pelo Paciente';
  if (session.bookingOrigin === 'PROFESSIONAL') return 'Agendada';
  return '';
}

function sessionColor(session: PsychologySession, settings: PsychologySettings): string {
  return colorForAgendaCategory(settings.colors, sessionCategory(session));
}

function DayView({ date, setDate, store, sessions, settings, onSchedule, onPersonal, onOpenSession }: { date: string; setDate: (date: string) => void; store: PsychologyStore; sessions: PsychologySession[]; settings: PsychologySettings; onSchedule: () => void; onPersonal: () => void; onOpenSession: (session: PsychologySession) => void }) {
  const patientMap = useMemo(() => new Map(store.patients.map(patient => [patient.id, patient])), [store.patients]);
  const todayAllSessions = sessions.filter(session => session.date === date && session.status !== 'cancelada').sort((a, b) => a.time.localeCompare(b.time));
  const todaySessions = todayAllSessions.filter(session => session.status === 'agendada');
  const tomorrow = format(addDays(new Date(`${date}T12:00:00`), 1), 'yyyy-MM-dd');
  const tomorrowSessions = sessions.filter(session => session.date === tomorrow && session.status === 'agendada').sort((a, b) => a.time.localeCompare(b.time));
  const todayPersonal = getPsychologyPersonalOccurrences(store, new Date(`${date}T00:00:00`), new Date(`${date}T23:59:59`)).sort((a, b) => a.time.localeCompare(b.time));
  const weekStart = format(startOfWeek(new Date(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(endOfWeek(new Date(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date(`${date}T12:00:00`)), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(new Date(`${date}T12:00:00`)), 'yyyy-MM-dd');
  const activePatients = store.patients.filter(patient => patient.active);
  const weeklySessions = sessions.filter(session => session.date >= weekStart && session.date <= weekEnd && session.status !== 'cancelada').length;
  const concluded = sessions.filter(session => session.status === 'realizada' || session.status === 'falta');
  const attendanceRate = concluded.length > 0 ? Math.round((concluded.filter(session => session.status === 'realizada').length / concluded.length) * 100) : null;
  const financePeriod = createPsychologyPeriod('custom', new Date(`${date}T12:00:00`), monthStart, monthEnd);
  const financeOverview = getPsychologyFinancialOverview(store, financePeriod, date);
  const todayCounts = {
    scheduled: todayAllSessions.filter(session => session.status === 'agendada').length,
    realized: todayAllSessions.filter(session => session.status === 'realizada').length,
    absences: todayAllSessions.filter(session => session.status === 'falta').length,
  };
  const pendingRecords = sessions.filter(session => session.status === 'realizada' && !store.sessionRecords.some(record => record.sessionId === session.id)).slice(0, 5);
  const pendingPayments = getPsychologyFinancialLedger(store, date).chargeEntries.filter(entry => entry.balance > 0 && entry.status !== 'EXEMPT' && entry.status !== 'CANCELLED');
  const patientsWithoutNextSession = activePatients.filter(patient => !sessions.some(session => session.patientId === patient.id && session.status === 'agendada' && session.date >= date));
  const activePackages = getActivePsychologySessionPackages(store);
  const birthdays = activePatients.map(patient => ({ patient, dateOfBirth: getPsychologyPatientDateOfBirth(patient) })).filter(item => item.dateOfBirth && item.dateOfBirth.slice(5, 7) === date.slice(5, 7)).sort((a, b) => a.dateOfBirth.localeCompare(b.dateOfBirth));
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const alerts = [
    ...pendingRecords.map(session => ({ text: `Registro da sessão de ${patientMap.get(session.patientId)?.name || 'Paciente'} ainda não foi concluído.`, tone: 'violet' as const })),
    ...pendingPayments.map(entry => ({ text: `Pagamento de ${entry.charge.patientId ? patientMap.get(entry.charge.patientId)?.name || 'Paciente' : 'Paciente excluído'} continua pendente.`, tone: 'amber' as const })),
    ...patientsWithoutNextSession.slice(0, 4).map(patient => ({ text: `${patient.name} sem próxima sessão agendada.`, tone: 'slate' as const })),
    ...activePackages.filter(item => getPsychologySessionPackageRemaining(item) <= 2).map(item => ({ text: `Pacote de ${patientMap.get(item.patientId)?.name || 'Paciente'} está chegando ao fim: ${item.usedSessions} de ${item.totalSessions} sessões utilizadas.`, tone: 'amber' as const })),
  ];
  const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  return <div data-testid="psychology-day" data-testid-dashboard="psychology-my-day-dashboard" className="space-y-5">
    <DateToolbar date={date} setDate={setDate} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="psychology-day-indicators">
      <MetricCard label="Pacientes ativos" value={activePatients.length} sub="em acompanhamento" icon={<UsersRound size={17} />} />
      <MetricCard label="Sessões na semana" value={weeklySessions} sub="agenda clínica" icon={<CalendarDays size={17} />} />
      <MetricCard label="Assiduidade" value={attendanceRate === null ? '—' : `${attendanceRate}%`} sub="realizadas vs faltas" icon={<CheckCircle2 size={17} />} />
      <MetricCard label="Recebido no mês" value={money.format(financeOverview.received)} sub="pagamentos locais" icon={<DollarSign size={17} />} />
    </div>
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm" data-testid="psychology-birthdays">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-white p-2 text-sky-700 shadow-sm"><Cake size={18} /></span><div><h3 className="text-sm font-black text-sky-950">Aniversariantes do mês</h3><p className="text-xs text-sky-700">Somente informação local, sem envio de mensagens.</p></div></div>
      {birthdays.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{birthdays.map(({ patient, dateOfBirth }) => <div key={patient.id} className="rounded-xl border border-sky-200 bg-white/80 px-3 py-2 text-sm font-bold text-slate-800">{patient.name} <span className="font-medium text-slate-500">— {dateOfBirth.slice(8, 10)}/{dateOfBirth.slice(5, 7)}</span></div>)}</div> : <p className="mt-3 rounded-xl border border-sky-200 bg-white/60 px-3 py-2 text-sm text-sky-800">Nenhum aniversariante neste mês.</p>}
    </section>
    <div className="grid gap-4 lg:grid-cols-3" data-testid="psychology-operational-panels">
      <section className={cardClass}><div className="flex items-center justify-between"><h3 className="text-lg font-black text-slate-900">Hoje</h3><CalendarDays size={18} className="text-violet-700" /></div><div className="mt-4 grid grid-cols-3 gap-2"><MiniCount label="Agendadas" value={todayCounts.scheduled} tone="violet" /><MiniCount label="Realizadas" value={todayCounts.realized} tone="green" /><MiniCount label="Faltas" value={todayCounts.absences} tone="rose" /></div></section>
      <section className={cardClass} data-testid="psychology-pendencies"><div className="flex items-center justify-between"><h3 className="text-lg font-black text-slate-900">Pendências</h3><AlertTriangle size={18} className="text-amber-600" /></div><div className="mt-3 space-y-2 text-sm"><PendingRow label="Registros de sessão" value={pendingRecords.length} /><PendingRow label="Pagamentos" value={pendingPayments.length} /><PendingRow label="Sem próxima sessão" value={patientsWithoutNextSession.length} /><PendingRow label="Pacotes próximos do fim" value={activePackages.filter(item => getPsychologySessionPackageRemaining(item) <= 2).length} /></div></section>
      <section className={cardClass} data-testid="psychology-personal-summary"><div className="flex items-center justify-between"><h3 className="text-lg font-black text-slate-900">Agenda Pessoal</h3><WalletCards size={18} className="text-blue-600" /></div><p className="mt-1 text-xs text-slate-500">Resumo de hoje; a agenda completa continua no menu.</p>{todayPersonal.length > 0 ? <div className="mt-3 space-y-2">{todayPersonal.slice(0, 3).map(item => <div key={item.occurrenceId} className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs"><span className="min-w-0 truncate font-black text-slate-800">{item.time} · {item.title || item.type}</span>{item.alarmEnabled && <span className="shrink-0 text-blue-700">Alarme</span>}</div>)}</div> : <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-3 py-2 text-sm text-slate-500">Nenhum compromisso hoje.</p>}<p className="mt-3 text-xs font-black text-blue-700">{todayPersonal.filter(item => !item.isDone).length} pendência(s) pessoal(is)</p></section>
    </div>
    {alerts.length > 0 && <section className="space-y-2" data-testid="psychology-alerts"><h3 className="text-lg font-black text-slate-900">Alertas</h3>{alerts.slice(0, 6).map((alert, index) => <div key={`${alert.text}-${index}`} className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-bold ${alert.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : alert.tone === 'violet' ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-slate-200 bg-white text-slate-700'}`}><AlertTriangle size={16} className="shrink-0" />{alert.text}</div>)}</section>}
    <div className="grid gap-4 xl:grid-cols-2">
      <SessionListPanel title="Próximas Sessões — Hoje" sessions={todaySessions} patientMap={patientMap} settings={settings} onOpen={onOpenSession} emptyText="Nenhuma sessão agendada hoje." />
      <SessionListPanel title="Próximas Sessões — Amanhã" sessions={tomorrowSessions} patientMap={patientMap} settings={settings} onOpen={onOpenSession} emptyText="Nenhuma sessão agendada amanhã." />
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className={cardClass} data-testid="psychology-session-list"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-slate-900">Próximos atendimentos</h3><p className="text-xs text-slate-500">Clique em um cartão para abrir ações.</p></div><button type="button" onClick={onSchedule} className={secondaryButton}><Plus size={15} /> Agendar</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{[...todaySessions, ...tomorrowSessions].length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">{date === today() ? 'Dia livre por enquanto.' : 'Nenhum atendimento no período.'}</p> : [...todaySessions, ...tomorrowSessions].slice(0, 6).map(session => <CompactSessionCard key={session.id} session={session} patient={patientMap.get(session.patientId)} settings={settings} onOpen={() => onOpenSession(session)} />)}</div></section>
      <PackagePanel packages={activePackages} patientMap={patientMap} />
    </div>
    {itemsForDay(todaySessions, todayPersonal).length === 0 && <div className="sr-only"><button type="button" onClick={onPersonal}>Novo compromisso pessoal</button></div>}
  </div>;
}

function MetricCard({ label, value, sub, icon }: { label: string; value: string | number; sub: string; icon: React.ReactNode }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`psychology-metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-start justify-between gap-2"><p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><span className="rounded-lg bg-violet-50 p-2 text-violet-700">{icon}</span></div><p className="mt-2 text-2xl font-black text-slate-900">{value}</p><p className="mt-1 text-xs font-bold text-slate-400">{sub}</p></article>;
}

function MiniCount({ label, value, tone }: { label: string; value: number; tone: 'violet' | 'green' | 'rose' }) {
  const styles = { violet: 'border-violet-200 bg-violet-50 text-violet-900', green: 'border-emerald-200 bg-emerald-50 text-emerald-900', rose: 'border-rose-200 bg-rose-50 text-rose-900' };
  return <div className={`rounded-xl border p-3 text-center ${styles[tone]}`}><p className="text-2xl font-black">{value}</p><p className="text-[10px] font-black uppercase tracking-wide">{label}</p></div>;
}

function PendingRow({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><span className="text-xs font-bold text-slate-600">{label}</span><span className={`text-sm font-black ${value > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{value}</span></div>;
}

function SessionListPanel({ title, sessions, patientMap, settings, onOpen, emptyText }: { title: string; sessions: PsychologySession[]; patientMap: Map<string, PsychologyPatient>; settings: PsychologySettings; onOpen: (session: PsychologySession) => void; emptyText: string }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="psychology-upcoming-sessions"><h3 className="text-lg font-black text-slate-900">{title}</h3><div className="mt-3 grid gap-2">{sessions.length > 0 ? sessions.slice(0, 6).map(session => <CompactSessionCard key={session.id} session={session} patient={patientMap.get(session.patientId)} settings={settings} onOpen={() => onOpen(session)} />) : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">{emptyText}</p>}</div></section>;
}

function CompactSessionCard({ session, patient, settings, onOpen }: { key?: React.Key; session: PsychologySession; patient?: PsychologyPatient; settings: PsychologySettings; onOpen: () => void }) {
  const color = sessionColor(session, settings);
  return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: `${color}55`, borderLeftWidth: 4 }} data-testid="psychology-session-compact-card"><span className="w-14 shrink-0 text-base font-black text-slate-900">{session.time}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-black text-slate-900">{patient?.name || 'Paciente não encontrado'}</strong><span className="mt-1 block truncate text-xs font-bold text-slate-500">{session.modality === 'online' ? 'Online' : `Presencial · ${sessionLocationLabel(session, settings)}`} · {session.durationMinutes} min</span></span><StatusPill status={session.status} previewStatus={session.previewStatus} /></button>;
}

function PackagePanel({ packages, patientMap }: { packages: ReturnType<typeof getActivePsychologySessionPackages>; patientMap: Map<string, PsychologyPatient> }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="psychology-package-panel"><div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-slate-900">Acompanhamento</h3><p className="text-xs text-slate-500">Pacotes opcionais; pacientes avulsos não aparecem aqui.</p></div><WalletCards size={18} className="text-violet-700" /></div>{packages.length > 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{packages.map(item => { const remaining = getPsychologySessionPackageRemaining(item); const progress = getPsychologySessionPackageProgress(item); return <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="psychology-package-card"><div className="flex items-center justify-between gap-3"><strong className="truncate text-sm text-slate-900">{patientMap.get(item.patientId)?.name || 'Paciente'}</strong><span className="text-xs font-black text-slate-500">{item.usedSessions}/{item.totalSessions} sessões</span></div><p className="mt-1 truncate text-xs font-bold text-slate-500">{item.name}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-violet-600" style={{ width: `${progress}%` }} /></div>{remaining <= 2 && <p className="mt-2 text-xs font-bold text-amber-700">{remaining} sessão(ões) restante(s).</p>}</article>; })}</div> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Nenhum pacote ativo. O atendimento avulso continua disponível.</p>}</section>;
}

function itemsForDay(sessions: PsychologySession[], personal: ReturnType<typeof getPsychologyPersonalOccurrences>) {
  return [...sessions, ...personal];
}

function DateToolbar({ date, setDate }: { date: string; setDate: (date: string) => void }) {
  const shiftDate = (amount: number) => setDate(format(addDays(new Date(`${date}T12:00:00`), amount), 'yyyy-MM-dd'));
  return <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 sm:flex-wrap sm:gap-3 sm:p-3" data-testid="psychology-date-toolbar">
    <button type="button" onClick={() => shiftDate(-1)} aria-label="Dia anterior" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"><ChevronLeft size={19} /></button>
    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-black text-slate-700"><CalendarDays size={17} className="shrink-0 text-violet-700" /><input type="date" value={date} onChange={event => setDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm" /></label>
    <button type="button" onClick={() => shiftDate(1)} aria-label="Próximo dia" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"><ChevronRight size={19} /></button>
    <button type="button" onClick={() => setDate(today())} className="min-h-11 shrink-0 rounded-xl px-2.5 text-xs font-black text-violet-700 transition hover:bg-violet-50 hover:underline">Hoje</button>
  </div>;
}

function primaryPsychologyLocation(settings: PsychologySettings) {
  return settings.locations.find(location => location.isPrimary && location.active) || settings.locations.find(location => location.active);
}

function SessionCard({ session, settings, patient, hasRecord, onEdit, onStatus, onRecord }: { session: PsychologySession; settings: PsychologySettings; patient?: PsychologyPatient; hasRecord: boolean; onEdit: () => void; onStatus: (status: PsychologySessionStatus) => void; onRecord: () => void }) {
  const color = sessionColor(session, settings); const originLabel = sessionBookingOriginLabel(session);
  return <article className="rounded-2xl border p-4 shadow-sm" style={{ borderColor: color, backgroundColor: `${color}18` }} data-testid="psychology-clinical-session" data-agenda-category={sessionCategory(session)}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl p-2.5 text-white" style={{ backgroundColor: color }}><Clock3 size={19} /></div><div><p className="text-lg font-black">{session.time} <span className="text-sm font-bold text-slate-500">· {session.durationMinutes} min</span></p><p className="mt-0.5 font-bold text-slate-800">{patient?.name || 'Paciente não encontrado'}</p><p className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-600"><span>{session.modality === 'online' ? 'Online' : session.locationType === 'EXTERNAL_OFFICE' ? 'Consultório Externo' : 'Presencial'}</span><span>· {sessionLocationLabel(session, settings)}</span>{session.administrativeNote && <span>· {session.administrativeNote}</span>}{originLabel && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black text-slate-600">{originLabel}</span>}</p></div></div><StatusPill status={session.status} previewStatus={session.previewStatus} /></div><div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/80 pt-3"><button type="button" onClick={onEdit} className={secondaryButton}><Pencil size={14} /> Reagendar</button>{session.status !== 'realizada' && session.status !== 'cancelada' && <><button type="button" onClick={() => onStatus('realizada')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"><Check size={14} /> Marcar como realizada</button><button type="button" onClick={() => onStatus('falta')} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100">Falta</button><button type="button" onClick={() => onStatus('cancelada')} className="rounded-xl px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-100">Cancelar</button></>}{session.status === 'realizada' && <button type="button" onClick={onRecord} className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-3 py-2 text-xs font-black text-white hover:bg-violet-800"><FileText size={14} /> {hasRecord ? 'Editar registro' : 'Registrar sessão'}</button>}</div></article>;
}

function PersonalCard({ commitment, settings }: { commitment: PsychologyPersonalCommitment; settings?: PsychologySettings }) {
  const category: PsychologyAgendaCategory = commitment.type === 'Mentoria' ? 'MENTORING' : 'PERSONAL';
  const color = settings ? colorForAgendaCategory(settings.colors, category) : PSYCHOLOGY_COLOR_DEFAULTS[category];
  return <article className="rounded-2xl border p-4" style={{ borderColor: color, backgroundColor: `${color}18` }} data-testid="psychology-personal-commitment" data-agenda-category={category}><div className="flex items-start gap-3"><div className="rounded-xl p-2.5 text-white" style={{ backgroundColor: color }}><Clock3 size={19} /></div><div><div className="flex flex-wrap items-center gap-2"><p className="text-lg font-black text-slate-900">{commitment.time} <span className="text-sm font-bold text-slate-500">· {commitment.durationMinutes} min</span></p><span className="rounded-full px-2.5 py-1 text-[11px] font-black text-white" style={{ backgroundColor: color }}>Agenda Pessoal</span></div><p className="mt-1 font-bold text-slate-900">{commitment.title || commitment.type}</p><p className="text-xs font-bold text-slate-500">{commitment.type}{commitment.recurrence && commitment.recurrence !== 'Não repetir' ? ` · ${commitment.recurrence}` : ''}{commitment.alarmEnabled ? ' · Alarme' : ''}</p>{commitment.note && <p className="mt-1 text-sm text-slate-700">{commitment.note}</p>}</div></div></article>;
}

const PATIENT_LIST_GRID = 'grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:grid-cols-[auto_minmax(150px,1.3fr)_minmax(105px,.9fr)_minmax(100px,1fr)_minmax(130px,1fr)_minmax(100px,.7fr)_max-content] md:gap-2 xl:grid-cols-[auto_minmax(150px,1.35fr)_minmax(100px,.8fr)_minmax(110px,1fr)_minmax(100px,.8fr)_minmax(115px,.9fr)_minmax(135px,1fr)_minmax(170px,1.25fr)_minmax(78px,.65fr)_max-content] xl:gap-2';
const PATIENT_LIST_PADDING = 'px-3';

function SortHeader({ label, sortKey, activeKey, direction, onSort, className = '' }: { label: string; sortKey: PsychologyPatientListSortKey; activeKey: PsychologyPatientListSortKey; direction: PsychologyPatientListSortDirection; onSort: (key: PsychologyPatientListSortKey) => void; className?: string }) {
  const active = activeKey === sortKey;
  return <button type="button" onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1 text-left transition hover:text-violet-700 ${className}`} aria-label={`Ordenar por ${label}`} aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>{label}{active ? direction === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} /> : <span className="text-slate-300">↕</span>}</button>;
}

function PatientsView({ rows, search, searchKey, setSearch, onNew, onEdit, onOpen, onDelete, onSetReview, onBulkDelete, preview }: { rows: PsychologyPatientListItem[]; search: string; searchKey: string; setSearch: (value: string) => void; onNew: () => void; onEdit: (patient: PsychologyPatient) => void; onOpen: (patient: PsychologyPatient) => void; onDelete: (patient: PsychologyPatient) => void; onSetReview: (patientIds: string[], inReview: boolean) => boolean | Promise<boolean>; onBulkDelete: (patientIds: string[]) => PsychologyBulkDeletionSummary | Promise<PsychologyBulkDeletionSummary>; preview?: PsychologyDoctoraliaPreview | null }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'review'>('all');
  const [lastSessionFilter, setLastSessionFilter] = useState<PsychologyPatientLastSessionFilter>('any');
  const [nextSessionFilter, setNextSessionFilter] = useState<PsychologyPatientNextSessionFilter>('all');
  const [reviewFilter, setReviewFilter] = useState<PsychologyPatientReviewFilter>('all');
  const [sortKey, setSortKey] = useState<PsychologyPatientListSortKey>('name');
  const [sortDirection, setSortDirection] = useState<PsychologyPatientListSortDirection>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmationOpen, setBulkConfirmationOpen] = useState(false);
  const [bulkConfirmationText, setBulkConfirmationText] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [reviewProcessing, setReviewProcessing] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<PsychologyBulkDeletionSummary | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const previewCounts = preview?.bundle.patientCounts;
  const referenceDate = useMemo(() => new Date(), []);
  const reviewIdsFromPreview = useMemo(() => new Set(rows.filter(row => Boolean(preview?.patientDetailsById.get(row.patient.id)?.reviewReason)).map(row => row.patient.id)), [preview, rows]);
  const rowsWithPreviewReview = useMemo(() => preview
    ? rows.map(row => reviewIdsFromPreview.has(row.patient.id) && !row.patient.inReview ? { ...row, patient: { ...row.patient, inReview: true } } : row)
    : rows, [preview, reviewIdsFromPreview, rows]);
  const baseRows = useMemo(() => filterPsychologyPatientList(rowsWithPreviewReview, { query: searchKey, lastSession: lastSessionFilter, nextSession: nextSessionFilter, review: reviewFilter }, referenceDate), [lastSessionFilter, nextSessionFilter, referenceDate, reviewFilter, rowsWithPreviewReview, searchKey]);
  const counts = useMemo(() => countPsychologyPatientList(baseRows), [baseRows]);
  const filteredRows = useMemo(() => sortPsychologyPatientList(filterPsychologyPatientList(rowsWithPreviewReview, { query: searchKey, status: statusFilter, lastSession: lastSessionFilter, nextSession: nextSessionFilter, review: reviewFilter }, referenceDate), sortKey, sortDirection), [lastSessionFilter, nextSessionFilter, referenceDate, reviewFilter, rowsWithPreviewReview, searchKey, sortDirection, sortKey, statusFilter]);
  const reviewArea = statusFilter === 'review';
  const selectedVisibleIds = useMemo(() => filteredRows.filter(row => selectedIds.has(row.patient.id)).map(row => row.patient.id), [filteredRows, selectedIds]);
  const allVisibleSelected = filteredRows.length > 0 && selectedVisibleIds.length === filteredRows.length;
  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || lastSessionFilter !== 'any' || nextSessionFilter !== 'all' || reviewFilter !== 'all';

  useEffect(() => {
    const visibleIds = new Set(filteredRows.map(row => row.patient.id));
    setSelectedIds(current => {
      const next = new Set([...current].filter(id => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredRows]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedVisibleIds.length > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisibleIds.length]);

  const sortBy = (nextKey: PsychologyPatientListSortKey) => {
    const nextDirection = sortKey === nextKey ? (sortDirection === 'asc' ? 'desc' : 'asc') : nextKey === 'lastSession' || nextKey === 'nextSession' ? 'desc' : 'asc';
    setSortKey(nextKey);
    setSortDirection(nextDirection);
    if (nextKey !== 'lastSession' && (lastSessionFilter === 'recent' || lastSessionFilter === 'oldest')) setLastSessionFilter('any');
  };

  const changeLastSessionFilter = (value: PsychologyPatientLastSessionFilter) => {
    setLastSessionFilter(value);
    if (value === 'recent' || value === 'oldest') {
      setSortKey('lastSession');
      setSortDirection(value === 'recent' ? 'desc' : 'asc');
    }
  };

  const togglePatient = (id: string) => setSelectedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllVisible = () => setSelectedIds(current => {
    const next = new Set(current);
    if (allVisibleSelected) filteredRows.forEach(row => next.delete(row.patient.id));
    else filteredRows.forEach(row => next.add(row.patient.id));
    return next;
  });

  const clearSelection = () => setSelectedIds(new Set());
  const applyReview = async (inReview: boolean) => {
    if (reviewProcessing) return;
    setReviewProcessing(true);
    try {
      if (await onSetReview(selectedVisibleIds, inReview)) clearSelection();
    } finally {
      setReviewProcessing(false);
    }
  };
  const confirmBulkDelete = async () => {
    if (selectedVisibleIds.length < 2 || bulkConfirmationText.trim().toLocaleUpperCase() !== 'EXCLUIR' || bulkProcessing) return;
    setBulkProcessing(true);
    try {
      const result = await onBulkDelete(selectedVisibleIds);
      setBulkConfirmationOpen(false);
      setBulkConfirmationText('');
      setSelectedIds(new Set(result.failedIds || []));
      setBulkSummary(result);
    } finally {
      setBulkProcessing(false);
    }
  };

  return <div data-testid="psychology-patients" className="w-full">
    {preview && <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/70 p-4" data-testid="doctoralia-preview-patient-summary"><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Pacientes na prévia local</p><p className="mt-1 text-lg font-black text-violet-950">{previewCounts?.initiallyImportable || rows.length} pacientes</p><p className="mt-1 text-sm font-bold text-violet-800">{previewCounts?.activeByFutureEvidence || 0} ativos · {previewCounts?.inactiveReview || 0} inativos/revisão</p></div>}
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="psychology-patient-counters">
      {([['all', 'Total', counts.total], ['active', 'Ativos', counts.active], ['inactive', 'Inativos', counts.inactive], ['review', 'Em revisão', counts.review]] as const).map(([value, label, count]) => <button key={value} type="button" onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value} className={`rounded-2xl border px-3 py-3 text-left transition ${statusFilter === value ? 'border-violet-500 bg-violet-50 text-violet-900 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/50'}`}><span className="block text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</span><span className="mt-1 block text-2xl font-black">{count}</span></button>)}
    </div>
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-testid="psychology-patient-filters">
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_repeat(3,minmax(150px,1fr))]">
        <label className="relative block"><span className="sr-only">Buscar nome, telefone ou e-mail</span><Search size={17} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou e-mail" className={`${inputClass} pl-10`} /></label>
        <label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Última sessão<select value={lastSessionFilter} onChange={event => changeLastSessionFilter(event.target.value as PsychologyPatientLastSessionFilter)} className={`${inputClass} mt-1 text-sm normal-case tracking-normal`}><option value="any">Qualquer período</option><option value="recent">Mais recente primeiro</option><option value="oldest">Mais antiga primeiro</option><option value="none">Sem sessão registrada</option><option value="3m">Sem atendimento há 3 meses</option><option value="6m">Sem atendimento há 6 meses</option><option value="12m">Sem atendimento há 12 meses</option><option value="18m">Sem atendimento há 18 meses</option><option value="24m">Sem atendimento há 24 meses</option></select></label>
        <label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Próxima sessão<select value={nextSessionFilter} onChange={event => setNextSessionFilter(event.target.value as PsychologyPatientNextSessionFilter)} className={`${inputClass} mt-1 text-sm normal-case tracking-normal`}><option value="all">Todos</option><option value="with">Com próxima sessão</option><option value="without">Sem próxima sessão</option></select></label>
        <label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Revisão<select value={reviewFilter} onChange={event => setReviewFilter(event.target.value as PsychologyPatientReviewFilter)} className={`${inputClass} mt-1 text-sm normal-case tracking-normal`}><option value="all">Todos</option><option value="in-review">Em revisão</option><option value="out-of-review">Fora da revisão</option></select></label>
      </div>
    </div>
     {selectedVisibleIds.length > 0 && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-3 py-3" data-testid="psychology-patient-selection-bar"><p className="text-sm font-black text-violet-950">{selectedVisibleIds.length} pacientes selecionados</p><div className="flex flex-wrap gap-2">{selectedVisibleIds.length >= 2 && <button type="button" data-testid="psychology-bulk-delete-button" onClick={() => setBulkConfirmationOpen(true)} disabled={Boolean(preview) || bulkProcessing || reviewProcessing} className="inline-flex items-center gap-2 rounded-xl bg-rose-700 px-3 py-2 text-xs font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={14} /> Excluir selecionados ({selectedVisibleIds.length})</button>}<button type="button" onClick={() => void applyReview(!reviewArea)} disabled={Boolean(preview) || reviewProcessing || bulkProcessing} className={secondaryButton}>{reviewArea ? 'Retirar da revisão' : 'Mover para revisão'}</button><button type="button" onClick={clearSelection} className={secondaryButton}>Limpar seleção</button></div></div>}
    <div className="mb-5 flex justify-end"><button type="button" onClick={onNew} disabled={Boolean(preview)} className={primaryButton}><Plus size={17} /> Novo paciente</button></div>
    {filteredRows.length === 0 ? <EmptyState title={hasFilters ? 'Nenhum paciente encontrado' : 'Nenhum paciente cadastrado'} text={hasFilters ? 'Ajuste a busca ou os filtros para ver outros pacientes.' : 'Cadastre somente as informações essenciais para começar.'} action={!hasFilters && !preview ? <button type="button" onClick={onNew} className={primaryButton}><Plus size={16} /> Novo paciente</button> : undefined} /> : <div data-testid="psychology-patient-list" className="w-full overflow-hidden bg-white">
      <div data-testid="psychology-patient-list-header" role="row" className={`hidden md:grid ${PATIENT_LIST_GRID} ${PATIENT_LIST_PADDING} border-b border-slate-200 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400`}>
        <label className="flex items-center justify-center" aria-label="Selecionar todos os pacientes visíveis"><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={Boolean(preview)} className="h-4 w-4 rounded border-slate-300 text-violet-700" /></label><SortHeader label="Paciente" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={sortBy} /><span>Telefone</span><span className="hidden xl:block">E-mail</span><span className="hidden xl:block">Cadastro</span><SortHeader label="Última sessão" sortKey="lastSession" activeKey={sortKey} direction={sortDirection} onSort={sortBy} /><SortHeader label="Próxima sessão" sortKey="nextSession" activeKey={sortKey} direction={sortDirection} onSort={sortBy} /><span className="hidden xl:block">Modalidade / local</span><SortHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={sortBy} className="justify-center" /><span className="text-right">Ações</span>
      </div>
      <div>{filteredRows.map(row => { const rowInReview = isPsychologyPatientInReview(row); return <div key={row.patient.id} data-testid="psychology-patient-list-row" className={`group grid ${PATIENT_LIST_GRID} ${PATIENT_LIST_PADDING} border-b border-slate-100 py-3 transition-colors last:border-b-0 hover:bg-slate-50/70 ${rowInReview ? 'bg-amber-50/30' : ''}`}>
        <label className="col-start-1 row-start-1 flex items-center justify-center md:col-auto md:row-auto" aria-label={`Selecionar ${row.patient.name}`}><input type="checkbox" checked={selectedIds.has(row.patient.id)} onChange={() => togglePatient(row.patient.id)} disabled={Boolean(preview)} className="h-4 w-4 rounded border-slate-300 text-violet-700" /></label>
        <button type="button" onClick={() => onOpen(row.patient)} aria-label={`Abrir ficha completa de ${row.patient.name}`} className="col-start-2 row-start-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 md:col-auto md:row-auto md:truncate"><span className="block truncate text-sm font-black text-slate-900 md:text-base">{row.patient.name}</span></button>
        <div className="col-start-2 row-start-2 min-w-0 text-left text-sm text-slate-600 md:col-auto md:row-auto"><span className="mr-2 text-[10px] font-black uppercase tracking-wide text-slate-400 md:hidden">Telefone</span><span className="whitespace-nowrap">{row.phone}</span></div>
        <div className="hidden min-w-0 truncate text-left text-sm text-slate-600 xl:block">{row.email}</div>
        <div className="hidden text-left text-sm text-slate-600 xl:block">{row.createdAt}</div>
        <div className="col-start-2 row-start-3 min-w-0 text-left text-sm text-slate-600 md:col-auto md:row-auto"><span className="mr-2 text-[10px] font-black uppercase tracking-wide text-slate-400 md:hidden">Última</span><span className="whitespace-nowrap">{row.lastSession}</span></div>
        <div className="col-start-2 row-start-4 min-w-0 text-left text-sm text-slate-700 md:col-auto md:row-auto"><span className="mr-2 text-[10px] font-black uppercase tracking-wide text-slate-400 md:hidden">Próxima</span><span className="whitespace-nowrap md:whitespace-normal">{row.nextSession}</span></div>
        <div data-testid="psychology-patient-list-modality" className="col-start-2 row-start-5 block min-w-0 text-sm text-slate-600 md:hidden xl:col-auto xl:row-auto xl:block"><span className="mr-2 text-[10px] font-black uppercase tracking-wide text-slate-400 md:hidden">Modalidade</span><span className="block max-w-full truncate xl:whitespace-nowrap" title={row.modalityLocation}>{row.modalityLocation}</span></div>
        <div data-testid="psychology-patient-list-status" className="col-start-3 row-start-1 flex min-w-0 flex-col items-center justify-center gap-1 self-center text-center md:col-auto md:row-auto xl:col-auto xl:row-auto"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-black ${row.patient.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.patient.active ? 'Ativo' : 'Inativo'}</span>{rowInReview && <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Em revisão</span>}</div>
<div data-testid="psychology-patient-list-actions" className="col-span-3 row-start-6 flex min-w-0 flex-nowrap items-center justify-end gap-1 whitespace-nowrap pt-2 text-right md:col-auto md:row-auto md:pt-0 xl:col-auto xl:row-auto"><button type="button" onClick={() => onOpen(row.patient)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><FileText size={14} /> Abrir ficha</button>{!preview && <><button type="button" onClick={() => onEdit(row.patient)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><Pencil size={14} /> Editar</button><button type="button" onClick={() => onDelete(row.patient)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-black text-slate-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"><Trash2 size={13} /> Excluir</button></>}</div>
      </div>; })}</div>
    </div>}
 {bulkConfirmationOpen && <Dialog title={`Excluir selecionados (${selectedVisibleIds.length})?`} onClose={() => { if (!bulkProcessing) { setBulkConfirmationOpen(false); setBulkConfirmationText(''); } }}><div className="space-y-4"><div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><p className="font-black">Excluir definitivamente os {selectedVisibleIds.length} pacientes selecionados?</p><p className="mt-2 leading-relaxed">A ação é irreversível e excluirá os registros vinculados conforme a regra de cascata aprovada, incluindo sessões, registros, pacotes, documentos, anexos, cobranças e pagamentos.</p></div><label className="block text-sm font-black text-slate-700">Digite <span className="text-rose-700">EXCLUIR</span> para confirmar<input autoFocus value={bulkConfirmationText} onChange={event => setBulkConfirmationText(event.target.value)} className={`${inputClass} mt-2`} /></label><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setBulkConfirmationOpen(false); setBulkConfirmationText(''); }} disabled={bulkProcessing} className={secondaryButton}>Cancelar</button><button type="button" onClick={confirmBulkDelete} disabled={bulkConfirmationText.trim().toLocaleUpperCase() !== 'EXCLUIR' || bulkProcessing} className="inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{bulkProcessing ? 'Processando…' : 'Excluir selecionados'}</button></div></div></Dialog>}
    {bulkSummary && <Dialog title="Resultado da exclusão" onClose={() => setBulkSummary(null)}><div className="space-y-4"><p className="text-sm font-bold text-slate-700">{bulkSummary.processed} paciente(s) processado(s).</p><ul className="space-y-2 text-sm font-bold text-slate-700"><li>{bulkSummary.deleted} excluído(s) definitivamente.</li><li>{bulkSummary.failed} falha(s) no processamento.</li></ul><div className="flex justify-end"><button type="button" onClick={() => setBulkSummary(null)} className={primaryButton}>Fechar</button></div></div></Dialog>}
  </div>;
}

const sessionTone = {
  presencial: 'border-violet-200 bg-violet-50 text-violet-950',
  online: 'border-sky-200 bg-sky-50 text-sky-950',
} as const;

function psychologyLegendLabel(category: PsychologyAgendaCategory, settings: PsychologySettings): string {
  if (category === 'ONLINE') return 'Online';
  if (category === 'PERSONAL') return 'Pessoal';
  if (category === 'MENTORING') return 'Mentoria';
  const baseLabel = category === 'EXTERNAL_OFFICE' ? 'Consultório Externo' : 'Presencial';
  const locationType = category === 'EXTERNAL_OFFICE' ? 'EXTERNAL_OFFICE' : 'PRIMARY_OFFICE';
  const displayName = settings.locations.find(location => location.type === locationType && location.active)?.displayName;
  return displayName && displayName !== baseLabel ? `${baseLabel} — ${displayName}` : baseLabel;
}

function agendaCategoryVisualStyle(category: PsychologyAgendaCategory, settings: PsychologySettings, location?: PsychologyLocation) {
  if (category === 'PERSONAL') return resolvePsychologyAgendaEventStyle({ source: 'SESSION', category, colors: settings.colors, modality: 'presencial' });
  if (category === 'MENTORING') return resolvePsychologyAgendaEventStyle({ source: 'MENTORING', category, colors: settings.colors });
  if (category === 'ONLINE') return resolvePsychologyAgendaEventStyle({ source: 'SESSION', category, colors: settings.colors, modality: 'online' });
  const resolvedLocation = location || settings.locations.find(item => item.active && item.type === (category === 'EXTERNAL_OFFICE' ? 'EXTERNAL_OFFICE' : 'PRIMARY_OFFICE'));
  return resolvePsychologyAgendaEventStyle({ source: 'SESSION', category, colors: settings.colors, modality: 'presencial', location: resolvedLocation });
}

function AgendaView({ sessions, personalCommitments, patientMap, settings, publicBookingSettings, weekStart, onPreviousWeek, onNextWeek, onToday, onNew, onPublicBookingAction, onOpenSession, onRemoveCancelled, onOpenPersonal }: { sessions: PsychologySession[]; personalCommitments: PsychologyPersonalCommitment[]; patientMap: Map<string, PsychologyPatient>; settings: PsychologySettings; publicBookingSettings?: PublicBookingSettings; weekStart: Date; onPreviousWeek: () => void; onNextWeek: () => void; onToday: () => void; onNew: (date?: string, time?: string, kind?: NewEventKind) => void; onPublicBookingAction: (action: PublicBookingQuickAction) => void; onOpenSession: (session: PsychologySession) => void; onRemoveCancelled?: (session: PsychologySession) => void; onOpenPersonal: (item: PsychologyPersonalCommitment) => void }) {
  const weekDays = [1, 2, 3, 4, 5, 6].map(offset => addDays(weekStart, offset));
  const [mobileDayIndex, setMobileDayIndex] = useState(() => Math.min(5, Math.max(0, new Date().getDay() - 1)));
  const [slotMenu, setSlotMenu] = useState<{ date: string; time: string; endTime: string; marker: PublicBookingAgendaMarker } | null>(null);
  const [agendaNow, setAgendaNow] = useState(() => new Date());
  const [viewport, setViewport] = useState(() => ({ height: typeof window === 'undefined' ? 900 : window.innerHeight, width: typeof window === 'undefined' ? 1280 : window.innerWidth }));
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateAgendaNow = () => setAgendaNow(new Date());
    const timer = window.setInterval(updateAgendaNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const updateViewport = () => setViewport({ height: window.innerHeight, width: window.innerWidth });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  const rangeLabel = `${format(weekDays[0], 'dd/MM')} — ${format(weekDays[weekDays.length - 1], 'dd/MM')}`;
  const baselineTimes = Array.from({ length: 15 }, (_, index) => `${String(7 + index).padStart(2, '0')}:00`);
  const allTimes = useMemo(() => [...new Set([
    ...baselineTimes,
    ...getPsychologyAvailabilityTimes(settings.agenda),
    ...(publicBookingSettings?.publicBookingAvailability.flatMap(period => [period.startTime, period.endTime]) || []),
    ...(publicBookingSettings?.publicBookingExceptions.flatMap(exception => [exception.startTime, exception.endTime].filter((value): value is string => Boolean(value))) || []),
    ...sessions.map(session => session.time),
    ...personalCommitments.map(item => item.time),
  ])].sort(), [publicBookingSettings, settings.agenda, sessions, personalCommitments]);
  const agendaScale = useMemo(() => getPsychologyAgendaScale(viewport.height, viewport.width), [viewport.height, viewport.width]);
  const currentTime = getPsychologyAgendaTimeProgress(agendaNow);
  const firstRelevantTime = useMemo(() => {
    const firstSession = [...sessions].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0];
    return firstSession?.time || getPsychologyFirstAvailabilityTime(settings.agenda) || '09:00';
  }, [sessions, settings.agenda]);
  useEffect(() => {
    const startMinutes = psychologyAgendaTimeToMinutes(allTimes[0] || '07:00');
    const targetMinutes = psychologyAgendaTimeToMinutes(firstRelevantTime);
    const scrollTop = Math.max(0, (targetMinutes - startMinutes) * agendaScale.pixelsPerMinute - agendaScale.rowHeightForMinutes(30));
    [desktopScrollRef.current, mobileScrollRef.current].forEach(element => { if (element) element.scrollTop = scrollTop; });
  }, [agendaScale, firstRelevantTime, weekStart, allTimes]);

  const dayEvents = (day: Date, time: string) => {
    const date = format(day, 'yyyy-MM-dd');
    return {
      sessions: getPsychologyAgendaSessionsForSlot(sessions, date, time),
      personal: personalCommitments.filter(item => item.date === date && item.time === time),
    };
  };

  const renderGrid = (days: Date[], mode: 'desktop' | 'mobile') => { const gridColumns = days.length === 1 ? 'grid-cols-[68px_minmax(0,1fr)]' : 'grid-cols-[68px_repeat(6,minmax(150px,1fr))]'; const scrollRef = mode === 'desktop' ? desktopScrollRef : mobileScrollRef; const scrollHeight = mode === 'desktop' ? 'clamp(300px, calc(100vh - 420px), 720px)' : 'clamp(320px, calc(100vh - 380px), 680px)'; return <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm" data-testid={`psychology-agenda-grid-${mode}`}><div className={days.length === 1 ? 'min-w-[360px]' : 'min-w-[1080px]'}>
    <div className={`sticky top-0 z-30 grid ${gridColumns} border-b border-slate-200 bg-slate-50`}>
      <div className="border-r border-slate-200 p-3 text-center text-[11px] font-black uppercase tracking-wider text-slate-400">Hora</div>
      {days.map(day => { const date = format(day, 'yyyy-MM-dd'); const isToday = isPsychologyAgendaToday(date, agendaNow); return <div key={date} className={`flex min-h-[64px] items-center justify-between gap-2 border-r border-slate-200 px-3 py-2 last:border-r-0 ${isToday ? 'bg-violet-50' : ''}`}><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{format(day, 'EEEE', { locale: ptBR })}</p><p className="mt-0.5 text-xl font-black text-slate-900">{format(day, 'dd/MM')}</p></div>{isToday && <span className="rounded-full bg-violet-700 px-2 py-1 text-[10px] font-black text-white">Hoje</span>}</div>; })}
    </div>
    <div ref={scrollRef} data-testid={`psychology-agenda-scroll-${mode}`} className="overflow-y-auto scroll-smooth scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent" style={{ height: scrollHeight }}>
    {allTimes.map((time, timeIndex) => <div key={time} className={`grid ${gridColumns} border-b border-slate-200 last:border-b-0`} style={{ height: `${agendaScale.rowHeightForMinutes(Math.max(1, (allTimes[timeIndex + 1] ? psychologyAgendaTimeToMinutes(allTimes[timeIndex + 1]) : 21 * 60) - psychologyAgendaTimeToMinutes(time)))}px` }}>
      <div className="flex items-start justify-center border-r border-slate-200 bg-slate-50 px-1 pt-2 text-xs font-black text-slate-600">{time}</div>
      {days.map(day => { const date = format(day, 'yyyy-MM-dd'); const events = dayEvents(day, time); const occupied = events.sessions.length > 0 || events.personal.length > 0; const habitual = isPsychologyTimeWithinAvailability(settings.agenda, day.getDay(), time); const rowStartMinutes = psychologyAgendaTimeToMinutes(time); const nextTime = allTimes[timeIndex + 1]; const rowEndMinutes = nextTime ? psychologyAgendaTimeToMinutes(nextTime) : 21 * 60; const slotEndTime = minutesToTime(rowStartMinutes + settings.agenda.defaultDurationMinutes); const publicMarker = publicBookingSettings ? getPublicBookingAgendaMarker(publicBookingSettings, date, time, slotEndTime) : { kind: 'NONE' as const }; const publicBlocked = publicMarker.kind === 'BLOCK_DAY' || publicMarker.kind === 'BLOCK_PERIOD'; const currentRowProgress = currentTime.visible && isPsychologyAgendaToday(date, agendaNow) ? getPsychologyAgendaRowProgress(currentTime.minutes, rowStartMinutes, rowEndMinutes) : null; const simultaneous = events.sessions.length + events.personal.length > 1; return <div key={`${date}-${time}`} className={`relative min-h-0 border-r border-slate-200 last:border-r-0 ${habitual ? 'bg-white' : 'bg-slate-50/40'}`}>{occupied ? <div className="relative z-10 flex flex-wrap items-start gap-1 overflow-visible p-1" data-testid="psychology-agenda-occupied-slot">{events.sessions.map(session => <WeeklySessionTile key={session.id} session={session} settings={settings} patient={patientMap.get(session.patientId)} onOpen={() => onOpenSession(session)} onRemoveCancelled={onRemoveCancelled ? () => onRemoveCancelled(session) : undefined} scale={agendaScale} simultaneous={simultaneous} />)}{events.personal.map(item => <WeeklyPersonalTile key={item.id} settings={settings} commitment={item} onOpen={() => onOpenPersonal(item)} scale={agendaScale} simultaneous={simultaneous} />)}</div> : <button type="button" onClick={() => setSlotMenu({ date, time, endTime: slotEndTime, marker: publicMarker })} aria-label={`Agendar neste horário ${format(day, 'dd/MM')} às ${time}`} title={publicBlocked ? 'Indisponível online — clique para opções' : publicMarker.kind === 'OPEN_PERIOD' ? 'Disponível online' : habitual ? undefined : 'Fora da sua disponibilidade habitual — ainda é possível agendar'} data-testid="psychology-agenda-free-slot" data-public-booking-state={publicMarker.kind} data-agenda-habitual={habitual ? 'true' : 'false'} className={`group flex h-full w-full cursor-pointer items-start justify-start p-1 text-left transition hover:bg-violet-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${habitual ? 'bg-white' : 'bg-slate-50/40'}`}>{publicBlocked && <span data-testid="psychology-public-blocked-slot" className="rounded-md border border-slate-200 bg-slate-100/80 px-1.5 py-1 text-[10px] font-black text-slate-500">Indisponível online</span>}{publicMarker.kind === 'OPEN_PERIOD' && <span data-testid="psychology-public-open-slot" className="rounded-md border border-emerald-100 bg-emerald-50/70 px-1.5 py-1 text-[10px] font-black text-emerald-700">Disponível online</span>}</button>}{currentRowProgress !== null && <div data-testid="psychology-current-time-indicator" aria-label={`Horário atual ${currentTime.label}`} className="pointer-events-none absolute inset-x-0 z-20" style={{ top: `${currentRowProgress * 100}%` }}><span className="absolute -top-3 left-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">{currentTime.label}</span><div className="h-0.5 w-full bg-red-600 shadow-sm" /></div>}</div>; })}
    </div>)}
    </div>
  </div></div>; };

  const mobileDay = weekDays[mobileDayIndex] || weekDays[0];
  return <div data-testid="psychology-agenda" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <h3 className="text-lg font-black tracking-tight text-slate-900">Agenda semanal</h3>
      <div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={onPreviousWeek} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-violet-300 hover:bg-violet-50" aria-label="Semana anterior"><ChevronLeft size={16} /></button><button type="button" onClick={onToday} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 transition hover:border-violet-300 hover:bg-violet-50">Hoje</button><span className="min-w-[125px] text-center text-xs font-black text-slate-700">{rangeLabel}</span><button type="button" onClick={onNextWeek} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-violet-300 hover:bg-violet-50" aria-label="Próxima semana"><ChevronRight size={16} /></button><button type="button" onClick={() => onNew()} className={compactPrimaryButton}><Plus size={14} /> Agendar sessão</button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5"><div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">{(['ONLINE', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'PERSONAL', 'MENTORING'] as PsychologyAgendaCategory[]).map(category => { const style = agendaCategoryVisualStyle(category, settings); return <span key={category} className="rounded-full border px-2 py-1" style={{ backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.textColor }}>{psychologyLegendLabel(category, settings)}</span>; })}{settings.locations.filter(location => location.type === 'OTHER' && location.active).map(location => { const style = agendaCategoryVisualStyle('PRESENTIAL_PRIMARY', settings, location); return <span key={location.id} className="rounded-full border px-2 py-1" style={{ backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.textColor }}>{location.displayName === 'Presencial' ? 'Presencial' : `Presencial — ${location.displayName}`}</span>; })}</div><span className="text-[11px] text-slate-500">Clique em um horário livre para agendar.</span></div>
    <div className="hidden md:block">{renderGrid(weekDays, 'desktop')}</div>
    <div className="space-y-3 md:hidden"><div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3"><button type="button" onClick={() => setMobileDayIndex(index => Math.max(0, index - 1))} disabled={mobileDayIndex === 0} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 disabled:opacity-40" aria-label="Dia anterior"><ChevronLeft size={19} /></button><div className="text-center"><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Dia selecionado</p><p className="text-lg font-black capitalize text-slate-900">{format(mobileDay, 'EEEE', { locale: ptBR })} · {format(mobileDay, 'dd/MM')}</p></div><button type="button" onClick={() => setMobileDayIndex(index => Math.min(5, index + 1))} disabled={mobileDayIndex === 5} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 disabled:opacity-40" aria-label="Próximo dia"><ChevronRight size={19} /></button></div>{renderGrid([mobileDay], 'mobile')}</div>
    {slotMenu && <TabbedAgendaSlotMenu slotMenu={slotMenu} settings={settings} publicBookingSettings={publicBookingSettings} onClose={() => setSlotMenu(null)} onNew={onNew} onPublicBookingAction={onPublicBookingAction} />}
  </div>;
}

type PublicAgendaSlotState = 'AVAILABLE' | 'BLOCKED' | 'OUTSIDE' | 'UNKNOWN';

function TabbedAgendaSlotMenu({ slotMenu, settings, publicBookingSettings, onClose, onNew, onPublicBookingAction }: { slotMenu: { date: string; time: string; endTime: string; marker: PublicBookingAgendaMarker }; settings: PsychologySettings; publicBookingSettings?: PublicBookingSettings; onClose: () => void; onNew: (date?: string, time?: string, kind?: NewEventKind) => void; onPublicBookingAction: (action: PublicBookingQuickAction) => void }) {
  type MenuTab = 'schedule' | 'block' | 'availability';
  const publicBlocked = slotMenu.marker.kind === 'BLOCK_DAY' || slotMenu.marker.kind === 'BLOCK_PERIOD';
  const [activeTab, setActiveTab] = useState<MenuTab>(publicBlocked ? 'availability' : 'schedule');
  const [customIntervalOpen, setCustomIntervalOpen] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState({ startTime: slotMenu.time, endTime: slotMenu.endTime });
  const [intervalError, setIntervalError] = useState('');
  const movable = useMovableDialog();
  const quickDayparts = (['morning', 'afternoon', 'evening'] as PsychologyAgendaDayPart[]).map(part => ({ part, label: `${PSYCHOLOGY_AGENDA_DAYPART_LABELS[part].charAt(0).toLocaleUpperCase()}${PSYCHOLOGY_AGENDA_DAYPART_LABELS[part].slice(1)}`, period: getPsychologyAgendaDaypart(settings.agenda, part) }));
  const publicHabitual = Boolean(publicBookingSettings?.active && publicBookingSettings.publicBookingAvailability.some(period => period.enabled && period.dayOfWeek === new Date(`${slotMenu.date}T12:00:00`).getDay() && timeToMinutes(slotMenu.time) >= timeToMinutes(period.startTime) && timeToMinutes(slotMenu.endTime) <= timeToMinutes(period.endTime)));
  const publicState: PublicAgendaSlotState = !publicBookingSettings ? 'UNKNOWN' : publicBlocked ? 'BLOCKED' : slotMenu.marker.kind === 'OPEN_PERIOD' || publicHabitual ? 'AVAILABLE' : 'OUTSIDE';
  const publicStateLabel = publicState === 'BLOCKED' ? 'Bloqueado' : publicState === 'AVAILABLE' ? 'Disponível para Agendamento Online' : publicState === 'OUTSIDE' ? 'Fora da programação' : 'Indisponível';
  const exception = slotMenu.marker.exception;
  const exceptionSummary = publicState === 'BLOCKED'
    ? exception?.type === 'BLOCK_DAY'
      ? 'Bloqueado o dia inteiro.'
      : exception?.startTime && exception?.endTime
        ? `Bloqueado hoje das ${exception.startTime} às ${exception.endTime}.`
        : 'Bloqueio online registrado para este horário.'
    : undefined;
  const submitCustomInterval = () => {
    if (timeToMinutes(intervalDraft.endTime) <= timeToMinutes(intervalDraft.startTime)) { setIntervalError('O fim precisa ser depois do início.'); return; }
    setIntervalError('');
    onClose();
    onPublicBookingAction({ kind: 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: intervalDraft.startTime, endTime: intervalDraft.endTime });
  };
  const actionButton = (label: string, testId: string, onClick: () => void, className = secondaryButton) => <button type="button" data-testid={testId} onClick={onClick} className={className}>{label}</button>;
  const tabClass = (tab: MenuTab) => `flex-1 rounded-lg px-2 py-2 text-xs font-black transition ${activeTab === tab ? 'bg-violet-700 text-white shadow-sm' : 'text-slate-500 hover:bg-violet-50 hover:text-violet-800'}`;
  return <div className="fixed inset-0 z-[150]" role="presentation">
    <button type="button" aria-label="Fechar menu de horário" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-950/15" />
    <section ref={movable.dialogRef} style={movable.positionStyle} role="dialog" aria-modal="true" aria-label="Ações do horário" className="absolute max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-[34rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div {...movable.dragHandleProps} data-testid="psychology-agenda-dialog-drag-handle" className={`sticky top-0 z-10 -mx-4 -mt-4 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 pb-3 pt-4 select-none ${movable.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Horário selecionado</p>
          <p className="mt-1 text-lg font-black text-slate-900">{formatShortDate(slotMenu.date)} · {slotMenu.time}</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Estado da Agenda: <span className="text-emerald-700">Horário livre (FREE)</span></p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Agendamento online: <span className={publicState === 'BLOCKED' ? 'text-rose-700' : publicState === 'AVAILABLE' ? 'text-emerald-700' : 'text-amber-700'}>{publicStateLabel} ({publicState})</span></p>
        </div>
        <button type="button" data-no-dialog-drag onClick={onClose} aria-label="Fechar menu" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div role="tablist" aria-label="Ações do horário" className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        <button type="button" role="tab" aria-selected={activeTab === 'schedule'} data-testid="psychology-agenda-menu-tab-schedule" onClick={() => setActiveTab('schedule')} className={tabClass('schedule')}>Agendar</button>
        <button type="button" role="tab" aria-selected={activeTab === 'block'} data-testid="psychology-agenda-menu-tab-block" onClick={() => setActiveTab('block')} className={tabClass('block')}>Bloquear</button>
        <button type="button" role="tab" aria-selected={activeTab === 'availability'} data-testid="psychology-agenda-menu-tab-availability" onClick={() => setActiveTab('availability')} className={tabClass('availability')}>Disponibilidade</button>
      </div>
      {activeTab === 'schedule' && <div role="tabpanel" className="mt-4 space-y-2">
        <button type="button" data-testid="psychology-agenda-manual-booking" onClick={() => { onClose(); onNew(slotMenu.date, slotMenu.time); }} className={`${primaryButton} w-full justify-start`}><Plus size={16} /><span className="text-left"><span className="block">Agendar paciente</span><span className="block text-[11px] font-semibold opacity-80">Criar uma consulta neste horário</span></span></button>
        <button type="button" data-testid="psychology-agenda-personal-booking" onClick={() => { onClose(); onNew(slotMenu.date, slotMenu.time, 'personal'); }} className={`${secondaryButton} w-full justify-start`}><CalendarDays size={16} /><span className="text-left"><span className="block">Criar compromisso pessoal</span><span className="block text-[11px] font-semibold opacity-70">Reservar este horário para outra atividade</span></span></button>
      </div>}
      {activeTab === 'block' && <div role="tabpanel" className="mt-4 space-y-3">
        {publicState === 'BLOCKED' ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-600"><p>Este horário já está bloqueado para o Agendamento Online.</p>{exceptionSummary && <p className="mt-1 text-xs font-semibold">{exceptionSummary}</p>}<p className="mt-1 text-xs font-semibold">Use Disponibilidade para liberar.</p></div> : publicState === 'OUTSIDE' ? <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário já não é oferecido no Agendamento Online.</p><p className="mt-1 text-xs font-semibold">Use Disponibilidade para disponibilizar este horário.</p></div> : publicState === 'AVAILABLE' ? <>
          <div className="grid gap-2 sm:grid-cols-2">
            {actionButton('Bloquear horário', 'psychology-agenda-block-slot', () => { onClose(); onPublicBookingAction({ kind: 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: slotMenu.time, endTime: slotMenu.endTime }); }, secondaryButton)}
            {actionButton('Bloquear intervalo', 'psychology-agenda-block-interval', () => { setIntervalDraft({ startTime: slotMenu.time, endTime: slotMenu.endTime }); setIntervalError(''); setCustomIntervalOpen(true); }, secondaryButton)}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Períodos rápidos</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {quickDayparts.map(({ part, label, period }) => <React.Fragment key={part}>{actionButton(label, `psychology-agenda-block-${part}`, () => { onClose(); onPublicBookingAction({ kind: 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: period.startTime, endTime: period.endTime }); }, secondaryButton)}</React.Fragment>)}
            </div>
            <div className="mt-2">{actionButton('Dia inteiro', 'psychology-agenda-block-day', () => { onClose(); onPublicBookingAction({ kind: 'BLOCK_DAY', civilDate: slotMenu.date }); }, secondaryButton)}</div>
          </div>
        </> : <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-600">A disponibilidade online ainda não foi carregada.</p>}
        {publicState === 'AVAILABLE' && customIntervalOpen && <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3" data-testid="psychology-agenda-custom-interval"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Início<input aria-label="Início do bloqueio personalizado" type="time" value={intervalDraft.startTime} onChange={event => setIntervalDraft({ ...intervalDraft, startTime: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Fim<input aria-label="Fim do bloqueio personalizado" type="time" value={intervalDraft.endTime} onChange={event => setIntervalDraft({ ...intervalDraft, endTime: event.target.value })} className={`${inputClass} mt-1`} /></label></div>{intervalError && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{intervalError}</p>}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setCustomIntervalOpen(false)} className={secondaryButton}>Cancelar</button><button type="button" data-testid="psychology-agenda-confirm-custom-interval" onClick={submitCustomInterval} className={primaryButton}>Bloquear intervalo</button></div></div>}
      </div>}
      {activeTab === 'availability' && <div role="tabpanel" className="mt-4 space-y-3">
        <div className={`rounded-xl border px-3 py-3 ${publicState === 'BLOCKED' ? 'border-slate-200 bg-slate-50' : publicState === 'AVAILABLE' ? 'border-emerald-100 bg-emerald-50/70' : 'border-amber-100 bg-amber-50/70'}`}><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Estado atual do Agendamento Online</p><p className="mt-1 text-sm font-black text-slate-900">{publicState === 'AVAILABLE' ? 'Disponível para Agendamento Online' : publicStateLabel}</p>{exceptionSummary && <p className="mt-1 text-xs font-semibold text-slate-600">{exceptionSummary}</p>}</div>
        {!publicBookingSettings && <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm font-bold text-slate-600">A configuração do agendamento online ainda não está disponível.</p>}
        {publicBookingSettings && publicState === 'AVAILABLE' && <p className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3 text-sm font-bold text-emerald-900">Este horário está disponível para Agendamento Online. Use a aba Bloquear para retirar este horário da disponibilidade.</p>}
        {publicBookingSettings && publicState === 'BLOCKED' && actionButton('Liberar para agendamento online', 'psychology-agenda-unblock-online', () => { const matchedException = slotMenu.marker.exception; onClose(); onPublicBookingAction({ kind: 'UNBLOCK', civilDate: slotMenu.date, exceptionId: matchedException?.id, type: matchedException?.type, startTime: matchedException?.startTime, endTime: matchedException?.endTime }); }, 'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100')}
        {publicBookingSettings && publicState === 'OUTSIDE' && actionButton('Disponibilizar este horário online', 'psychology-agenda-open-slot', () => { onClose(); onPublicBookingAction({ kind: 'OPEN_PERIOD', civilDate: slotMenu.date, startTime: slotMenu.time, endTime: slotMenu.endTime }); }, primaryButton)}
      </div>}
    </section>
  </div>;
}

function AgendaSlotMenu({ slotMenu, settings, publicBookingSettings, onClose, onNew, onPublicBookingAction }: { slotMenu: { date: string; time: string; endTime: string; marker: PublicBookingAgendaMarker }; settings: PsychologySettings; publicBookingSettings?: PublicBookingSettings; onClose: () => void; onNew: (date?: string, time?: string, kind?: NewEventKind) => void; onPublicBookingAction: (action: PublicBookingQuickAction) => void }) {
  const [customIntervalOpen, setCustomIntervalOpen] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState({ startTime: slotMenu.time, endTime: slotMenu.endTime });
  const [intervalError, setIntervalError] = useState('');
  const quickDayparts = (['morning', 'afternoon', 'evening'] as PsychologyAgendaDayPart[]).map(part => ({ part, label: `${PSYCHOLOGY_AGENDA_DAYPART_LABELS[part].charAt(0).toLocaleUpperCase()}${PSYCHOLOGY_AGENDA_DAYPART_LABELS[part].slice(1)}`, period: getPsychologyAgendaDaypart(settings.agenda, part) }));
  const publicHabitual = Boolean(publicBookingSettings?.active && publicBookingSettings.publicBookingAvailability.some(period => period.enabled && period.dayOfWeek === new Date(`${slotMenu.date}T12:00:00`).getDay() && timeToMinutes(slotMenu.time) >= timeToMinutes(period.startTime) && timeToMinutes(slotMenu.endTime) <= timeToMinutes(period.endTime)));
  const publicBlocked = slotMenu.marker.kind === 'BLOCK_DAY' || slotMenu.marker.kind === 'BLOCK_PERIOD';
  const publicState: PublicAgendaSlotState = !publicBookingSettings ? 'UNKNOWN' : publicBlocked ? 'BLOCKED' : slotMenu.marker.kind === 'OPEN_PERIOD' || publicHabitual ? 'AVAILABLE' : 'OUTSIDE';
  const publicStateLabel = publicState === 'BLOCKED' ? 'Bloqueado' : publicState === 'AVAILABLE' ? 'Disponível' : publicState === 'OUTSIDE' ? 'Fora da programação' : 'Indisponível';
  const submitCustomInterval = () => {
    if (timeToMinutes(intervalDraft.endTime) <= timeToMinutes(intervalDraft.startTime)) { setIntervalError('O fim precisa ser depois do início.'); return; }
    setIntervalError('');
    onClose();
    onPublicBookingAction({ kind: 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: intervalDraft.startTime, endTime: intervalDraft.endTime });
  };
  return <div className="fixed inset-0 z-[150]" role="presentation"><button type="button" aria-label="Fechar menu de horário" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-slate-950/15" /><section role="dialog" aria-modal="true" aria-label="Ações do horário" className="absolute inset-x-3 bottom-3 max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:left-1/2 sm:right-auto sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Horário selecionado</p><p className="mt-1 text-lg font-black text-slate-900">{formatShortDate(slotMenu.date)} · {slotMenu.time}</p><p className="mt-1 text-xs font-bold text-slate-500">Estado: {slotMenu.marker.kind === 'BLOCK_DAY' || slotMenu.marker.kind === 'BLOCK_PERIOD' ? 'Horário bloqueado' : slotMenu.marker.kind === 'OPEN_PERIOD' ? 'Horário livre' : 'Horário livre'}</p><p className="mt-1 text-[11px] font-semibold text-slate-400">Agendamento online: <span className={publicState === 'BLOCKED' ? 'text-rose-700' : publicState === 'AVAILABLE' ? 'text-emerald-700' : 'text-slate-600'}>{publicStateLabel}</span></p></div><button type="button" onClick={onClose} aria-label="Fechar menu" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><div className="mt-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Ações</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" data-testid="psychology-agenda-manual-booking" onClick={() => { onClose(); onNew(slotMenu.date, slotMenu.time); }} className={primaryButton}><Plus size={16} /> Agendar paciente</button><button type="button" data-testid="psychology-agenda-personal-booking" onClick={() => { onClose(); onNew(slotMenu.date, slotMenu.time, 'personal'); }} className={secondaryButton}><CalendarDays size={16} /> Criar compromisso pessoal</button></div></div>{publicBookingSettings && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Disponibilidade para pacientes</p>{publicState === 'BLOCKED' ? <button type="button" data-testid="psychology-agenda-unblock-online" onClick={() => { const exceptionId = slotMenu.marker.exception?.id; onClose(); if (exceptionId) onPublicBookingAction({ kind: 'UNBLOCK', civilDate: slotMenu.date, exceptionId }); }} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100">Liberar para agendamento online</button> : <div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" data-testid={publicState === 'OUTSIDE' ? 'psychology-agenda-open-slot' : 'psychology-agenda-block-slot'} onClick={() => { onClose(); onPublicBookingAction({ kind: publicState === 'OUTSIDE' ? 'OPEN_PERIOD' : 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: slotMenu.time, endTime: slotMenu.endTime }); }} className={publicState === 'OUTSIDE' ? primaryButton : secondaryButton}>{publicState === 'OUTSIDE' ? 'Disponibilizar este horário online' : 'Bloquear horário'}</button><button type="button" data-testid="psychology-agenda-block-interval" onClick={() => { setIntervalDraft({ startTime: slotMenu.time, endTime: slotMenu.endTime }); setIntervalError(''); setCustomIntervalOpen(true); }} className={secondaryButton}>Bloquear intervalo</button></div>}{publicState !== 'BLOCKED' && <div className="mt-2 grid gap-2 sm:grid-cols-3">{quickDayparts.map(({ part, label, period }) => <button type="button" key={part} data-testid={`psychology-agenda-block-${part}`} onClick={() => { onClose(); onPublicBookingAction({ kind: 'BLOCK_PERIOD', civilDate: slotMenu.date, startTime: period.startTime, endTime: period.endTime }); }} className={secondaryButton}>{label}</button>)}<button type="button" data-testid="psychology-agenda-block-day" onClick={() => { onClose(); onPublicBookingAction({ kind: 'BLOCK_DAY', civilDate: slotMenu.date }); }} className={secondaryButton}>Dia inteiro</button></div>}{customIntervalOpen && <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3" data-testid="psychology-agenda-custom-interval"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Início<input aria-label="Início do bloqueio personalizado" type="time" value={intervalDraft.startTime} onChange={event => setIntervalDraft({ ...intervalDraft, startTime: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Fim<input aria-label="Fim do bloqueio personalizado" type="time" value={intervalDraft.endTime} onChange={event => setIntervalDraft({ ...intervalDraft, endTime: event.target.value })} className={`${inputClass} mt-1`} /></label></div>{intervalError && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{intervalError}</p>}<div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setCustomIntervalOpen(false)} className={secondaryButton}>Cancelar</button><button type="button" data-testid="psychology-agenda-confirm-custom-interval" onClick={submitCustomInterval} className={primaryButton}>Bloquear intervalo</button></div></div>}</div>}</section></div>;
}

function psychologyAgendaCardBucket(height: number): 'full' | 'compact' | 'minimal' {
  if (height >= 56) return 'full';
  if (height >= 36) return 'compact';
  return 'minimal';
}

function sessionServiceName(session: PsychologySession, settings: PsychologySettings): string | undefined {
  return settings.services.find(service => service.id === session.serviceId)?.name;
}

function agendaTileKeyDown(event: React.KeyboardEvent<HTMLDivElement>, onOpen: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onOpen();
  }
}

function WeeklySessionTile({ session, settings, patient, onOpen, onRemoveCancelled, scale, simultaneous = false }: { key?: React.Key; session: PsychologySession; settings: PsychologySettings; patient?: PsychologyPatient; onOpen: () => void; onRemoveCancelled?: () => void; scale: ReturnType<typeof getPsychologyAgendaScale>; simultaneous?: boolean }) {
  const height = Math.max(26, scale.eventHeightForMinutes(session.durationMinutes));
  const bucket = psychologyAgendaCardBucket(height);
  const category = sessionCategory(session);
  const serviceName = sessionServiceName(session, settings);
  const style = resolvePsychologyAgendaEventStyle({ source: 'SESSION', colors: settings.colors, modality: session.modality, location: locationForSession(settings, session), serviceName, cancelled: session.status === 'cancelada' });
  const patientName = patient?.name || 'Paciente não encontrado';
  const originLabel = sessionBookingOriginLabel(session);
  const modality = session.modality === 'online' ? 'Online' : session.locationType === 'EXTERNAL_OFFICE' ? 'Consultório Externo' : 'Presencial';
  const details = `${serviceName ? `${serviceName} · ` : ''}${modality} · ${session.durationMinutes} min`;
  const title = `${session.time} · ${patientName} · Status: ${style.cancelled ? 'Cancelada' : statusLabel[session.status]} · ${details}${originLabel ? ` · ${originLabel}` : ''}${session.sourceStatus ? ` · Origem Doctoralia: ${session.sourceStatus}` : ''}`;
  return <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => agendaTileKeyDown(event, onOpen)} aria-label={`Abrir sessão de ${patientName}`} title={title} data-testid="psychology-weekly-session" data-agenda-category={category} data-agenda-service={serviceName || ''} data-agenda-cancelled={style.cancelled ? 'true' : 'false'} data-agenda-booking-origin={session.bookingOrigin || 'UNKNOWN'} data-agenda-bucket={bucket} className={`${simultaneous ? 'min-w-0 flex-1 basis-0' : 'w-full'} group relative z-20 block shrink-0 cursor-pointer overflow-hidden rounded-lg border px-1.5 py-1 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${style.cancelled ? 'bg-white' : ''}`} style={{ height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px`, boxSizing: 'border-box', flexShrink: 0, backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.textColor }}>
    {style.cancelled && onRemoveCancelled && <button type="button" aria-label="Remover consulta cancelada" title="Remover consulta cancelada" onClick={event => { event.stopPropagation(); onRemoveCancelled(); }} className="absolute right-1 top-1 z-30 rounded-md border border-slate-200 bg-white/95 p-1 text-slate-500 shadow-sm transition hover:border-rose-300 hover:text-rose-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Trash2 size={12} /></button>}
    {bucket === 'minimal' ? <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-black leading-[14px]"><span className="shrink-0">{session.time}</span><span className="shrink-0 opacity-80">·</span><span className={`min-w-0 truncate ${style.cancelled ? 'line-through decoration-1' : ''}`}>{patientName}</span></div> : <><div className="flex min-w-0 items-center justify-between gap-1 whitespace-nowrap pr-4 text-[11px] font-black leading-[15px]"><span className="shrink-0">{session.time}</span><span className="shrink-0"><StatusPill status={session.status} previewStatus={session.previewStatus} compact labelOverride={session.status === 'agendada' ? originLabel || undefined : undefined} style={style.cancelled ? style.chipStyle : undefined} /></span></div><p className={`mt-0.5 truncate text-[11px] font-black leading-[15px] ${style.cancelled ? 'line-through decoration-1' : ''}`}>{patientName}</p>{bucket === 'full' && <div className={`mt-0.5 truncate text-[10px] font-bold leading-[13px] ${style.cancelled ? 'line-through decoration-1' : ''}`}>{details}</div>}</>}
  </div>;
}

function WeeklyPersonalTile({ commitment, settings, onOpen, scale, simultaneous = false }: { key?: React.Key; commitment: PsychologyPersonalCommitment; settings: PsychologySettings; onOpen: () => void; scale: ReturnType<typeof getPsychologyAgendaScale>; simultaneous?: boolean }) {
  const category: PsychologyAgendaCategory = commitment.type === 'Mentoria' ? 'MENTORING' : 'PERSONAL';
  const style = resolvePsychologyAgendaEventStyle({ source: commitment.type === 'Mentoria' ? 'MENTORING' : 'PERSONAL_AGENDA', colors: settings.colors });
  const height = Math.max(26, scale.eventHeightForMinutes(commitment.durationMinutes));
  const bucket = psychologyAgendaCardBucket(height);
  const title = commitment.title || commitment.type;
  const details = `${commitment.type} · ${commitment.durationMinutes} min`;
  return <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => agendaTileKeyDown(event, onOpen)} aria-label={`Abrir compromisso pessoal ${title}`} title={`${commitment.time} · ${title} · ${details}`} data-testid="psychology-weekly-personal" data-agenda-category={category} data-agenda-source="PERSONAL_AGENDA" data-agenda-bucket={bucket} className={`${simultaneous ? 'min-w-0 flex-1 basis-0' : 'w-full'} relative z-20 block shrink-0 cursor-pointer overflow-hidden rounded-lg border px-1.5 py-1 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500`} style={{ height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px`, boxSizing: 'border-box', flexShrink: 0, backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.textColor }}>{bucket === 'minimal' ? <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-black leading-[14px]"><span className="shrink-0">{commitment.time}</span><span className="shrink-0 opacity-80">·</span><span className="min-w-0 truncate">{title}</span></div> : <><div className="flex min-w-0 items-center justify-between gap-1 whitespace-nowrap text-[11px] font-black leading-[15px]"><span className="shrink-0">{commitment.time}</span><span className="min-w-0 shrink truncate rounded-full border px-1.5 py-0.5 text-[9px] font-black" style={style.chipStyle}>{commitment.type}</span></div><p className="mt-0.5 truncate text-[11px] font-black leading-[15px]">{title}</p>{bucket === 'full' && <div className="mt-0.5 truncate text-[10px] font-medium leading-[13px]">{details}</div>}</>}</div>;
}

function SessionActionsDialog({ session, patient, hasRecord, onClose, onEdit, onStatus, onRecord, readOnly }: { session: PsychologySession; patient?: PsychologyPatient; hasRecord: boolean; onClose: () => void; onEdit: () => void; onStatus: (status: PsychologySessionStatus) => void; onRecord: () => void; readOnly?: boolean }) {
  return <Dialog title="Detalhes da sessão" onClose={onClose}><div className="space-y-5"><div className={`rounded-2xl border p-4 ${sessionTone[session.modality]}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-2xl font-black">{session.time}</p><p className="mt-1 text-lg font-black">{patient?.name || 'Paciente não encontrado'}</p></div><StatusPill status={session.status} previewStatus={session.previewStatus} /></div><div className="mt-3 flex flex-wrap gap-2 text-sm font-bold"><span>{formatShortDate(session.date)}</span><span>· {session.durationMinutes} min</span><span>· {modalityLabel[session.modality]}</span></div></div><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={onEdit} className={primaryButton}><Pencil size={16} /> Editar / reagendar</button>{session.status !== 'realizada' && session.status !== 'cancelada' && <button type="button" onClick={() => onStatus('realizada')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700"><Check size={16} /> Marcar realizada</button>}{session.status !== 'cancelada' && session.status !== 'realizada' && <button type="button" onClick={() => onStatus('falta')} className={secondaryButton}>Marcar falta</button>}{session.status !== 'cancelada' && <button type="button" onClick={() => onStatus('cancelada')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-700 hover:bg-rose-100">Cancelar sessão</button>}{session.status === 'realizada' && <button type="button" onClick={onRecord} className={secondaryButton}><FileText size={16} /> {hasRecord ? 'Editar registro' : 'Registrar sessão'}</button>}</div><button type="button" onClick={onClose} className="w-full rounded-xl px-4 py-3 text-sm font-black text-slate-500 hover:bg-slate-100">Fechar</button></div></Dialog>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><p className="text-lg font-black text-slate-800">{title}</p><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{text}</p>{action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}</div>;
}

function PsychologyAvailabilitySettings({ weeklyAvailability, onChange }: { weeklyAvailability: PsychologyDailyAvailability[]; onChange: (value: PsychologyDailyAvailability[]) => void }) {
  const updateDay = (dayOfWeek: number, patch: Partial<PsychologyDailyAvailability>) => onChange(weeklyAvailability.map(day => day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day));
  const updatePeriod = (dayOfWeek: number, index: number, patch: Partial<PsychologyAgendaPeriod>) => onChange(weeklyAvailability.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.map((period, periodIndex) => periodIndex === index ? { ...period, ...patch } : period) } : day));
  const addPeriod = (dayOfWeek: number) => onChange(weeklyAvailability.map(day => day.dayOfWeek === dayOfWeek ? { ...day, enabled: true, periods: [...day.periods, { startTime: '13:00', endTime: '20:00' }] } : day));
  const removePeriod = (dayOfWeek: number, index: number) => onChange(weeklyAvailability.map(day => day.dayOfWeek === dayOfWeek ? { ...day, periods: day.periods.filter((_, periodIndex) => periodIndex !== index) } : day));
  const copyMondayToWeekdays = () => {
    const monday = weeklyAvailability.find(day => day.dayOfWeek === 1);
    if (!monday) return;
    onChange(weeklyAvailability.map(day => day.dayOfWeek >= 1 && day.dayOfWeek <= 5 ? { ...day, enabled: monday.enabled, periods: monday.periods.map(period => ({ ...period })) } : day));
  };
  return <section className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/50 p-4" data-testid="psychology-availability-settings"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Horários de atendimento</p><h4 className="mt-1 text-lg font-black text-violet-950">Disponibilidade habitual</h4><p className="mt-1 text-sm text-violet-900">Use uma ou mais faixas por dia. Isso orienta a agenda e a ocupação, mas não bloqueia horários excepcionais.</p></div><button type="button" onClick={copyMondayToWeekdays} className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-800 hover:bg-violet-100">Aplicar segunda a sexta</button></div><div className="mt-4 grid gap-2">{weeklyAvailability.map(day => <div key={day.dayOfWeek} className="rounded-xl border border-violet-100 bg-white p-3"><label className="flex items-center gap-2 text-sm font-black text-slate-800"><input type="checkbox" checked={day.enabled} onChange={event => updateDay(day.dayOfWeek, { enabled: event.target.checked })} /> Atendo neste dia · {PSYCHOLOGY_WEEKDAY_LABELS[day.dayOfWeek]}</label>{day.enabled && <div className="mt-3 space-y-2 pl-6">{day.periods.map((period, index) => <div key={`${day.dayOfWeek}-${index}`} className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold text-slate-600">Início<input aria-label={`${PSYCHOLOGY_WEEKDAY_LABELS[day.dayOfWeek]} início do período ${index + 1}`} type="time" value={period.startTime} onChange={event => updatePeriod(day.dayOfWeek, index, { startTime: event.target.value })} className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm" /></label><span className="pb-2 text-slate-400">—</span><label className="text-xs font-bold text-slate-600">Fim<input aria-label={`${PSYCHOLOGY_WEEKDAY_LABELS[day.dayOfWeek]} fim do período ${index + 1}`} type="time" value={period.endTime} onChange={event => updatePeriod(day.dayOfWeek, index, { endTime: event.target.value })} className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm" /></label><button type="button" onClick={() => removePeriod(day.dayOfWeek, index)} className="rounded-lg px-2 py-2 text-xs font-black text-slate-500 hover:bg-rose-50 hover:text-rose-700">Remover</button></div>)}<button type="button" onClick={() => addPeriod(day.dayOfWeek)} className="rounded-lg px-2 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-100">+ Adicionar período</button></div>}</div>)}</div></section>;
}

function PsychologyDaypartSettings({ dayParts, onChange }: { dayParts: PsychologyAgendaDayParts; onChange: (value: PsychologyAgendaDayParts) => void }) {
  const fields: Array<{ part: PsychologyAgendaDayPart; start: keyof PsychologyAgendaDayParts; end: keyof PsychologyAgendaDayParts }> = [
    { part: 'morning', start: 'morningStart', end: 'morningEnd' },
    { part: 'afternoon', start: 'afternoonStart', end: 'afternoonEnd' },
    { part: 'evening', start: 'eveningStart', end: 'eveningEnd' },
  ];
  return <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4" data-testid="psychology-daypart-settings"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Períodos operacionais</p><p className="mt-1 text-xs font-semibold text-slate-500">Esses intervalos alimentam os atalhos de bloqueio rápido da Agenda.</p></div><div className="mt-3 grid gap-3 sm:grid-cols-3">{fields.map(field => <div key={field.part} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black capitalize text-slate-700">{PSYCHOLOGY_AGENDA_DAYPART_LABELS[field.part]}</p><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-[11px] font-bold text-slate-500">Início<input aria-label={`${PSYCHOLOGY_AGENDA_DAYPART_LABELS[field.part]} início operacional`} type="time" value={dayParts[field.start]} onChange={event => onChange({ ...dayParts, [field.start]: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" /></label><label className="text-[11px] font-bold text-slate-500">Fim<input aria-label={`${PSYCHOLOGY_AGENDA_DAYPART_LABELS[field.part]} fim operacional`} type="time" value={dayParts[field.end]} onChange={event => onChange({ ...dayParts, [field.end]: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" /></label></div></div>)}</div></section>;
}

type PsychologySettingsTab = 'profile' | 'attendance' | 'agenda' | 'online' | 'backup';

type PsychologySettingsViewProps = {
  store: PsychologyStore;
  settings: PsychologySettings;
  patients: PsychologyPatient[];
  sessionPackages: PsychologyStore['sessionPackages'];
  onUpdatePackage: (input: PsychologySessionPackageInput) => void;
  onUpdate: (patch: Partial<PsychologySettings>) => void;
  onUpdateLocation: (id: string, patch: PsychologyLocationInput) => void;
  onCreateLocation: (input: PsychologyLocationInput) => void;
  onSetLocationColor: (id: string, color: string) => void;
  onSetPrimary: (id: string) => void;
  onSetActive: (id: string, active: boolean) => void;
  onSetColor: (category: PsychologyAgendaCategory, color: string) => void;
  onRestoreColors: () => void;
  preview?: PsychologyDoctoraliaPreview | null;
  hiddenCancelledEventCount: number;
  onRestoreHiddenCancelled: () => void;
  previewLoading: boolean;
  previewLoadError: string;
  onActivatePreview: () => void;
  onEndPreview: () => void;
  onGenerateBackup?: PsychologyBackupGenerator;
};

function SettingsSummaryCard({ title, summary, action, onAction, children }: { title: string; summary: string; action: string; onAction: () => void; children?: React.ReactNode }) {
  return <section className="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200"><div className="flex h-full items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{title}</p><p className="mt-1 break-words text-sm font-black text-slate-900 sm:text-base">{summary}</p>{children}</div><button type="button" onClick={onAction} className="shrink-0 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 transition hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-200">{action}</button></div></section>;
}

function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return <section className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:p-5" data-testid="psychology-settings-page-header"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · Psicologia</p><h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">{title}</h2><p className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-slate-500">{description}</p></div></section>;
}

function PsychologySettingsView({ store, settings, patients, sessionPackages, onUpdatePackage, onUpdate, onUpdateLocation, onCreateLocation, onSetLocationColor, onSetPrimary, onSetActive, onSetColor, onRestoreColors, preview, hiddenCancelledEventCount, onRestoreHiddenCancelled, previewLoading, previewLoadError, onActivatePreview, onEndPreview, onGenerateBackup }: PsychologySettingsViewProps) {
  const [activeTab, setActiveTab] = useState<PsychologySettingsTab>('profile');
  const [profile, setProfile] = useState(settings.professionalProfile);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Partial<Record<'displayName' | 'professionalTitle', string>>>({});
  const [agenda, setAgenda] = useState(settings.agenda);
  const [agendaEditing, setAgendaEditing] = useState(false);
  const [agendaError, setAgendaError] = useState('');
  const [showAgendaColors, setShowAgendaColors] = useState(false);
  const [attendanceSection, setAttendanceSection] = useState<'services' | 'locations' | null>(null);
  const [serviceDrafts, setServiceDrafts] = useState(settings.services);
  const [newServiceName, setNewServiceName] = useState('');
  const [newLocation, setNewLocation] = useState<PsychologyLocationInput>({ displayName: '', address: '', color: '#DC2626', active: true, isPrimary: false });
  const [newPackage, setNewPackage] = useState<PsychologySessionPackageInput>({ patientId: patients.find(patient => patient.active)?.id || '', name: 'Pacote de sessões', totalSessions: 4, usedSessions: 0, startDate: today(), active: true });
  const [reviewSelection, setReviewSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => { setProfile(settings.professionalProfile); }, [settings.professionalProfile]);
  useEffect(() => { setAgenda(settings.agenda); }, [settings.agenda]);
  useEffect(() => { setServiceDrafts(settings.services); }, [settings.services]);
  useEffect(() => {
    void syncLocalPublicBookingSettings({ locations: settings.locations.map(location => ({
      id: location.id,
      professionalId: location.professionalId,
      displayName: location.displayName,
      fullAddress: location.fullAddress || location.address || '',
      city: location.city || '',
      state: location.state || '',
      googleMapsUrl: location.googleMapsUrl || '',
      active: location.active,
      sortOrder: location.sortOrder || 1,
    })) });
  }, [settings.locations]);

  const saveProfile = () => {
    const displayName = profile.displayName.trim();
    const professionalTitle = profile.professionalTitle.trim();
    const errors: Partial<Record<'displayName' | 'professionalTitle', string>> = {};
    if (!displayName) errors.displayName = 'Informe o nome de exibição.';
    else if (displayName.length > 120) errors.displayName = 'Use até 120 caracteres.';
    if (!professionalTitle) errors.professionalTitle = 'Informe a área ou título profissional.';
    else if (professionalTitle.length > 80) errors.professionalTitle = 'Use até 80 caracteres.';
    setProfileErrors(errors);
    if (Object.keys(errors).length) return;
    onUpdate({ professionalProfile: { ...profile, displayName, professionalTitle, professionalRegistration: profile.professionalRegistration.trim(), clinicDisplayName: profile.clinicDisplayName.trim(), name: displayName, specialty: professionalTitle, crp: profile.professionalRegistration.trim() } });
    setProfileEditing(false);
    setNotice('Perfil profissional salvo no provider ativo.');
  };
  const saveAgenda = () => {
    const invalid = agenda.weeklyAvailability.some(day => day.enabled && day.periods.some(period => period.endTime <= period.startTime));
    if (invalid) { setAgendaError('Corrija os períodos: o fim precisa ser depois do início.'); return; }
    setAgendaError('');
    onUpdate({ agenda });
    setAgendaEditing(false);
    setNotice('Configuração da Agenda salva no provider ativo.');
  };
  const addService = () => {
    const name = newServiceName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    onUpdate({ services: [...settings.services, { id: `service-${Date.now()}`, professionalId: settings.scope.professionalId, context: PSYCHOLOGY_CONTEXT, name, defaultDurationMinutes: agenda.defaultDurationMinutes, defaultPrice: 0, modality: 'BOTH', active: true, createdAt: now, updatedAt: now }] });
    setNewServiceName('');
    setNotice('Serviço adicionado no provider ativo.');
  };
  const saveServices = () => { onUpdate({ services: serviceDrafts }); setAttendanceSection(null); setNotice('Serviços salvos no provider ativo.'); };
  const saveLocation = (id: string, patch: PsychologyLocationInput) => { onUpdateLocation(id, patch); setNotice('Local atualizado no provider ativo.'); };
  const addLocation = () => {
    if (!newLocation.displayName?.trim()) return;
    onCreateLocation(newLocation);
    setNewLocation({ displayName: '', address: '', color: '#DC2626', active: true, isPrimary: false });
    setNotice('Local adicionado no provider ativo.');
  };
  const categoryOrder: PsychologyAgendaCategory[] = ['ONLINE', 'PRESENTIAL_PRIMARY', 'EXTERNAL_OFFICE', 'PERSONAL', 'MENTORING'];
  const tabItems: Array<{ id: PsychologySettingsTab; label: string; description: string }> = [
    { id: 'profile', label: 'Perfil', description: 'Dados profissionais e identidade' },
    { id: 'attendance', label: 'Atendimentos', description: 'Serviços e locais presenciais' },
    { id: 'agenda', label: 'Agenda', description: 'Horários, períodos e cores' },
    { id: 'online', label: 'Agendamento Online', description: 'Link, regras e disponibilidade pública' },
    { id: 'backup', label: 'Backup e dados', description: 'Proteção e cópia dos seus dados' },
  ];
  const activeServices = settings.services.filter(service => service.active).length;
  const activeLocations = settings.locations.filter(location => location.active).length;
  const activeTabDefinition = tabItems.find(tab => tab.id === activeTab) || tabItems[0];

return <div className={psychologySettingsContainerClass} data-testid="psychology-settings"><nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-sm" data-testid="psychology-settings-tabs"><div className="flex min-w-max gap-1.5 sm:grid sm:min-w-0 sm:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="Áreas de ajustes da Psicologia">{tabItems.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} data-testid={`psychology-settings-tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`${psychologySettingsTabClass} ${activeTab === tab.id ? 'border-violet-400 bg-violet-50 text-violet-900 ring-2 ring-violet-100' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-slate-50 hover:text-violet-800'}`}><span className={psychologySettingsTabLabelClass}>{tab.label}</span><span className={`${psychologySettingsTabDescriptionClass} ${activeTab === tab.id ? 'text-violet-700' : 'text-slate-400'}`}>{tab.description}</span></button>)}</div></nav>{notice && <div role="status" className="flex w-full items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"><span>{notice}</span><button type="button" aria-label="Fechar aviso" onClick={() => setNotice('')} className="shrink-0 text-emerald-700 hover:text-emerald-900"><X size={16} /></button></div>}{activeTab !== 'messages' && activeTab !== 'online' && <SettingsPageHeader title={activeTabDefinition.label} description={activeTabDefinition.description} />}

    {activeTab === 'profile' && <div className="w-full space-y-4" data-testid="psychology-settings-panel-profile"><div className="grid gap-3 md:grid-cols-2"><SettingsSummaryCard title="Dados profissionais" summary={`${profile.displayName || 'Profissional'} · ${profile.professionalTitle || 'Psicologia'}`} action={profileEditing ? 'Fechar' : 'Editar'} onAction={() => setProfileEditing(value => !value)}><p className="mt-1 text-xs leading-relaxed text-slate-500">Registro, e-mail e telefone ficam protegidos no formulário de edição.</p></SettingsSummaryCard><SettingsSummaryCard title="Identidade profissional" summary={`${profile.clinicDisplayName || 'Gestão Clínica'} · ${profile.professionalTitle || 'Psicologia'}`} action={profileEditing ? 'Editar aberto' : 'Editar'} onAction={() => setProfileEditing(true)}><p className="mt-1 text-xs leading-relaxed text-slate-500">A apresentação usada no cabeçalho da Psicologia.</p></SettingsSummaryCard></div>{profileEditing && <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5" data-testid="psychology-profile-editor"><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome de exibição" error={profileErrors.displayName}><input aria-label="Nome de exibição" maxLength={120} value={profile.displayName} onChange={event => setProfile({ ...profile, displayName: event.target.value })} className={inputClass} /></Field><Field label="Área / título profissional" error={profileErrors.professionalTitle}><input aria-label="Área / título profissional" maxLength={80} value={profile.professionalTitle} onChange={event => setProfile({ ...profile, professionalTitle: event.target.value })} className={inputClass} /></Field><Field label="Registro profissional"><input aria-label="Registro profissional" maxLength={40} value={profile.professionalRegistration} onChange={event => setProfile({ ...profile, professionalRegistration: event.target.value })} className={inputClass} /></Field><Field label="Nome da clínica"><input aria-label="Nome da clínica" value={profile.clinicDisplayName} onChange={event => setProfile({ ...profile, clinicDisplayName: event.target.value })} className={inputClass} /></Field><Field label="E-mail profissional"><input type="email" value={profile.email} onChange={event => setProfile({ ...profile, email: event.target.value })} className={inputClass} /></Field><Field label="Telefone profissional"><input value={profile.phone} onChange={event => setProfile({ ...profile, phone: event.target.value })} className={inputClass} /></Field></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={saveProfile} className={primaryButton}>Salvar perfil</button><button type="button" onClick={() => { setProfile(settings.professionalProfile); setProfileErrors({}); setProfileEditing(false); }} className={secondaryButton}>Cancelar</button></div></section>}</div>}

    {activeTab === 'attendance' && <div className="space-y-3" data-testid="psychology-settings-panel-attendance"><div className="grid gap-3 md:grid-cols-2"><SettingsSummaryCard title="Serviços" summary={`${activeServices} ativos`} action={attendanceSection === 'services' ? 'Fechar' : 'Gerenciar'} onAction={() => setAttendanceSection(value => value === 'services' ? null : 'services')}><p className="mt-1 text-xs text-slate-500">Nome, ativo, ordem, duração e modalidade do atendimento.</p></SettingsSummaryCard><SettingsSummaryCard title="Locais presenciais" summary={`${activeLocations} ativos`} action={attendanceSection === 'locations' ? 'Fechar' : 'Gerenciar'} onAction={() => setAttendanceSection(value => value === 'locations' ? null : 'locations')}><p className="mt-1 text-xs text-slate-500">Cadastro local preservado para Agenda e consultas.</p></SettingsSummaryCard></div>{attendanceSection === 'services' && <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm" data-testid="psychology-services-settings"><div className="space-y-2">{serviceDrafts.map(service => <div key={service.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_120px_150px_auto] md:items-end"><label className="text-xs font-bold text-slate-600">Nome<input value={service.name} onChange={event => setServiceDrafts(current => current.map(item => item.id === service.id ? { ...item, name: event.target.value } : item))} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Duração<input type="number" min="5" value={service.defaultDurationMinutes} onChange={event => setServiceDrafts(current => current.map(item => item.id === service.id ? { ...item, defaultDurationMinutes: Number(event.target.value) } : item))} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Modalidade<select value={service.modality} onChange={event => setServiceDrafts(current => current.map(item => item.id === service.id ? { ...item, modality: event.target.value as typeof service.modality } : item))} className={`${inputClass} mt-1`}><option value="BOTH">Online e presencial</option><option value="ONLINE">Online</option><option value="PRESENTIAL">Presencial</option></select></label><label className="flex items-center gap-2 pb-3 text-xs font-black text-slate-700"><input type="checkbox" checked={service.active} onChange={event => setServiceDrafts(current => current.map(item => item.id === service.id ? { ...item, active: event.target.checked } : item))} /> Ativo</label></div></div>)}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={newServiceName} onChange={event => setNewServiceName(event.target.value)} placeholder="Nome do novo serviço" className={`${inputClass} flex-1`} /><button type="button" onClick={addService} className={secondaryButton}>Adicionar serviço</button><button type="button" onClick={() => { void saveServices(); }} className={primaryButton}>Salvar serviços</button></div></section>}{attendanceSection === 'locations' && <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm" data-testid="psychology-locations-settings"><div className="grid gap-3 md:grid-cols-2">{settings.locations.map(location => <LocationEditorCanonical key={location.id} location={location} onSave={patch => saveLocation(location.id, patch)} onSetColor={color => onSetLocationColor(location.id, color)} onSetPrimary={() => onSetPrimary(location.id)} onSetActive={active => onSetActive(location.id, active)} />)}</div><div className="mt-4 rounded-xl border border-dashed border-violet-200 bg-violet-50/60 p-3"><p className="text-sm font-black text-violet-950">Adicionar local</p><div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"><Field label="Nome"><input aria-label="Nome do novo local" value={newLocation.displayName} onChange={event => setNewLocation({ ...newLocation, displayName: event.target.value })} className={inputClass} /></Field><Field label="Endereço completo"><input aria-label="Endereço do novo local" value={newLocation.address || ''} onChange={event => setNewLocation({ ...newLocation, address: event.target.value })} className={inputClass} /></Field><button type="button" onClick={addLocation} className={primaryButton}><Plus size={15} /> Adicionar local</button></div></div></section>}</div>}

    {activeTab === 'agenda' && <div className="space-y-3" data-testid="psychology-settings-panel-agenda"><div className="grid gap-3 md:grid-cols-2"><SettingsSummaryCard title="Horário habitual" summary={`${agenda.weeklyAvailability.filter(day => day.enabled).length} dias ativos · ${agenda.defaultDurationMinutes} min`} action={agendaEditing ? 'Fechar' : 'Editar'} onAction={() => setAgendaEditing(value => !value)}><p className="mt-1 text-xs text-slate-500">Duração padrão, intervalos e faixas por dia.</p></SettingsSummaryCard><SettingsSummaryCard title="Períodos do dia" summary="Manhã · Tarde · Noite" action={agendaEditing ? 'Editando' : 'Editar'} onAction={() => setAgendaEditing(true)}><p className="mt-1 text-xs text-slate-500">Os atalhos da Agenda usam esses limites administrativos.</p></SettingsSummaryCard></div><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Ações rápidas</p><p className="mt-1 text-sm font-black text-slate-900">Bloqueio público disponível pela Agenda</p></div><button type="button" onClick={() => setActiveTab('agenda')} className={secondaryButton}>Configurar</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Cores da Agenda</p><div className="mt-2 flex flex-wrap gap-2">{categoryOrder.map(category => <span key={category} className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: settings.colors[category] }} />{PSYCHOLOGY_CATEGORY_LABELS[category]}</span>)}</div></div><button type="button" onClick={() => setShowAgendaColors(value => !value)} className={secondaryButton}>{showAgendaColors ? 'Fechar' : 'Personalizar'}</button></div>{showAgendaColors && <div className="mt-4 grid gap-2 sm:grid-cols-2">{categoryOrder.map(category => <label key={category} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"><span>{PSYCHOLOGY_CATEGORY_LABELS[category]}</span><input type="color" value={settings.colors[category]} onChange={event => onSetColor(category, event.target.value)} aria-label={`Cor ${PSYCHOLOGY_CATEGORY_LABELS[category]}`} className="h-8 w-10" /></label>)}</div>}</section>{agendaEditing && <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm" data-testid="psychology-agenda-settings-editor"><div className="grid gap-3 sm:grid-cols-2"><Field label="Duração padrão"><input type="number" min="1" value={agenda.defaultDurationMinutes} onChange={event => setAgenda({ ...agenda, defaultDurationMinutes: Number(event.target.value) })} className={inputClass} /></Field><Field label="Intervalo entre sessões"><input type="number" min="0" value={agenda.intervalMinutes} onChange={event => setAgenda({ ...agenda, intervalMinutes: Number(event.target.value) })} className={inputClass} /></Field></div><PsychologyAvailabilitySettings weeklyAvailability={agenda.weeklyAvailability} onChange={weeklyAvailability => setAgenda({ ...agenda, weeklyAvailability })} /><PsychologyDaypartSettings dayParts={agenda.dayParts} onChange={dayParts => setAgenda({ ...agenda, dayParts })} />{agendaError && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700" role="alert">{agendaError}</p>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={saveAgenda} className={primaryButton}>Salvar Agenda</button><button type="button" onClick={() => { setAgenda(settings.agenda); setAgendaError(''); setAgendaEditing(false); }} className={secondaryButton}>Cancelar</button></div></section>}</div>}

    {activeTab === 'online' && <div data-testid="psychology-settings-panel-online"><PublicBookingSettingsPanel /></div>}

    {activeTab === 'backup' && <div className="space-y-3" data-testid="psychology-settings-panel-backup"><PsychologyImportExport store={store} onGenerateBackup={onGenerateBackup} /></div>}

  </div>;
}

function LocationEditorCanonical({ location, onSave, onSetColor, onSetPrimary, onSetActive }: { key?: React.Key; location: PsychologyLocation; onSave: (patch: PsychologyLocationInput) => void; onSetColor: (color: string) => void; onSetPrimary: () => void; onSetActive: (active: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ displayName: location.displayName, fullAddress: location.fullAddress || location.address || '', city: location.city || '', state: location.state || '', googleMapsUrl: location.googleMapsUrl || '', sortOrder: location.sortOrder || 1 });
  const [error, setError] = useState('');
  useEffect(() => { setDraft({ displayName: location.displayName, fullAddress: location.fullAddress || location.address || '', city: location.city || '', state: location.state || '', googleMapsUrl: location.googleMapsUrl || '', sortOrder: location.sortOrder || 1 }); }, [location]);
  const save = () => {
    const displayName = draft.displayName.trim();
    const googleMapsUrl = draft.googleMapsUrl.trim();
    if (!displayName) { setError('Informe o nome do local.'); return; }
    if (!isValidGoogleMapsUrl(googleMapsUrl)) { setError('Informe uma URL HTTPS válida do Google Maps.'); return; }
    setError('');
    onSave({ displayName, address: draft.fullAddress.trim(), fullAddress: draft.fullAddress.trim(), city: draft.city.trim(), state: draft.state.trim().toUpperCase(), googleMapsUrl, sortOrder: Math.max(1, draft.sortOrder) });
    setEditing(false);
  };
  const setField = (field: keyof typeof draft, value: string | number) => setDraft(current => ({ ...current, [field]: value }));
 return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div><p className="text-sm font-black">{location.isPrimary ? 'Local principal' : 'Local presencial'}</p><p className="mt-1 font-black text-slate-900">{location.displayName}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${location.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{location.active ? 'Ativo' : 'Inativo'}</span></div>{!editing && <><p className="mt-3 whitespace-pre-line text-sm font-semibold text-slate-600">{location.fullAddress || location.address || 'Endereço não informado.'}</p>{!location.fullAddress && !location.address && <p className="mt-2 text-xs font-bold text-amber-800">Complete o endereço para exibi-lo ao paciente.</p>}{location.active && !isLocationReadyForReminder({ displayName: location.displayName, fullAddress: location.fullAddress, address: location.address, googleMapsUrl: location.googleMapsUrl }) && <p className="mt-2 text-xs font-bold text-amber-800">{LOCATION_REMINDER_INCOMPLETE_MESSAGE}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setEditing(true)} className={secondaryButton}><Pencil size={15} /> Editar local</button>{location.active && !location.isPrimary && <button type="button" onClick={onSetPrimary} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">Definir principal</button>}<button type="button" onClick={() => onSetActive(!location.active)} className="rounded-xl px-3 py-2 text-xs font-black text-slate-500 hover:bg-white">{location.active ? 'Desativar' : 'Ativar'}</button></div></>}{editing && <div className="mt-3 space-y-3"><label className="block text-xs font-bold text-slate-600">Nome do local<input aria-label={`Nome do local ${location.displayName}`} value={draft.displayName} onChange={event => setField('displayName', event.target.value)} className={`${inputClass} mt-1`} /></label><label className="block text-xs font-bold text-slate-600">Endereço completo<textarea aria-label={`Endereço completo do local ${location.displayName}`} value={draft.fullAddress} onChange={event => setField('fullAddress', event.target.value)} className={`${inputClass} mt-1 min-h-24`} placeholder="Rua, número, sala, bairro" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Cidade<input aria-label={`Cidade do local ${location.displayName}`} value={draft.city} onChange={event => setField('city', event.target.value)} className={`${inputClass} mt-1`} /></label><label className="text-xs font-bold text-slate-600">Estado<input aria-label={`Estado do local ${location.displayName}`} value={draft.state} maxLength={2} onChange={event => setField('state', event.target.value)} className={`${inputClass} mt-1`} /></label></div><label className="block text-xs font-bold text-slate-600">Link do Google Maps<input aria-label={`Google Maps do local ${location.displayName}`} value={draft.googleMapsUrl} onChange={event => setField('googleMapsUrl', event.target.value)} className={`${inputClass} mt-1`} placeholder="https://maps.google.com/..." /></label><label className="block text-xs font-bold text-slate-600">Ordem<input aria-label={`Ordem do local ${location.displayName}`} type="number" min="1" value={draft.sortOrder} onChange={event => setField('sortOrder', Number(event.target.value))} className={`${inputClass} mt-1`} /></label><div className="flex flex-wrap gap-2"><button type="button" onClick={save} className={primaryButton}>Salvar local</button><button type="button" onClick={() => { setError(''); setEditing(false); }} className={secondaryButton}>Cancelar</button></div>{error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}</div>}</div>;
}

function LocationEditor({ location, onSave, onSetColor, onSetPrimary, onSetActive }: { key?: React.Key; location: PsychologyLocation; onSave: (patch: PsychologyLocationInput) => void; onSetColor: (color: string) => void; onSetPrimary: () => void; onSetActive: (active: boolean) => void }) {
  const [name, setName] = useState(location.displayName);
  const [address, setAddress] = useState(location.address || '');
  useEffect(() => { setName(location.displayName); setAddress(location.address || ''); }, [location.displayName, location.address]);
 return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div><p className="text-sm font-black">{location.isPrimary ? 'Local principal' : 'Local presencial'}</p><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${location.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{location.active ? 'Ativo' : 'Inativo'}</span></div><label className="mt-3 block text-xs font-bold text-slate-600">Nome<input aria-label={`Nome do local ${location.displayName}`} value={name} onChange={event => setName(event.target.value)} className={`${inputClass} mt-1`} /></label><label className="mt-3 block text-xs font-bold text-slate-600">Endereço (opcional)<input aria-label={`Endereço do local ${location.displayName}`} value={address} onChange={event => setAddress(event.target.value)} className={`${inputClass} mt-1`} /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onSave({ displayName: name, address })} className={secondaryButton}>Salvar local</button>{location.active && !location.isPrimary && <button type="button" onClick={onSetPrimary} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">Definir principal</button>}<button type="button" onClick={() => onSetActive(!location.active)} className="rounded-xl px-3 py-2 text-xs font-black text-slate-500 hover:bg-white">{location.active ? 'Desativar' : 'Ativar'}</button></div></div>;
}

function PatientDialogR2F3E({ value, onClose, onSave }: { value: PsychologyPatient | null; onClose: () => void; onSave: (input: PsychologyPatientInput) => boolean | Promise<boolean> }) {
  const emptyResponsible = { fullName: '', relationship: '', phone: '', email: '' };
  const [form, setForm] = useState<PsychologyPatientInput>({ name: value?.name || '', dateOfBirth: value?.dateOfBirth || value?.birthDate || '', phone: value?.phone || '', email: value?.email || '', administrativeResponsible: value?.administrativeResponsible || emptyResponsible, preferredModality: value?.preferredModality || 'presencial', administrativeNote: value?.administrativeNotes || value?.administrativeNote || '', active: value?.active ?? true, externalReferences: value?.externalReferences });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  const referenceDate = civilDateFromDate(new Date());
  const showResponsible = requiresResponsible(String(form.dateOfBirth || form.birthDate || ''), referenceDate);
  const clearErrors = (keys: string[]) => setErrors(current => {
    const next = { ...current };
    let changed = false;
    keys.forEach(key => { if (key in next) { delete next[key]; changed = true; } });
    return changed ? next : current;
  });
  const updateForm = (patch: Partial<PsychologyPatientInput>, errorKeys: string[]) => {
    setForm(current => ({ ...current, ...patch }));
    clearErrors(errorKeys);
  };
  const updateResponsible = (field: 'fullName' | 'relationship' | 'phone' | 'email', value: string) => {
    setForm(current => ({ ...current, administrativeResponsible: { ...emptyResponsible, ...current.administrativeResponsible, [field]: value } }));
    clearErrors([`administrativeResponsible.${field}`]);
  };
  useEffect(() => {
    const keys = ['administrativeResponsible.phone', 'administrativeResponsible.email'].filter(key => {
      const field = key.endsWith('.phone') ? form.administrativeResponsible?.phone : form.administrativeResponsible?.email;
      return !String(field || '').trim();
    });
    if (keys.length > 0) clearErrors(keys);
  }, [form.administrativeResponsible?.email, form.administrativeResponsible?.phone]);
  const save = (event: React.FormEvent) => { event.preventDefault(); const nextErrors = validatePsychologyPatientProfile(form) as Record<string, string>; setErrors(nextErrors); setSubmitError(''); if (Object.keys(nextErrors).length !== 0 || submitLock.current) return; submitLock.current = true; setIsSubmitting(true); const finish = (valueSaved: boolean) => { setIsSubmitting(false); if (!valueSaved) { submitLock.current = false; setSubmitError('Não foi possível salvar o paciente. Nenhuma alteração foi realizada.'); } }; try { const saved = onSave({ ...form, dateOfBirth: String(form.dateOfBirth || form.birthDate || ''), birthDate: undefined }); if (saved instanceof Promise) void saved.then(finish).catch(() => finish(false)); else finish(saved); } catch { finish(false); } };
  return <Dialog title={value ? 'Editar paciente' : 'Novo paciente'} onClose={onClose} wide><form onSubmit={save} className="space-y-4" data-testid="psychology-patient-dialog-form"><Field label="Nome completo *" error={errors.name}><input required autoFocus value={form.name} onChange={event => updateForm({ name: event.target.value }, ['name'])} className={inputClass} /></Field><div className="grid gap-3 md:grid-cols-2"><Field label="Data de nascimento (opcional)" error={errors.dateOfBirth || errors.birthDate}><input type="date" max={referenceDate} value={form.dateOfBirth || form.birthDate || ''} onChange={event => updateForm({ dateOfBirth: event.target.value, birthDate: undefined }, ['dateOfBirth', 'birthDate'])} className={inputClass} /></Field><Field label="Telefone *" error={errors.phone}><input required minLength={8} value={form.phone} onChange={event => updateForm({ phone: event.target.value }, ['phone'])} className={inputClass} /></Field></div><div className="grid gap-3 md:grid-cols-2"><Field label="E-mail (opcional)" error={errors.email}><input type="email" value={form.email} onChange={event => updateForm({ email: event.target.value }, ['email'])} className={inputClass} /></Field><Field label="Modalidade preferencial *"><select required value={form.preferredModality} onChange={event => updateForm({ preferredModality: event.target.value as PsychologyModality }, [])} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field></div>{showResponsible && <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4" data-testid="psychology-patient-responsible"><div><p className="text-sm font-black text-amber-950">Dados do responsável</p><p className="mt-1 text-xs font-semibold text-amber-900">Paciente com menos de 18 anos na data de hoje. Todos os campos são opcionais.</p></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Nome completo do responsável" error={errors['administrativeResponsible.fullName']}><input value={form.administrativeResponsible?.fullName || ''} onChange={event => updateResponsible('fullName', event.target.value)} className={inputClass} /></Field><Field label="Vínculo / parentesco" error={errors['administrativeResponsible.relationship']}><input value={form.administrativeResponsible?.relationship || ''} onChange={event => updateResponsible('relationship', event.target.value)} className={inputClass} /></Field><Field label="Telefone do responsável" error={errors['administrativeResponsible.phone']}><input value={form.administrativeResponsible?.phone || ''} onChange={event => updateResponsible('phone', event.target.value)} className={inputClass} /></Field><Field label="E-mail do responsável" error={errors['administrativeResponsible.email']}><input type="email" value={form.administrativeResponsible?.email || ''} onChange={event => updateResponsible('email', event.target.value)} className={inputClass} /></Field></div></div>}{!showResponsible && value?.administrativeResponsible && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">Dados históricos do responsável permanecem preservados, mas não são exigidos pela idade atual.</p>}{value && <Field label="Observação administrativa"><textarea value={form.administrativeNote} onChange={event => updateForm({ administrativeNote: event.target.value }, [])} className={`${inputClass} min-h-20`} /></Field>}{submitError && <p role="alert" data-testid="psychology-patient-save-error" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{submitError}</p>}<div data-testid="psychology-patient-dialog-footer" className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" disabled={isSubmitting} className={primaryButton}>{isSubmitting ? 'Salvando...' : 'Salvar paciente'}</button></div></form></Dialog>;
}

function PatientDialog({ value, onClose, onSave }: { value: PsychologyPatient | null; onClose: () => void; onSave: (input: PsychologyPatientInput) => void }) {
  const [form, setForm] = useState<PsychologyPatientInput>({ name: value?.name || '', birthDate: value?.birthDate || '', phone: value?.phone || '', email: value?.email || '', preferredModality: value?.preferredModality || 'presencial', administrativeNote: value?.administrativeNotes || value?.administrativeNote || '', active: value?.active ?? true, externalReferences: value?.externalReferences });
  const [errors, setErrors] = useState<Partial<Record<keyof PsychologyPatientInput, string>>>({});
  const save = (event: React.FormEvent) => { event.preventDefault(); const nextErrors = validatePsychologyPatientProfile(form); setErrors(nextErrors); if (Object.keys(nextErrors).length === 0) onSave(form); };
  return <Dialog title={value ? 'Editar paciente' : 'Novo paciente'} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Nome" error={errors.name}><input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={inputClass} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Data de nascimento" error={errors.birthDate}><input type="date" value={form.birthDate} onChange={event => setForm({ ...form, birthDate: event.target.value })} className={inputClass} /></Field><Field label="Telefone" error={errors.phone}><input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} className={inputClass} /></Field></div><Field label="E-mail (opcional)"><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className={inputClass} /></Field><Field label="Modalidade preferencial"><select value={form.preferredModality} onChange={event => setForm({ ...form, preferredModality: event.target.value as PsychologyModality })} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field><Field label="Observação administrativa (opcional)"><textarea value={form.administrativeNote} onChange={event => setForm({ ...form, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /></Field><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" className={primaryButton}>Salvar paciente</button></div></form></Dialog>;
}

function DeletePatientDialog({ assessment, onClose, onConfirm }: { assessment: ReturnType<typeof getPsychologyPatientDeletionAssessment>; onClose: () => void; onConfirm: () => boolean | Promise<boolean> }) {
  if (!assessment) return null;
  const { impact } = assessment;
  const submitLock = useRef(false);
  const confirm = () => { if (submitLock.current) return; submitLock.current = true; const result = onConfirm(); if (result instanceof Promise) void result.then(value => { if (!value) submitLock.current = false; }); else if (!result) submitLock.current = false; };
  return <Dialog title="Excluir definitivamente?" onClose={onClose}><div className="space-y-4"><p className="text-sm leading-relaxed text-slate-700">Esta ação é irreversível e excluirá definitivamente o paciente e as relações comprovadas, incluindo sessões, registros, pacotes, documentos, anexos, cobranças e pagamentos.</p><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="font-black text-slate-900">Paciente</p><p className="mt-1 text-sm font-bold text-slate-700">{assessment.patient.name}</p><dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5"><div><dt className="font-bold text-slate-500">Sessões</dt><dd className="font-black">{impact.sessions}</dd></div><div><dt className="font-bold text-slate-500">Registros</dt><dd className="font-black">{impact.records}</dd></div><div><dt className="font-bold text-slate-500">Cobranças</dt><dd className="font-black">{impact.charges}</dd></div><div><dt className="font-bold text-slate-500">Documentos</dt><dd className="font-black">{impact.documents}</dd></div><div><dt className="font-bold text-slate-500">Pacotes</dt><dd className="font-black">{impact.packages}</dd></div></dl><p className="mt-3 text-xs font-bold text-slate-500">Pagamentos encontrados: {impact.payments} · anexos: {impact.attachments}</p></div><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={secondaryButton}>Cancelar</button><button type="button" onClick={confirm} disabled={!assessment.canDelete} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={15} /> Excluir definitivamente</button></div></div></Dialog>;
}

function LegacyEventCreationDialog({ defaults, store, settings, onClose, onNewPatient, onSaveSession, onSavePersonal }: { defaults: NewEventDefaults; store: PsychologyStore; settings: PsychologySettings; onClose: () => void; onNewPatient: () => void; onSaveSession: (input: PsychologySessionInput) => void; onSavePersonal: (input: PsychologyPersonalInput) => void }) {
  const [kind, setKind] = useState<NewEventKind>(defaults.kind);
  const [sessionForm, setSessionForm] = useState<PsychologySessionInput>({ patientId: store.patients.find(patient => patient.active)?.id || '', date: defaults.date, time: defaults.time, durationMinutes: settings.agenda.defaultDurationMinutes, modality: 'presencial', locationId: primaryPsychologyLocation(settings)?.id, locationType: primaryPsychologyLocation(settings)?.type, administrativeNote: '' });
  const [personalForm, setPersonalForm] = useState<PsychologyPersonalInput>({ date: defaults.date, time: defaults.time, durationMinutes: 60, type: defaults.kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal', title: '', note: '', recurrence: 'Não repetir', alarmEnabled: false, alarmAdvance: 'Na hora', alarmVolume: 80, alarmFadeIn: false });
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const movable = useMovableDialog();
  const tabs: Array<{ id: NewEventKind; label: string }> = [{ id: 'session', label: 'Sessão' }, { id: 'personal', label: 'Pessoal' }, { id: 'mentoring', label: 'Mentoria' }];
  const isSession = kind === 'session';
  useEffect(() => {
    if (!isSession) return;
    const serviceId = synchronizePsychologyServiceForPatient(store, sessionForm.patientId, sessionForm.serviceId);
    if (serviceId === sessionForm.serviceId) return;
    const service = settings.services.find(item => item.id === serviceId);
    setSessionForm(current => ({ ...current, serviceId, durationMinutes: service?.defaultDurationMinutes || current.durationMinutes }));
  }, [isSession, sessionForm.patientId, sessionForm.serviceId, settings.services, store]);
  const selectedType: PsychologyPersonalType = kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal';
  const updateKind = (next: NewEventKind) => { setKind(next); setError(''); if (next !== 'session') setPersonalForm(form => ({ ...form, type: next === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal' })); };
  const save = (event: React.FormEvent) => { event.preventDefault(); if (isSession) { const nextError = validatePsychologySession(sessionForm, store); setError(nextError || ''); if (nextError) return; if (!isPsychologyDateTimeWithinAvailability(settings.agenda, sessionForm.date, sessionForm.time)) { setOutsideAvailability(true); return; } onSaveSession(sessionForm); return; } if (!personalForm.date || !personalForm.time) { setError('Informe data e horário.'); return; } if (!personalForm.title.trim()) { setError('Informe um título para o compromisso.'); return; } onSavePersonal({ ...personalForm, type: selectedType }); };
  return <div className="fixed inset-0 z-[200] bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Novo agendamento"><section ref={movable.dialogRef} style={movable.positionStyle} className="absolute flex max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><header {...movable.dragHandleProps} data-testid="psychology-event-dialog-drag-handle" className={`sticky top-0 z-10 border-b border-slate-200 bg-white px-5 pb-0 pt-4 select-none ${movable.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Arraste para mover</p><h2 className="mt-1 text-xl font-black text-slate-900">Organize sua agenda</h2></div><button type="button" data-no-dialog-drag onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><div className="mt-5 flex gap-1 overflow-x-auto">{tabs.map(tab => <button key={tab.id} type="button" onClick={() => updateKind(tab.id)} className={`border-b-2 px-4 py-3 text-sm font-black transition ${kind === tab.id ? 'border-violet-700 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab.label}</button>)}</div></header><form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><div className="grid gap-3 sm:grid-cols-2"><Field label="Data"><input type="date" value={isSession ? sessionForm.date : personalForm.date} onChange={event => isSession ? setSessionForm({ ...sessionForm, date: event.target.value }) : setPersonalForm({ ...personalForm, date: event.target.value })} className={inputClass} /></Field><Field label="Horário"><input type="time" value={isSession ? sessionForm.time : personalForm.time} onChange={event => isSession ? setSessionForm({ ...sessionForm, time: event.target.value }) : setPersonalForm({ ...personalForm, time: event.target.value })} className={inputClass} /></Field></div>{isSession ? <><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><Field label="Paciente"><select autoFocus value={sessionForm.patientId} onChange={event => setSessionForm({ ...sessionForm, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><button type="button" onClick={onNewPatient} className="mt-6 shrink-0 text-sm font-black text-violet-700 hover:underline">+ Novo paciente</button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Duração"><select value={sessionForm.durationMinutes} onChange={event => setSessionForm({ ...sessionForm, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="50">50 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></Field><Field label="Modalidade"><select value={sessionForm.modality} onChange={event => { const modality = event.target.value as PsychologyModality; setSessionForm({ ...sessionForm, modality, locationId: modality === 'online' ? undefined : settings.locations.find(location => location.type === 'PRIMARY_OFFICE')?.id, locationType: modality === 'online' ? undefined : 'PRIMARY_OFFICE' }); }} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field></div>{sessionForm.modality === 'presencial' && <Field label="Local"><select value={sessionForm.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setSessionForm({ ...sessionForm, locationId: location?.id, locationType: location?.type }); }} className={inputClass}>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.type === 'PRIMARY_OFFICE' ? `Presencial — ${location.displayName}` : location.displayName}</option>)}</select></Field>}<Field label="Observação (opcional)"><textarea value={sessionForm.administrativeNote} onChange={event => setSessionForm({ ...sessionForm, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /></Field></> : <><Field label="Título"><input autoFocus placeholder={selectedType === 'Mentoria' ? 'Ex.: Mentoria profissional' : 'Ex.: Compromisso pessoal'} value={personalForm.title} onChange={event => setPersonalForm({ ...personalForm, title: event.target.value })} className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Duração"><select value={personalForm.durationMinutes} onChange={event => setPersonalForm({ ...personalForm, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></Field><Field label="Categoria"><div className="flex h-[46px] items-center rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-sm font-black text-violet-900">{selectedType}</div></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Recorrência"><select value={personalForm.recurrence} onChange={event => setPersonalForm({ ...personalForm, recurrence: event.target.value as PsychologyPersonalInput['recurrence'] })} className={inputClass}><option>Não repetir</option><option>Toda semana</option><option>Todo mês</option></select></Field><label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold"><input type="checkbox" checked={Boolean(personalForm.alarmEnabled)} onChange={event => setPersonalForm({ ...personalForm, alarmEnabled: event.target.checked })} /> Ativar alarme local</label></div>{personalForm.alarmEnabled && <Field label="Antecedência"><select value={personalForm.alarmAdvance} onChange={event => setPersonalForm({ ...personalForm, alarmAdvance: event.target.value as PsychologyPersonalInput['alarmAdvance'] })} className={inputClass}>{ALARM_ADVANCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>}<Field label="Observação (opcional)"><textarea value={personalForm.note} onChange={event => setPersonalForm({ ...personalForm, note: event.target.value })} className={`${inputClass} min-h-24`} /></Field></>}{isSession && outsideAvailability && <div role="alert" data-testid="psychology-outside-availability-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSaveSession(sessionForm); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}</div><footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="submit" className={primaryButton}>{isSession ? 'Agendar sessão' : 'Salvar compromisso'}</button></footer></form></section></div>;
}

function EventCreationDialog({ defaults, store, settings, onClose, onNewPatient, onSaveSession, onSavePersonal }: { defaults: NewEventDefaults; store: PsychologyStore; settings: PsychologySettings; onClose: () => void; onNewPatient: () => void; onSaveSession: (input: PsychologySessionInput) => boolean; onSavePersonal: (input: PsychologyPersonalInput) => boolean }) {
  const firstService = settings.services.find(service => service.active) || settings.services[0];
  const primaryLocation = primaryPsychologyLocation(settings);
  const defaultPatientId = store.patients.find(patient => patient.active)?.id || '';
  const defaultServiceId = synchronizePsychologyServiceForPatient(store, defaultPatientId, firstService?.id);
  const defaultService = settings.services.find(service => service.id === defaultServiceId) || firstService;
  const [kind, setKind] = useState<NewEventKind>(defaults.kind);
  const [sessionForm, setSessionForm] = useState<PsychologySessionInput>({ patientId: defaultPatientId, date: defaults.date, time: defaults.time, durationMinutes: defaultService?.defaultDurationMinutes || settings.agenda.defaultDurationMinutes, modality: 'presencial', serviceId: defaultService?.id, locationId: primaryLocation?.id, locationType: primaryLocation?.type, administrativeNote: '' });
  const [personalForm, setPersonalForm] = useState<PsychologyPersonalInput>({ date: defaults.date, time: defaults.time, durationMinutes: 60, type: defaults.kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal', title: '', note: '', recurrence: 'Não repetir', alarmEnabled: false, alarmAdvance: 'Na hora', alarmVolume: 80, alarmFadeIn: false });
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const submitLock = useRef(false);
  const movable = useMovableDialog();
  const tabs: Array<{ id: NewEventKind; label: string }> = [{ id: 'session', label: 'Sessão' }, { id: 'personal', label: 'Pessoal' }, { id: 'mentoring', label: 'Mentoria' }];
  const isSession = kind === 'session';
  const selectedType: PsychologyPersonalType = kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal';
  const servicesForModality = settings.services.filter(service => service.active && (sessionForm.modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE'));
  const selectedService = settings.services.find(service => service.id === sessionForm.serviceId);
  const updateKind = (next: NewEventKind) => { setKind(next); setError(''); if (next !== 'session') setPersonalForm(form => ({ ...form, type: next === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal' })); };
  const updateModality = (modality: PsychologyModality) => {
    const nextService = settings.services.find(service => service.id === sessionForm.serviceId && service.active && (modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE')) || settings.services.find(service => service.active && (modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE'));
    const nextLocation = modality === 'online' ? undefined : primaryPsychologyLocation(settings);
    setSessionForm({ ...sessionForm, modality, serviceId: nextService?.id, durationMinutes: nextService?.defaultDurationMinutes || sessionForm.durationMinutes, locationId: nextLocation?.id, locationType: nextLocation?.type });
  };
  const updateService = (serviceId: string) => {
    const service = settings.services.find(item => item.id === serviceId);
    setSessionForm({ ...sessionForm, serviceId, durationMinutes: service?.defaultDurationMinutes || sessionForm.durationMinutes });
  };
  const commit = (kindToSave: 'session' | 'personal') => {
    if (submitLock.current) return;
    submitLock.current = true;
    const saved = kindToSave === 'session' ? onSaveSession(sessionForm) : onSavePersonal({ ...personalForm, type: selectedType });
    if (!saved) submitLock.current = false;
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSession) {
      const nextError = validatePsychologySession(sessionForm, store, { requireService: true, checkConflicts: true });
      setError(nextError || '');
      if (nextError) return;
      if (!isPsychologyDateTimeWithinAvailability(settings.agenda, sessionForm.date, sessionForm.time)) { setOutsideAvailability(true); return; }
      commit('session');
      return;
    }
    if (!personalForm.date || !personalForm.time) { setError('Informe data e horário.'); return; }
    if (!personalForm.title.trim()) { setError('Informe um título para o compromisso.'); return; }
    commit('personal');
  };
  return <div className="fixed inset-0 z-[200] bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Novo agendamento"><section ref={movable.dialogRef} style={movable.positionStyle} className="absolute flex max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><header {...movable.dragHandleProps} data-testid="psychology-event-dialog-drag-handle" className={`sticky top-0 z-10 border-b border-slate-200 bg-white px-5 pb-0 pt-4 select-none ${movable.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Arraste para mover</p><h2 className="mt-1 text-xl font-black text-slate-900">Organize sua agenda</h2></div><button type="button" data-no-dialog-drag onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><div className="mt-5 flex gap-1 overflow-x-auto">{tabs.map(tab => <button key={tab.id} type="button" onClick={() => updateKind(tab.id)} className={`border-b-2 px-4 py-3 text-sm font-black transition ${kind === tab.id ? 'border-violet-700 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab.label}</button>)}</div></header><form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><div className="grid gap-3 sm:grid-cols-2"><Field label="Data"><input required type="date" value={isSession ? sessionForm.date : personalForm.date} onChange={event => isSession ? setSessionForm({ ...sessionForm, date: event.target.value }) : setPersonalForm({ ...personalForm, date: event.target.value })} className={inputClass} /></Field><Field label="Horário"><input required type="time" value={isSession ? sessionForm.time : personalForm.time} onChange={event => isSession ? setSessionForm({ ...sessionForm, time: event.target.value }) : setPersonalForm({ ...personalForm, time: event.target.value })} className={inputClass} /></Field></div>{isSession ? <><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><Field label="Paciente"><select required autoFocus value={sessionForm.patientId} onChange={event => setSessionForm({ ...sessionForm, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><button type="button" onClick={onNewPatient} className="mt-6 shrink-0 text-sm font-black text-violet-700 hover:underline">+ Novo paciente</button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Serviço"><select required value={sessionForm.serviceId || ''} onChange={event => updateService(event.target.value)} className={inputClass}><option value="">Selecione um serviço</option>{servicesForModality.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Duração do serviço"><div data-testid="psychology-service-duration" className="flex h-[46px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-black text-slate-700">{selectedService?.defaultDurationMinutes ?? sessionForm.durationMinutes} minutos</div></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Modalidade"><select required value={sessionForm.modality} onChange={event => updateModality(event.target.value as PsychologyModality)} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field>{sessionForm.modality === 'presencial' && <Field label="Local"><select required value={sessionForm.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setSessionForm({ ...sessionForm, locationId: location?.id, locationType: location?.type }); }} className={inputClass}><option value="">Selecione um local</option>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select></Field>}</div></> : <><Field label="Título"><input required autoFocus placeholder={selectedType === 'Mentoria' ? 'Ex.: Mentoria profissional' : 'Ex.: Compromisso pessoal'} value={personalForm.title} onChange={event => setPersonalForm({ ...personalForm, title: event.target.value })} className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Duração"><select value={personalForm.durationMinutes} onChange={event => setPersonalForm({ ...personalForm, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></Field><Field label="Categoria"><div className="flex h-[46px] items-center rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-sm font-black text-violet-900">{selectedType}</div></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Recorrência"><select value={personalForm.recurrence} onChange={event => setPersonalForm({ ...personalForm, recurrence: event.target.value as PsychologyPersonalInput['recurrence'] })} className={inputClass}><option>Não repetir</option><option>Toda semana</option><option>Todo mês</option></select></Field><label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold"><input type="checkbox" checked={Boolean(personalForm.alarmEnabled)} onChange={event => setPersonalForm({ ...personalForm, alarmEnabled: event.target.checked })} /> Ativar alarme local</label></div>{personalForm.alarmEnabled && <Field label="Antecedência"><select value={personalForm.alarmAdvance} onChange={event => setPersonalForm({ ...personalForm, alarmAdvance: event.target.value as PsychologyPersonalInput['alarmAdvance'] })} className={inputClass}>{ALARM_ADVANCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>}<Field label="Observação (opcional)"><textarea value={personalForm.note} onChange={event => setPersonalForm({ ...personalForm, note: event.target.value })} className={`${inputClass} min-h-24`} /></Field></>}{isSession && outsideAvailability && <div role="alert" data-testid="psychology-outside-availability-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSaveSession(sessionForm); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}</div><footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="submit" className={primaryButton}>{isSession ? 'Agendar sessão' : 'Salvar compromisso'}</button></footer></form></section></div>;
}

function HistoricalEventCreationDialog({ defaults, store, settings, onClose, onNewPatient, onSaveSession, onSavePersonal }: { defaults: NewEventDefaults; store: PsychologyStore; settings: PsychologySettings; onClose: () => void; onNewPatient: () => void; onSaveSession: (input: PsychologySessionInput) => void; onSavePersonal: (input: PsychologyPersonalInput) => void }) {
  const firstService = settings.services.find(service => service.active) || settings.services[0];
  const primaryLocation = primaryPsychologyLocation(settings);
  const [kind, setKind] = useState<NewEventKind>(defaults.kind);
  const [sessionForm, setSessionForm] = useState<PsychologySessionInput>({ patientId: store.patients.find(patient => patient.active)?.id || '', date: defaults.date, time: defaults.time, durationMinutes: firstService?.defaultDurationMinutes || settings.agenda.defaultDurationMinutes, modality: 'presencial', serviceId: firstService?.id, locationId: primaryLocation?.id, locationType: primaryLocation?.type, administrativeNote: '' });
  const [personalForm, setPersonalForm] = useState<PsychologyPersonalInput>({ date: defaults.date, time: defaults.time, durationMinutes: 60, type: defaults.kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal', title: '', note: '', recurrence: 'Não repetir', alarmEnabled: false, alarmAdvance: 'Na hora', alarmVolume: 80, alarmFadeIn: false });
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const movable = useMovableDialog();
  const tabs: Array<{ id: NewEventKind; label: string }> = [{ id: 'session', label: 'Sessão' }, { id: 'personal', label: 'Pessoal' }, { id: 'mentoring', label: 'Mentoria' }];
  const isSession = kind === 'session';
  const selectedType: PsychologyPersonalType = kind === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal';
  const servicesForModality = settings.services.filter(service => service.active && (sessionForm.modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE'));
  const selectedService = settings.services.find(service => service.id === sessionForm.serviceId);
  const updateKind = (next: NewEventKind) => { setKind(next); setError(''); if (next !== 'session') setPersonalForm(form => ({ ...form, type: next === 'mentoring' ? 'Mentoria' : 'Compromisso pessoal' })); };
  const updateModality = (modality: PsychologyModality) => {
    const nextService = settings.services.find(service => service.id === sessionForm.serviceId && service.active && (modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE')) || settings.services.find(service => service.active && (modality === 'online' ? service.modality !== 'PRESENTIAL' : service.modality !== 'ONLINE'));
    const nextLocation = modality === 'online' ? undefined : primaryPsychologyLocation(settings);
    setSessionForm({ ...sessionForm, modality, serviceId: nextService?.id, durationMinutes: nextService?.defaultDurationMinutes || sessionForm.durationMinutes, locationId: nextLocation?.id, locationType: nextLocation?.type });
  };
  const updateService = (serviceId: string) => {
    const service = settings.services.find(item => item.id === serviceId);
    setSessionForm({ ...sessionForm, serviceId, durationMinutes: service?.defaultDurationMinutes || sessionForm.durationMinutes });
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSession) {
      const nextError = validatePsychologySession(sessionForm, store, { requireService: true, checkConflicts: true });
      setError(nextError || '');
      if (nextError) return;
      if (!isPsychologyDateTimeWithinAvailability(settings.agenda, sessionForm.date, sessionForm.time)) { setOutsideAvailability(true); return; }
      onSaveSession(sessionForm);
      return;
    }
    if (!personalForm.date || !personalForm.time) { setError('Informe data e horário.'); return; }
    if (!personalForm.title.trim()) { setError('Informe um título para o compromisso.'); return; }
    onSavePersonal({ ...personalForm, type: selectedType });
  };
  return <div className="fixed inset-0 z-[200] bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Novo agendamento"><section ref={movable.dialogRef} style={movable.positionStyle} className="absolute flex max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><header {...movable.dragHandleProps} data-testid="psychology-event-dialog-drag-handle" className={`sticky top-0 z-10 border-b border-slate-200 bg-white px-5 pb-0 pt-4 select-none ${movable.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Arraste para mover</p><h2 className="mt-1 text-xl font-black text-slate-900">Organize sua agenda</h2></div><button type="button" data-no-dialog-drag onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><div className="mt-5 flex gap-1 overflow-x-auto">{tabs.map(tab => <button key={tab.id} type="button" onClick={() => updateKind(tab.id)} className={`border-b-2 px-4 py-3 text-sm font-black transition ${kind === tab.id ? 'border-violet-700 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab.label}</button>)}</div></header><form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"><div className="grid gap-3 sm:grid-cols-2"><Field label="Data"><input required type="date" value={isSession ? sessionForm.date : personalForm.date} onChange={event => isSession ? setSessionForm({ ...sessionForm, date: event.target.value }) : setPersonalForm({ ...personalForm, date: event.target.value })} className={inputClass} /></Field><Field label="Horário"><input required type="time" value={isSession ? sessionForm.time : personalForm.time} onChange={event => isSession ? setSessionForm({ ...sessionForm, time: event.target.value }) : setPersonalForm({ ...personalForm, time: event.target.value })} className={inputClass} /></Field></div>{isSession ? <><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><Field label="Paciente"><select required autoFocus value={sessionForm.patientId} onChange={event => setSessionForm({ ...sessionForm, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><button type="button" onClick={onNewPatient} className="mt-6 shrink-0 text-sm font-black text-violet-700 hover:underline">+ Novo paciente</button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Serviço"><select required value={sessionForm.serviceId || ''} onChange={event => updateService(event.target.value)} className={inputClass}><option value="">Selecione um serviço</option>{servicesForModality.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Duração"><select required value={sessionForm.durationMinutes} onChange={event => setSessionForm({ ...sessionForm, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="50">50 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Modalidade"><select required value={sessionForm.modality} onChange={event => updateModality(event.target.value as PsychologyModality)} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field>{sessionForm.modality === 'presencial' && <Field label="Local"><select required value={sessionForm.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setSessionForm({ ...sessionForm, locationId: location?.id, locationType: location?.type }); }} className={inputClass}><option value="">Selecione um local</option>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select></Field>}</div><Field label="Observação (opcional)"><textarea value={sessionForm.administrativeNote} onChange={event => setSessionForm({ ...sessionForm, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /></Field></> : <><Field label="Título"><input required autoFocus placeholder={selectedType === 'Mentoria' ? 'Ex.: Mentoria profissional' : 'Ex.: Compromisso pessoal'} value={personalForm.title} onChange={event => setPersonalForm({ ...personalForm, title: event.target.value })} className={inputClass} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Duração"><select value={personalForm.durationMinutes} onChange={event => setPersonalForm({ ...personalForm, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></Field><Field label="Categoria"><div className="flex h-[46px] items-center rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-sm font-black text-violet-900">{selectedType}</div></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Recorrência"><select value={personalForm.recurrence} onChange={event => setPersonalForm({ ...personalForm, recurrence: event.target.value as PsychologyPersonalInput['recurrence'] })} className={inputClass}><option>Não repetir</option><option>Toda semana</option><option>Todo mês</option></select></Field><label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold"><input type="checkbox" checked={Boolean(personalForm.alarmEnabled)} onChange={event => setPersonalForm({ ...personalForm, alarmEnabled: event.target.checked })} /> Ativar alarme local</label></div>{personalForm.alarmEnabled && <Field label="Antecedência"><select value={personalForm.alarmAdvance} onChange={event => setPersonalForm({ ...personalForm, alarmAdvance: event.target.value as PsychologyPersonalInput['alarmAdvance'] })} className={inputClass}>{ALARM_ADVANCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>}<Field label="Observação (opcional)"><textarea value={personalForm.note} onChange={event => setPersonalForm({ ...personalForm, note: event.target.value })} className={`${inputClass} min-h-24`} /></Field></>}{isSession && outsideAvailability && <div role="alert" data-testid="psychology-outside-availability-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSaveSession(sessionForm); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}</div><footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className={secondaryButton}>Fechar</button><button type="submit" className={primaryButton}>{isSession ? 'Agendar sessão' : 'Salvar compromisso'}</button></footer></form></section></div>;
}

function LegacySessionDialog({ value, store, settings, defaultPatientId, defaultDate, defaultTime, onClose, onSave }: { value: PsychologySession | null; store: PsychologyStore; settings: PsychologySettings; defaultPatientId?: string; defaultDate: string; defaultTime?: string; onClose: () => void; onSave: (input: PsychologySessionInput) => void }) {
  const [form, setForm] = useState<PsychologySessionInput>({ patientId: value?.patientId || defaultPatientId || store.patients.find(patient => patient.active)?.id || '', date: value?.date || defaultDate, time: value?.time || defaultTime || '09:00', durationMinutes: value?.durationMinutes || settings.agenda.defaultDurationMinutes, modality: value?.modality || 'presencial', serviceId: value?.serviceId || settings.services.find(service => service.active)?.id, locationId: value?.locationId || primaryPsychologyLocation(settings)?.id, locationType: value?.locationType || primaryPsychologyLocation(settings)?.type, chargeId: value?.chargeId, administrativeNote: value?.administrativeNote || '' });
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const save = (event: React.FormEvent) => { event.preventDefault(); const nextError = validatePsychologySession(form, store, { ignoreSessionId: value?.id, requireService: true, checkConflicts: true }); setError(nextError || ''); if (nextError) return; if (!isPsychologyDateTimeWithinAvailability(settings.agenda, form.date, form.time)) { setOutsideAvailability(true); return; } onSave(form); };
  return <Dialog title={value ? 'Reagendar sessão' : 'Agendar sessão'} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Paciente" error={error && !form.patientId ? error : undefined}><select value={form.patientId} onChange={event => setForm({ ...form, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Data" error={error && !form.date ? error : undefined}><input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className={inputClass} /></Field><Field label="Horário" error={error && !form.time ? error : undefined}><input type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} className={inputClass} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Duração"><select value={form.durationMinutes} onChange={event => setForm({ ...form, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="50">50 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></Field><Field label="Tipo de atendimento"><select value={form.modality} onChange={event => { const modality = event.target.value as PsychologyModality; setForm({ ...form, modality, locationId: modality === 'online' ? undefined : form.locationId || settings.locations.find(location => location.type === 'PRIMARY_OFFICE')?.id, locationType: modality === 'online' ? undefined : form.locationType || 'PRIMARY_OFFICE' }); }} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field></div>{form.modality === 'presencial' && <Field label="Local"><select value={form.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setForm({ ...form, locationId: location?.id, locationType: location?.type }); }} className={inputClass}>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.type === 'PRIMARY_OFFICE' ? `Presencial — ${location.displayName}` : location.displayName}</option>)}</select></Field>}<Field label="Observação administrativa (opcional)"><textarea value={form.administrativeNote} onChange={event => setForm({ ...form, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /></Field>{outsideAvailability && <div role="alert" data-testid="psychology-outside-availability-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSave(form); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p className="text-sm font-bold text-red-600">{error}</p>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" className={primaryButton}>Salvar sessão</button></div></form></Dialog>;
}

function SessionDialog({ value, store, settings, defaultPatientId, defaultDate, defaultTime, onClose, onSave }: { value: PsychologySession | null; store: PsychologyStore; settings: PsychologySettings; defaultPatientId?: string; defaultDate: string; defaultTime?: string; onClose: () => void; onSave: (input: PsychologySessionInput) => boolean }) {
  const defaultService = settings.services.find(service => service.active && service.id === value?.serviceId) || settings.services.find(service => service.active) || settings.services[0];
  const defaultLocation = primaryPsychologyLocation(settings);
  const valueService = value?.serviceId ? settings.services.find(service => service.id === value.serviceId) : undefined;
  const [form, setForm] = useState<PsychologySessionInput>({ patientId: value?.patientId || defaultPatientId || store.patients.find(patient => patient.active)?.id || '', date: value?.date || defaultDate, time: value?.time || defaultTime || '09:00', durationMinutes: valueService?.defaultDurationMinutes ?? value?.durationMinutes ?? defaultService?.defaultDurationMinutes ?? settings.agenda.defaultDurationMinutes, modality: value?.modality || 'presencial', serviceId: value?.serviceId || defaultService?.id, locationId: value?.locationId || defaultLocation?.id, locationType: value?.locationType || defaultLocation?.type, chargeId: value?.chargeId, administrativeNote: value?.administrativeNote || '' });
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const submitLock = useRef(false);
  const selectedService = settings.services.find(service => service.id === form.serviceId);
  useEffect(() => {
    const serviceId = synchronizePsychologyServiceForPatient(store, form.patientId, form.serviceId);
    if (serviceId === form.serviceId) return;
    const service = settings.services.find(item => item.id === serviceId);
    setForm(current => ({ ...current, serviceId, durationMinutes: service?.defaultDurationMinutes || current.durationMinutes }));
  }, [form.patientId, form.serviceId, settings.services, store]);
  const commit = () => { if (submitLock.current) return; submitLock.current = true; if (!onSave(form)) submitLock.current = false; };
  const save = (event: React.FormEvent) => { event.preventDefault(); const nextError = validatePsychologySession(form, store, { ignoreSessionId: value?.id, requireService: true, checkConflicts: true }); setError(nextError || ''); if (nextError) return; if (!isPsychologyDateTimeWithinAvailability(settings.agenda, form.date, form.time)) { setOutsideAvailability(true); return; } commit(); };
  const updateService = (serviceId: string) => { const service = settings.services.find(item => item.id === serviceId); setForm({ ...form, serviceId: service?.id, durationMinutes: service?.defaultDurationMinutes || form.durationMinutes }); };
  const updateModality = (modality: PsychologyModality) => { const nextLocation = modality === 'online' ? undefined : primaryPsychologyLocation(settings); setForm({ ...form, modality, locationId: nextLocation?.id, locationType: nextLocation?.type }); };
  return <Dialog title={value ? 'Editar sessão' : 'Agendar sessão'} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Paciente"><select required value={form.patientId} onChange={event => setForm({ ...form, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Data"><input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className={inputClass} /></Field><Field label="Horário"><input required type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} className={inputClass} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Serviço"><select required value={form.serviceId || ''} onChange={event => updateService(event.target.value)} className={inputClass}><option value="">Selecione um serviço</option>{settings.services.filter(service => service.active).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Duração do serviço"><div data-testid="psychology-service-duration" className="flex h-[46px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-black text-slate-700">{selectedService?.defaultDurationMinutes ?? form.durationMinutes} minutos</div></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Tipo de atendimento"><select required value={form.modality} onChange={event => updateModality(event.target.value as PsychologyModality)} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field>{form.modality === 'presencial' && <Field label="Local"><select required value={form.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setForm({ ...form, locationId: location?.id, locationType: location?.type }); }} className={inputClass}><option value="">Selecione um local</option>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select></Field>}</div>{value && <Field label="Observação administrativa"><textarea value={form.administrativeNote} onChange={event => setForm({ ...form, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /> </Field>}{outsideAvailability && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSave(form); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" className={primaryButton}>Salvar sessão</button></div></form></Dialog>;
}

function HistoricalSessionDialog({ value, store, settings, defaultPatientId, defaultDate, defaultTime, onClose, onSave }: { value: PsychologySession | null; store: PsychologyStore; settings: PsychologySettings; defaultPatientId?: string; defaultDate: string; defaultTime?: string; onClose: () => void; onSave: (input: PsychologySessionInput) => void }) {
  const defaultService = settings.services.find(service => service.active && service.id === value?.serviceId) || settings.services.find(service => service.active) || settings.services[0];
  const defaultLocation = primaryPsychologyLocation(settings);
  const [form, setForm] = useState<PsychologySessionInput>({ patientId: value?.patientId || defaultPatientId || store.patients.find(patient => patient.active)?.id || '', date: value?.date || defaultDate, time: value?.time || defaultTime || '09:00', durationMinutes: (value?.serviceId ? settings.services.find(service => service.id === value.serviceId)?.defaultDurationMinutes : undefined) || value?.durationMinutes || defaultService?.defaultDurationMinutes || settings.agenda.defaultDurationMinutes, modality: value?.modality || 'presencial', serviceId: value?.serviceId || defaultService?.id, locationId: value?.locationId || defaultLocation?.id, locationType: value?.locationType || defaultLocation?.type, chargeId: value?.chargeId, administrativeNote: value?.administrativeNote || '' });
  const selectedService = settings.services.find(service => service.id === form.serviceId);
  const [error, setError] = useState('');
  const [outsideAvailability, setOutsideAvailability] = useState(false);
  const save = (event: React.FormEvent) => { event.preventDefault(); const nextError = validatePsychologySession(form, store, { ignoreSessionId: value?.id, requireService: true, checkConflicts: true }); setError(nextError || ''); if (nextError) return; if (!isPsychologyDateTimeWithinAvailability(settings.agenda, form.date, form.time)) { setOutsideAvailability(true); return; } onSave(form); };
  const updateService = (serviceId: string) => { const service = settings.services.find(item => item.id === serviceId); setForm({ ...form, serviceId: service?.id, durationMinutes: service?.defaultDurationMinutes || form.durationMinutes }); };
  const updateModality = (modality: PsychologyModality) => { const nextLocation = modality === 'online' ? undefined : primaryPsychologyLocation(settings); setForm({ ...form, modality, locationId: nextLocation?.id, locationType: nextLocation?.type }); };
  return <Dialog title={value ? 'Editar sessão' : 'Agendar sessão'} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Paciente"><select required value={form.patientId} onChange={event => setForm({ ...form, patientId: event.target.value })} className={inputClass}><option value="">Selecione um paciente</option>{store.patients.filter(patient => patient.active).sort((a, b) => a.name.localeCompare(b.name)).map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Data"><input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className={inputClass} /></Field><Field label="Horário"><input required type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} className={inputClass} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Serviço"><select required value={form.serviceId || ''} onChange={event => updateService(event.target.value)} className={inputClass}><option value="">Selecione um serviço</option>{settings.services.filter(service => service.active).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Duração"><select required value={form.durationMinutes} onChange={event => setForm({ ...form, durationMinutes: Number(event.target.value) })} className={inputClass}><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="50">50 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Tipo de atendimento"><select required value={form.modality} onChange={event => updateModality(event.target.value as PsychologyModality)} className={inputClass}><option value="presencial">Presencial</option><option value="online">Online</option></select></Field>{form.modality === 'presencial' && <Field label="Local"><select required value={form.locationId || ''} onChange={event => { const location = settings.locations.find(item => item.id === event.target.value); setForm({ ...form, locationId: location?.id, locationType: location?.type }); }} className={inputClass}><option value="">Selecione um local</option>{settings.locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.displayName}</option>)}</select></Field>}</div><Field label="Observação administrativa (opcional)"><textarea value={form.administrativeNote} onChange={event => setForm({ ...form, administrativeNote: event.target.value })} className={`${inputClass} min-h-24`} /></Field>{outsideAvailability && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900"><p>Este horário está fora da sua disponibilidade habitual.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOutsideAvailability(false)} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => { setOutsideAvailability(false); onSave(form); }} className={primaryButton}>Agendar mesmo assim</button></div></div>}{error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}<div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" className={primaryButton}>Salvar sessão</button></div></form></Dialog>;
}

function RecordDialog({ session, patient, existingText, onClose, onSave }: { session: PsychologySession; patient?: PsychologyPatient; existingText: string; onClose: () => void; onSave: (text: string) => boolean }) {
  const [text, setText] = useState(existingText);
  const submitLock = useRef(false);
  const save = (event: React.FormEvent) => { event.preventDefault(); if (!text.trim() || submitLock.current) return; submitLock.current = true; if (!onSave(text)) submitLock.current = false; };
  return <Dialog title="Registrar sessão" onClose={onClose}><div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><p><strong>Paciente:</strong> {patient?.name || '—'}</p><p><strong>Data:</strong> {formatShortDate(session.date)} às {session.time}</p><p className="mt-2 text-xs text-slate-500">Este conteúdo fica somente no registro protegido do piloto local e não aparece em listas, agenda ou Meu Dia.</p></div><form onSubmit={save} className="space-y-4"><Field label="Registro da sessão"><textarea autoFocus value={text} onChange={event => setText(event.target.value)} placeholder="Escreva o registro da sessão..." className={`${inputClass} min-h-48`} /></Field><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={secondaryButton}>Voltar</button><button type="submit" disabled={!text.trim()} className={primaryButton}>Salvar</button></div></form></Dialog>;
}

export { PatientDialogR2F3E, PatientsView };
