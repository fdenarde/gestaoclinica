import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  CheckSquare,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Expand,
  Eye,
  FileText,
  Film,
  Filter,
  Heart,
  Image as ImageIcon,
  Instagram,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { logout } from '../../firebase';
import {
  requestResponsiblePatientUpdate,
  uploadResponsibleDocument,
  getResponsibleDocumentUrl,
  getResponsibleMediaUrl,
  getResponsiblePatientPhotoUrl,
  getResponsiblePortalData,
  getAdminResponsiblePortalData,
  recordResponsiblePortalAction,
} from '../../lib/accessApi';
import type { AdminResponsiblePortalData } from '../../lib/accessApi';
import { activityRecordCategoryMatches, getActivityRecordCategoryLabel } from '../../types/activityRecords';
import { applyTheme } from '../../lib/theme';
import type {
  ResponsiblePortalData,
  ResponsiblePortalMedia,
  ResponsiblePortalPackage,
  ResponsiblePortalPatientData,
  ResponsiblePortalPatientUpdateInput,
  ResponsiblePortalClientContext,
  ResponsiblePortalPlaybackSummary,
  ResponsiblePortalSession,
} from '../../types/access';
import BrandLogo from '../Common/BrandLogo';
import PatientRegistrationFields, { PatientRegistrationSummary } from '../Common/PatientRegistrationFields';
import ResponsibleGooglePhotosGallery from '../GooglePhotosAlbums/ResponsibleGooglePhotosGallery';

interface ResponsiblePortalProps {
  user: User;
  adminPreview?: {
    patientId: string;
    patientName: string;
    onBack: () => void;
  };
}

type MediaFilter = 'all' | 'photo' | 'video';
type ViewMode = 'grid' | 'list';
type PortalTab = 'dashboard' | 'sessions' | 'gallery' | 'profile';
type BusyAction = { id: string; type: 'open' | 'download' | 'share' | 'like' | 'comment' } | null;
type SessionGroupState = Record<string, boolean>;
type MediaViewSession = {
  interactionSessionId: string;
  recordId: string;
  patientId: string;
  mediaType: 'photo' | 'video';
  startedAt: string;
  startedAtMs: number;
  lastObservedPositionSeconds: number | null;
  seeking: boolean;
  totalPlayedSeconds: number;
  maxPositionSeconds: number;
  durationSeconds: number;
  playCount: number;
  pauseCount: number;
  seekCount: number;
  completed: boolean;
  finalized: boolean;
};

const PAGE_SIZE = 12;


const GRADE_OPTIONS = [
  '1º Ano - Ensino Fundamental',
  '2º Ano - Ensino Fundamental',
  '3º Ano - Ensino Fundamental',
  '4º Ano - Ensino Fundamental',
  '5º Ano - Ensino Fundamental',
  '6º Ano - Ensino Fundamental',
  '7º Ano - Ensino Fundamental',
  '8º Ano - Ensino Fundamental',
  '9º Ano - Ensino Fundamental',
  '1º Ano - Ensino Médio',
  '2º Ano - Ensino Médio',
  '3º Ano - Ensino Médio',
] as const;

const SHIFT_OPTIONS = ['Manhã', 'Tarde', 'Integral'] as const;

function isDesktopEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function buildPortalClientContext(portalTab: PortalTab, actionLocation: string): ResponsiblePortalClientContext {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { portalTab, actionLocation };
  }
  const userAgent = navigator.userAgent || '';
  let deviceType = 'Computador';
  if (/iPad|Tablet/i.test(userAgent)) deviceType = 'Tablet';
  else if (/Android|iPhone|iPod|Mobile/i.test(userAgent)) deviceType = 'Celular';

  let browser = 'Navegador não identificado';
  if (/Edg\//i.test(userAgent)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(userAgent)) browser = 'Opera';
  else if (/Chrome\//i.test(userAgent)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(userAgent)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return {
    portalTab,
    actionLocation,
    deviceType,
    browser,
    platform: userAgentData?.platform || navigator.platform || 'Sistema não identificado',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language || '',
  };
}

function extensionFromFileName(fileName: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName || '');
  return match ? `.${match[1]}` : '';
}

function formatDate(value: string, withWeekday = true): string {
  if (!value) return 'Aguardando definição';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Tamanho não informado';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const NO_REPLACEMENT_SESSION_STATUS = 'late_cancellation_no_replacement';
const NO_REPLACEMENT_PORTAL_LABEL = 'Sessão contabilizada — sem reposição';
const NO_REPLACEMENT_REASON_TEXT = 'Aviso tardio ou cancelamento fora do prazo';

function statusClass(status: string): string {
  if (status === 'Realizada') return 'bg-status-green-bg text-status-green-text';
  if (status === 'Reposição') return 'bg-status-orange-bg text-status-orange-text';
  if (status === 'Falta') return 'bg-status-red-bg text-status-red-text';
  if (status === 'Falta.Prof') return 'bg-orange-100 text-orange-700';
  if (status === NO_REPLACEMENT_SESSION_STATUS) return 'bg-[#FFF4F4] text-[#A94444]';
  return 'bg-status-blue-bg text-status-blue-text';
}

function statusLabel(status: string): string {
  if (status === NO_REPLACEMENT_SESSION_STATUS) return NO_REPLACEMENT_PORTAL_LABEL;
  if (status === 'Falta.Prof') return 'Falta do profissional';
  return status || 'Agendada';
}

function noReplacementReasonLabel(session: ResponsiblePortalSession): string {
  return session.noReplacementReasonText || NO_REPLACEMENT_REASON_TEXT;
}

function packageLabel(pkg: ResponsiblePortalPackage): string {
  const prefix = pkg.status === 'current' ? 'Pacote atual' : `Pacote ${pkg.number}`;
  if (!pkg.startDate) return `${prefix} — aguardando primeira sessão`;
  const end = pkg.endDate ? formatDate(pkg.endDate, false) : 'em andamento';
  return `${prefix} — ${formatDate(pkg.startDate, false)} a ${end}`;
}

function mediaGroupKey(record: ResponsiblePortalMedia): string {
  return `${record.sessionDate}|${record.sessionTime}|${record.sessionId}`;
}

function sessionGroupTitle(records: ResponsiblePortalMedia[]): string {
  const first = records[0];
  return `${formatDate(first.sessionDate, false)} às ${first.sessionTime || 'horário não informado'}`;
}

function sessionGroupSubtitle(records: ResponsiblePortalMedia[]): string {
  const photos = records.filter(record => record.mediaType === 'photo').length;
  const videos = records.filter(record => record.mediaType === 'video').length;
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? 'foto' : 'fotos'}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`);
  return parts.join(' • ');
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function updateMediaInData(
  current: ResponsiblePortalData | null,
  patientId: string,
  recordId: string,
  updater: (record: ResponsiblePortalMedia) => ResponsiblePortalMedia,
): ResponsiblePortalData | null {
  if (!current) return current;
  return {
    ...current,
    patients: current.patients.map(patientData => (
      patientData.patient.id !== patientId
        ? patientData
        : {
          ...patientData,
          media: patientData.media.map(record => record.id === recordId ? updater(record) : record),
        }
    )),
  };
}


function PackageSessionsTable({ pkg }: { pkg: ResponsiblePortalPackage }) {
  const sessionsByNumber = useMemo(() => {
    const map = new Map<number, ResponsiblePortalSession[]>();
    for (const session of pkg.sessions) {
      const items = map.get(session.sessionNumber) || [];
      items.push(session);
      map.set(session.sessionNumber, items);
    }
    return map;
  }, [pkg.sessions]);

  return (
    <section className="overflow-hidden rounded-2xl border border-clinic-border bg-clinic-surface shadow-clinic">
      <header className="border-b border-clinic-border bg-clinic-bg px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-clinic-primary shadow-sm">
              <CalendarDays size={20} />
            </div>
            <div>
              <h2 className="font-bold text-clinic-text">Andamento das 10 sessões</h2>
              <p className="text-xs text-clinic-text-muted">Visualização organizada do pacote selecionado, com foco nas sessões já consumidas e no que ainda falta concluir.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <span className="rounded-2xl bg-status-green-bg px-3 py-2 text-center text-xs font-black text-status-green-text">
              {pkg.consumedCount}/10 concluídas
            </span>
            <span className="rounded-2xl bg-white px-3 py-2 text-center text-xs font-black text-clinic-primary shadow-sm">
              {pkg.remainingCount} restantes
            </span>
          </div>
        </div>
      </header>

      <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
        {Array.from({ length: 10 }, (_, index) => index + 1).map(number => {
          const events = sessionsByNumber.get(number) || [];
          const hasEvents = events.length > 0;
          return (
            <article
              key={number}
              className={`rounded-2xl border p-4 transition-colors ${hasEvents ? 'border-clinic-border bg-white shadow-sm' : 'border-dashed border-clinic-border bg-clinic-bg/50'}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${hasEvents ? 'bg-clinic-primary text-white' : 'bg-white text-clinic-primary border border-clinic-border'}`}>
                    {number}/10
                  </div>
                  <div>
                    <p className="text-sm font-black text-clinic-text">Sessão {number}</p>
                    <p className="text-xs text-clinic-text-muted">
                      {hasEvents ? (events.length > 1 ? 'Sessão com reposição vinculada.' : 'Sessão vinculada ao pacote atual.') : 'Aguardando agendamento desta sessão.'}
                    </p>
                  </div>
                </div>
                {hasEvents && events[0] ? (
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass(events[0].status)}`}>
                    {statusLabel(events[0].status)}
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-clinic-text-muted border border-clinic-border">
                    Pendente
                  </span>
                )}
              </div>

              {hasEvents ? (
                <div className="mt-4 space-y-3">
                  {events.map((session, eventIndex) => (
                    <div key={session.id} className="rounded-xl border border-clinic-border bg-clinic-bg/45 p-3">
                      {eventIndex > 0 && (
                        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-status-orange-text">Reposição vinculada</p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Data e horário</p>
                          <p className="mt-1 font-bold capitalize text-clinic-text">{formatDate(session.date)}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-clinic-text-muted"><Clock3 size={13} /> {session.time || 'Horário não informado'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Tipo</p>
                          <p className="mt-1 text-sm font-semibold text-clinic-text">{session.type || 'Intervenção'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Profissional</p>
                          <p className="mt-1 text-sm font-semibold text-clinic-text">{session.professionalName || 'Fábio Denarde'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Consome o pacote</p>
                          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${session.consumesPackage ? 'bg-status-green-bg text-status-green-text' : 'bg-white text-clinic-text-muted border border-clinic-border'}`}>
                            {session.consumesPackage ? <Check size={13} /> : <X size={13} />}
                            {session.consumesPackage ? 'Sim' : 'Não'}
                          </span>
                        </div>
                      </div>
                      {session.status === NO_REPLACEMENT_SESSION_STATUS && (
                        <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'rgba(169, 68, 68, 0.24)', backgroundColor: '#FFF4F4' }}>
                          <p className="font-black text-clinic-text">{NO_REPLACEMENT_PORTAL_LABEL}</p>
                          <p className="mt-1 text-[12px] font-bold" style={{ color: '#A94444' }}>
                            {noReplacementReasonLabel(session)}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-clinic-border bg-white px-4 py-5 text-sm text-clinic-text-muted">
                  Esta posição do pacote ainda não possui data agendada.
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}


interface MediaCardProps {
  key?: React.Key;
  record: ResponsiblePortalMedia;
  url: string;
  previewLoading: boolean;
  openLoading: boolean;
  downloadLoading: boolean;
  likeLoading: boolean;
  selected: boolean;
  selectMode: boolean;
  readOnly: boolean;
  viewMode: ViewMode;
  onEnsureUrl: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onToggleSelect: () => void;
  onLike: () => void;
}

function MediaCard({
  record,
  url,
  previewLoading,
  openLoading,
  downloadLoading,
  likeLoading,
  selected,
  selectMode,
  readOnly,
  viewMode,
  onEnsureUrl,
  onOpen,
  onDownload,
  onToggleSelect,
  onLike,
}: MediaCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const target = rootRef.current;
    if (!target || isVisible) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '180px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || url || previewLoading) return;
    onEnsureUrl();
  }, [isVisible, onEnsureUrl, previewLoading, url]);

  useEffect(() => {
    if (url) setPreviewFailed(false);
  }, [url]);

  const showPlaceholder = !url || previewFailed;

  return (
    <article ref={rootRef} className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all ${selected ? 'border-clinic-primary ring-2 ring-clinic-primary/25' : 'border-clinic-border'} ${viewMode === 'list' ? 'sm:flex' : ''}`}>
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpen}
        className={`relative block overflow-hidden bg-slate-900 text-left ${viewMode === 'list' ? 'aspect-video w-full sm:w-64 sm:shrink-0' : 'aspect-video w-full'}`}
      >
        {!showPlaceholder && record.mediaType === 'photo' && (
          <img
            src={url}
            alt={record.description || getActivityRecordCategoryLabel(record.category)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        )}
        {!showPlaceholder && record.mediaType === 'video' && (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setPreviewFailed(true)}
          />
        )}
        {showPlaceholder && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-center text-white">
            {previewLoading ? <Loader2 className="animate-spin text-white" /> : record.mediaType === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}
            <span className="px-4 text-[11px] font-bold text-white/90">
              {previewLoading ? 'Carregando prévia...' : previewFailed ? 'Prévia indisponível. Toque em VER para abrir a mídia.' : 'Prévia protegida. Toque em VER para abrir a mídia.'}
            </span>
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">
          {record.mediaType === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
          {record.mediaType === 'video' ? 'Vídeo' : 'Foto'}
        </span>
        {selectMode && (
          <span className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-lg ${selected ? 'bg-clinic-primary text-white' : 'bg-black/55 text-white'}`}>
            {selected ? <Check size={17} strokeWidth={3} /> : null}
          </span>
        )}
        <span className="absolute bottom-2 left-2 right-2">
          <span className="line-clamp-1 text-xs font-black text-white">{getActivityRecordCategoryLabel(record.category)}</span>
          <span className="mt-0.5 block text-[10px] font-bold text-white/85">
            {formatDate(record.sessionDate, false)} às {record.sessionTime}
          </span>
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-between space-y-3 p-3">
        <div>
          <p className="line-clamp-2 min-h-8 text-xs text-clinic-text-muted">{record.description || 'Sem observação.'}</p>
          <div className="mt-2 space-y-0.5 text-[10px] font-bold text-clinic-text-faint">
            <p>{statusLabel(record.sessionStatus)}</p>
            <p>Profissional: {record.professionalName || 'Fábio Denarde'}</p>
            <p>Compartilhamento permitido</p>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-clinic-border pt-2">
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onOpen(); }}
            disabled={selectMode || openLoading}
            className="flex items-center justify-center gap-1 rounded-lg bg-clinic-primary py-2 text-[10px] font-black uppercase text-white disabled:opacity-45"
          >
            {openLoading ? <Loader2 size={13} className="animate-spin" /> : record.mediaType === 'video' ? <Film size={13} /> : <ImageIcon size={13} />}
            Ver
          </button>
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onLike(); }}
            disabled={selectMode || likeLoading || readOnly}
            className={`flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-[10px] font-black disabled:cursor-not-allowed disabled:opacity-60 ${record.likedByCurrentResponsible ? 'bg-red-50 text-red-600' : 'bg-clinic-bg text-clinic-text-muted'}`}
            aria-label={readOnly ? 'Curtidas desativadas na visualização administrativa' : record.likedByCurrentResponsible ? 'Remover curtida' : 'Curtir'}
            title={readOnly ? 'Somente visualização: nenhuma curtida será registrada.' : undefined}
          >
            {likeLoading ? <Loader2 size={14} className="animate-spin" /> : <Heart size={14} fill={record.likedByCurrentResponsible ? 'currentColor' : 'none'} />}
            {record.likeCount}
          </button>
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onDownload(); }}
            disabled={selectMode || downloadLoading}
            className="rounded-lg bg-clinic-bg px-3 py-2 text-clinic-primary disabled:opacity-45"
            aria-label={`Baixar ${record.fileName}`}
          >
            <Download size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ResponsiblePortal({ user, adminPreview }: ResponsiblePortalProps) {
  const isAdminPreview = Boolean(adminPreview);
  const [previewResponsibleUid, setPreviewResponsibleUid] = useState('');
  const [data, setData] = useState<ResponsiblePortalData | AdminResponsiblePortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedPackageNumber, setSelectedPackageNumber] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [comment, setComment] = useState('');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [shareFilter, setShareFilter] = useState('all');
  const [professionalFilter, setProfessionalFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activePortalTab, setActivePortalTab] = useState<PortalTab>('dashboard');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaUrlLoadingIds, setMediaUrlLoadingIds] = useState<Set<string>>(new Set());
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<SessionGroupState>({});
  const [patientPhotoUrl, setPatientPhotoUrl] = useState('');
  const [patientPhotoLoading, setPatientPhotoLoading] = useState(false);
  const [patientPhotoExpanded, setPatientPhotoExpanded] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileDeclarationAccepted, setProfileDeclarationAccepted] = useState(false);
  const [profileDeclarationError, setProfileDeclarationError] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentCategory, setDocumentCategory] = useState('Receita médica');
  const [documentNote, setDocumentNote] = useState('');
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentMessage, setDocumentMessage] = useState('');
  const [profileForm, setProfileForm] = useState<ResponsiblePortalPatientUpdateInput>({
    name: '',
    fullName: '',
    birthDate: '',
    sex: 'Não informado',
    guardianName: '',
    whatsapp: '',
    motherName: '',
    motherProfession: '',
    motherPhone: '',
    fatherName: '',
    fatherProfession: '',
    fatherPhone: '',
    otherResponsibleName: '',
    otherResponsibleKinship: '',
    otherResponsiblePhone: '',
    school: '',
    grade: 'Não informado',
    educationDetail: '',
    shift: '',
    familyStatus: undefined,
    custodyStatus: undefined,
    custodyResponsibleName: '',
    custodyResponsibleKinship: '',
    careProfessionals: [],
    doctorName: '',
    medication: '',
    emergencyContact: '',
    allergies: '',
    financialResponsible: undefined,
    financialResponsibleOtherName: '',
    financialResponsibleOtherKinship: '',
    financialResponsibleOtherPhone: '',
    financialResponsibleOtherCpf: '',
  });
  const mediaElementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const previewResponsibleUidRef = useRef('');
  const mediaUrlCacheRef = useRef<Record<string, string>>({});
  const mediaViewSessionRef = useRef<MediaViewSession | null>(null);

  useLayoutEffect(() => {
    applyTheme('calm-tech');
  }, []);

  const loadPortal = useCallback(async (responsibleUidOverride?: string) => {
    setLoading(true);
    setError('');
    try {
      let result: ResponsiblePortalData | AdminResponsiblePortalData;

      if (adminPreview) {
        const requestedResponsibleUid = responsibleUidOverride ?? previewResponsibleUidRef.current;
        const adminResult = await getAdminResponsiblePortalData(
          adminPreview.patientId,
          requestedResponsibleUid,
          user,
        );

        result = adminResult;

        const selectedResponsibleUid = adminResult.adminPreview.selectedResponsibleUid;
        previewResponsibleUidRef.current = selectedResponsibleUid;
        setPreviewResponsibleUid(current => (
          current === selectedResponsibleUid
            ? current
            : selectedResponsibleUid
        ));
      } else {
        result = await getResponsiblePortalData(user);
      }

      setData(result);
      applyTheme(result.settings.visualTheme);
      const initialPatient = result.patients[0];
      setSelectedPatientId(current => (
        current && result.patients.some(item => item.patient.id === current)
          ? current
          : initialPatient?.patient.id || ''
      ));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar o portal.');
    } finally {
      setLoading(false);
    }
  }, [adminPreview, user]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  const patientData = useMemo<ResponsiblePortalPatientData | null>(() => (
    data?.patients.find(item => item.patient.id === selectedPatientId) || data?.patients[0] || null
  ), [data?.patients, selectedPatientId]);

  const adminPreviewMeta = data && 'adminPreview' in data ? data.adminPreview : null;

  useEffect(() => {
    if (!patientData) {
      setSelectedPackageNumber(null);
      return;
    }
    const availablePackages = patientData.packages.filter(pkg => pkg.status !== 'future');
    const fallbackPackage = availablePackages.find(pkg => pkg.number === patientData.currentPackageNumber) || availablePackages[0] || patientData.packages[0] || null;
    setSelectedPackageNumber(current => (
      current && availablePackages.some(pkg => pkg.number === current)
        ? current
        : fallbackPackage?.number ?? null
    ));
    setSelectedIds(new Set());
    setSelectMode(false);
    setVisibleCount(PAGE_SIZE);
    setExpandedSessionGroups({});
  }, [patientData?.patient.id, patientData?.currentPackageNumber, patientData?.packages]);

  const visiblePackages = useMemo(() => {
    if (!patientData?.packages?.length) return [];
    const nonFuture = patientData.packages.filter(pkg => pkg.status !== 'future');
    return nonFuture.length > 0 ? nonFuture : patientData.packages.slice(0, 1);
  }, [patientData?.packages]);

  const selectedPackage = useMemo(() => (
    visiblePackages.find(pkg => pkg.number === selectedPackageNumber)
    || visiblePackages[0]
    || null
  ), [selectedPackageNumber, visiblePackages]);

  const selectedMedia = useMemo(() => (
    patientData?.media.find(record => record.id === selectedMediaId) || null
  ), [patientData?.media, selectedMediaId]);

  const packageMedia = useMemo(() => (
    patientData?.media.filter(record => record.packageNumber === selectedPackage?.number) || []
  ), [patientData?.media, selectedPackage?.number]);

  const categories = useMemo(() => [...new Set(packageMedia.map(record => getActivityRecordCategoryLabel(record.category)))].sort(), [packageMedia]);
  const professionals = useMemo(() => [...new Set(packageMedia.map(record => record.professionalName).filter(Boolean) as string[])].sort(), [packageMedia]);
  const sessionsForFilter = useMemo(() => {
    const seen = new Map<string, ResponsiblePortalMedia>();
    for (const record of packageMedia) if (!seen.has(record.sessionId)) seen.set(record.sessionId, record);
    return [...seen.values()].sort((a, b) => `${b.sessionDate}T${b.sessionTime}`.localeCompare(`${a.sessionDate}T${a.sessionTime}`));
  }, [packageMedia]);

  const filteredMedia = useMemo(() => {
    const today = new Date();
    const threshold = new Date(today);
    if (periodFilter === '30') threshold.setDate(today.getDate() - 30);
    if (periodFilter === '90') threshold.setDate(today.getDate() - 90);
    return packageMedia.filter(record => {
      if (mediaFilter !== 'all' && record.mediaType !== mediaFilter) return false;
      if (categoryFilter !== 'all' && !activityRecordCategoryMatches(record.category, categoryFilter)) return false;
      if (sessionFilter !== 'all' && record.sessionId !== sessionFilter) return false;
      if (visibilityFilter !== 'all' && record.visibility !== visibilityFilter) return false;
      if (shareFilter !== 'all') {
        const shared = record.shareStatus === 'shared_confirmed';
        if (shareFilter === 'shared' && !shared) return false;
        if (shareFilter === 'not_shared' && shared) return false;
      }
      if (professionalFilter !== 'all' && record.professionalName !== professionalFilter) return false;
      if (periodFilter === 'year' && !record.sessionDate.startsWith(String(today.getFullYear()))) return false;
      if (periodFilter === '30' || periodFilter === '90') {
        const date = new Date(`${record.sessionDate}T12:00:00`);
        if (date < threshold) return false;
      }
      return true;
    });
  }, [categoryFilter, mediaFilter, packageMedia, periodFilter, professionalFilter, sessionFilter, shareFilter, visibilityFilter]);

  const visibleMedia = useMemo(() => filteredMedia.slice(0, visibleCount), [filteredMedia, visibleCount]);

  const groupedMedia = useMemo(() => {
    const groups = new Map<string, ResponsiblePortalMedia[]>();
    for (const record of visibleMedia) {
      const key = mediaGroupKey(record);
      const current = groups.get(key) || [];
      current.push(record);
      groups.set(key, current);
    }
    return [...groups.values()];
  }, [visibleMedia]);


  useEffect(() => {
    setExpandedSessionGroups({});
  }, [selectedPackage?.number, sessionFilter, categoryFilter, mediaFilter, periodFilter, professionalFilter, shareFilter, visibilityFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [categoryFilter, mediaFilter, periodFilter, professionalFilter, selectedPackageNumber, sessionFilter, shareFilter, visibilityFilter]);

  useEffect(() => {
    let active = true;
    setPatientPhotoExpanded(false);
    setPatientPhotoUrl('');
    if (!patientData?.patient.hasPhoto) {
      setPatientPhotoLoading(false);
      return () => { active = false; };
    }
    setPatientPhotoLoading(true);
    void getResponsiblePatientPhotoUrl(patientData.patient.id, { adminPreview: isAdminPreview })
      .then(result => {
        if (active) setPatientPhotoUrl(result.url || '');
      })
      .catch(() => {
        if (active) setPatientPhotoUrl('');
      })
      .finally(() => {
        if (active) setPatientPhotoLoading(false);
      });
    return () => { active = false; };
  }, [isAdminPreview, patientData?.patient.hasPhoto, patientData?.patient.id]);

  useEffect(() => {
    if (!patientData) return;
    const patient = patientData.patient;
    setProfileForm({
      name: patient.name || '',
      fullName: patient.fullName || patient.name || '',
      birthDate: patient.birthDate || '',
      sex: patient.sex || 'Não informado',
      guardianName: patient.guardianName || '',
      whatsapp: patient.whatsapp || '',
      motherName: patient.motherName || '',
      motherProfession: patient.motherProfession || '',
      motherPhone: patient.motherPhone || '',
      fatherName: patient.fatherName || '',
      fatherProfession: patient.fatherProfession || '',
      fatherPhone: patient.fatherPhone || '',
      otherResponsibleName: patient.otherResponsibleName || '',
      otherResponsibleKinship: patient.otherResponsibleKinship || '',
      otherResponsiblePhone: patient.otherResponsiblePhone || '',
      school: patient.school || '',
      grade: patient.grade || 'Não informado',
      educationDetail: patient.educationDetail || '',
      shift: patient.shift || '',
      familyStatus: patient.familyStatus,
      custodyStatus: patient.custodyStatus,
      custodyResponsibleName: patient.custodyResponsibleName || '',
      custodyResponsibleKinship: patient.custodyResponsibleKinship || '',
      careProfessionals: patient.careProfessionals || [],
      doctorName: patient.doctorName || '',
      medication: patient.medication || '',
      emergencyContact: patient.emergencyContact || '',
      allergies: patient.allergies || '',
      financialResponsible: patient.financialResponsible,
      financialResponsibleOtherName: patient.financialResponsibleOtherName || '',
      financialResponsibleOtherKinship: patient.financialResponsibleOtherKinship || '',
      financialResponsibleOtherPhone: patient.financialResponsibleOtherPhone || '',
      financialResponsibleOtherCpf: patient.financialResponsibleOtherCpf || '',
    });
    setProfileMessage('');
    setProfileDeclarationAccepted(false);
    setProfileDeclarationError('');
    setProfileEditOpen(false);
    setDocumentFile(null);
    setDocumentNote('');
    setDocumentMessage('');
  }, [patientData?.patient.id]);

  const finalizeCurrentMediaView = useCallback(async () => {
    mediaViewSessionRef.current = null;
  }, []);

  const closeSelectedMedia = useCallback(async () => {
    setSelectedMediaId('');
    await finalizeCurrentMediaView();
  }, [finalizeCurrentMediaView]);

  const handleVideoPlay = useCallback((element: HTMLVideoElement) => {
    let session = mediaViewSessionRef.current;
    if (!session && selectedMedia?.mediaType === 'video') {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const interactionSessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${selectedMedia.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      session = {
        interactionSessionId,
        recordId: selectedMedia.id,
        patientId: selectedMedia.patientId,
        mediaType: 'video',
        startedAt: new Date().toISOString(),
        startedAtMs: nowMs,
        lastObservedPositionSeconds: null,
        seeking: false,
        totalPlayedSeconds: 0,
        maxPositionSeconds: Number.isFinite(element.currentTime) ? element.currentTime : 0,
        durationSeconds: Number.isFinite(element.duration) && element.duration > 0
          ? element.duration
          : (selectedMedia.durationSeconds || 0),
        playCount: 0,
        pauseCount: 0,
        seekCount: 0,
        completed: false,
        finalized: false,
      };
      mediaViewSessionRef.current = session;
    }
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    session.playCount += 1;
    session.seeking = false;
    session.lastObservedPositionSeconds = Number.isFinite(element.currentTime) ? element.currentTime : null;
  }, [selectedMedia]);

  const handleVideoPause = useCallback((element?: HTMLVideoElement) => {
    const session = mediaViewSessionRef.current;
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    session.lastObservedPositionSeconds = null;
    if (!element?.ended) session.pauseCount += 1;
  }, []);

  const handleVideoTimeUpdate = useCallback((element: HTMLVideoElement) => {
    const session = mediaViewSessionRef.current;
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    if (Number.isFinite(element.currentTime)) {
      const currentPosition = element.currentTime;
      if (!session.seeking && session.lastObservedPositionSeconds !== null && !element.paused) {
        const delta = currentPosition - session.lastObservedPositionSeconds;
        if (delta > 0 && delta <= 5) session.totalPlayedSeconds += delta;
      }
      session.lastObservedPositionSeconds = currentPosition;
      session.maxPositionSeconds = Math.max(session.maxPositionSeconds, currentPosition);
    }
    if (Number.isFinite(element.duration) && element.duration > 0) session.durationSeconds = element.duration;
  }, []);

  const handleVideoSeeking = useCallback(() => {
    const session = mediaViewSessionRef.current;
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    session.seekCount += 1;
    session.seeking = true;
    session.lastObservedPositionSeconds = null;
  }, []);

  const handleVideoSeeked = useCallback((element: HTMLVideoElement) => {
    const session = mediaViewSessionRef.current;
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    session.seeking = false;
    session.lastObservedPositionSeconds = Number.isFinite(element.currentTime) ? element.currentTime : null;
  }, []);

  const handleVideoEnded = useCallback(async () => {
    const session = mediaViewSessionRef.current;
    if (!session || session.mediaType !== 'video' || session.finalized) return;
    session.lastObservedPositionSeconds = null;
    session.seeking = false;
    session.completed = true;
    if (session.durationSeconds > 0) session.maxPositionSeconds = Math.max(session.maxPositionSeconds, session.durationSeconds);
    await finalizeCurrentMediaView();
  }, [finalizeCurrentMediaView]);

  useEffect(() => () => {
    void finalizeCurrentMediaView();
  }, [finalizeCurrentMediaView]);

  useEffect(() => {
    if (activePortalTab !== 'gallery' || groupedMedia.length === 0) return;
    const firstGroupKey = mediaGroupKey(groupedMedia[0][0]);
    setExpandedSessionGroups(current => (
      Object.keys(current).length > 0
        ? current
        : { [firstGroupKey]: true }
    ));
  }, [activePortalTab, groupedMedia]);

  useEffect(() => {
    if (isAdminPreview || activePortalTab !== 'gallery' || !patientData || !selectedPackage) return;
    const storageKey = `responsible-gallery-notified:${user.uid}:${patientData.patient.id}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === '1') return;
    } catch {
      // O servidor também deduplica por sessão autenticada.
    }
    void recordResponsiblePortalAction({
      eventType: 'gallery_access',
      patientId: patientData.patient.id,
      patientName: patientData.patient.name,
      clientContext: buildPortalClientContext(
        'gallery',
        `Portal do Responsável / Galeria de atividades / Pacote ${selectedPackage.number}`,
      ),
    }).then(() => {
      try {
        window.sessionStorage.setItem(storageKey, '1');
      } catch {
        // Sem armazenamento de sessão, a deduplicação do servidor permanece ativa.
      }
    }).catch(error => {
      console.error('Falha ao registrar acesso à galeria:', error);
    });
  }, [activePortalTab, isAdminPreview, patientData?.patient.id, patientData?.patient.name, selectedPackage?.number, user.uid]);


  const ensureMediaUrl = useCallback(async (record: ResponsiblePortalMedia): Promise<string> => {
    const cached = mediaUrlCacheRef.current[record.id];
    if (cached) return cached;
    setMediaUrlLoadingIds(current => new Set(current).add(record.id));
    try {
      const result = await getResponsibleMediaUrl(record.patientId, record.id, { adminPreview: isAdminPreview });
      mediaUrlCacheRef.current[record.id] = result.url;
      setMediaUrls(current => ({ ...current, [record.id]: result.url }));
      return result.url;
    } finally {
      setMediaUrlLoadingIds(current => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
    }
  }, [isAdminPreview]);

  const openMedia = useCallback(async (record: ResponsiblePortalMedia) => {
    setBusyAction({ id: record.id, type: 'open' });
    setActionError('');
    try {
      if (mediaViewSessionRef.current && mediaViewSessionRef.current.recordId !== record.id) {
        await finalizeCurrentMediaView();
      }
      await ensureMediaUrl(record);
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const interactionSessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${record.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      mediaViewSessionRef.current = {
        interactionSessionId,
        recordId: record.id,
        patientId: record.patientId,
        mediaType: record.mediaType,
        startedAt: new Date().toISOString(),
        startedAtMs: nowMs,
        lastObservedPositionSeconds: null,
        seeking: false,
        totalPlayedSeconds: 0,
        maxPositionSeconds: 0,
        durationSeconds: record.durationSeconds || 0,
        playCount: 0,
        pauseCount: 0,
        seekCount: 0,
        completed: false,
        finalized: false,
      };
      setSelectedMediaId(record.id);
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a mídia.');
    } finally {
      setBusyAction(null);
    }
  }, [ensureMediaUrl, finalizeCurrentMediaView]);

  const fetchMediaFile = useCallback(async (record: ResponsiblePortalMedia) => {
    const result = await getResponsibleMediaUrl(record.patientId, record.id);
    const response = await fetch(result.url);
    if (!response.ok) throw new Error('Não foi possível preparar o arquivo para download.');
    const blob = await response.blob();
    return {
      blob,
      fileName: result.fileName || record.fileName,
      url: result.url,
    };
  }, []);

  const requestDesktopSaveHandle = useCallback(async (fileName: string, mimeType = 'application/octet-stream') => {
    if (!isDesktopEnvironment()) return null;
    const picker = (window as typeof window & {
      showSaveFilePicker?: (options: unknown) => Promise<{
        createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    }).showSaveFilePicker;
    if (typeof picker !== 'function') return null;
    const extension = extensionFromFileName(fileName);
    return picker({
      suggestedName: fileName,
      types: [{
        description: 'Arquivo',
        accept: { [mimeType || 'application/octet-stream']: extension ? [extension] : [] },
      }],
    });
  }, []);

  const writeBlobToSaveHandle = useCallback(async (
    handle: { createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }> },
    blob: Blob,
  ) => {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }, []);

  const fallbackBrowserDownload = useCallback((blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }, []);

  const triggerDownload = useCallback(async (record: ResponsiblePortalMedia) => {
    const saveHandle = await requestDesktopSaveHandle(record.fileName, record.mimeType);
    const { blob, fileName } = await fetchMediaFile(record);
    if (saveHandle) await writeBlobToSaveHandle(saveHandle, blob);
    else fallbackBrowserDownload(blob, fileName);
  }, [fallbackBrowserDownload, fetchMediaFile, requestDesktopSaveHandle, writeBlobToSaveHandle]);

  const downloadMedia = useCallback(async (record: ResponsiblePortalMedia) => {
    setBusyAction({ id: record.id, type: 'download' });
    setActionError('');
    try {
      await triggerDownload(record);
    } catch (caughtError) {
      if ((caughtError as DOMException)?.name !== 'AbortError') {
        setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível baixar a mídia.');
      }
    } finally {
      setBusyAction(null);
    }
  }, [triggerDownload]);

  const downloadMany = useCallback(async (records: ResponsiblePortalMedia[]) => {
    if (records.length === 0) return;
    setBulkBusy(true);
    setActionError('');
    try {
      const directoryPicker = (window as typeof window & {
        showDirectoryPicker?: () => Promise<{
          getFileHandle: (name: string, options: { create: boolean }) => Promise<{
            createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }>;
          }>;
        }>;
      }).showDirectoryPicker;

      if (isDesktopEnvironment() && typeof directoryPicker === 'function') {
        const directory = await directoryPicker();
        for (const record of records) {
          const { blob, fileName } = await fetchMediaFile(record);
          const handle = await directory.getFileHandle(fileName, { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      } else {
        for (const record of records) {
          await triggerDownload(record);
          await new Promise(resolve => window.setTimeout(resolve, 250));
        }
      }
    } catch (caughtError) {
      if ((caughtError as DOMException)?.name !== 'AbortError') {
        setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível concluir todos os downloads.');
      }
    } finally {
      setBulkBusy(false);
    }
  }, [fetchMediaFile, triggerDownload]);

  const shareMedia = useCallback(async (record: ResponsiblePortalMedia, target: 'instagram' | 'whatsapp') => {
    if (isAdminPreview) return;
    setBusyAction({ id: record.id, type: 'share' });
    setActionError('');
    try {
      const { blob, fileName } = await fetchMediaFile(record);
      const caption = `${patientData?.patient.firstName || 'Atividade'} — ${formatDate(record.sessionDate, false)}`;
      const file = new File([blob], fileName, { type: record.mimeType || blob.type });
      const canNativeShareFile = typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] });

      if (target === 'instagram') {
        if (canNativeShareFile) {
          await navigator.share({ title: caption, text: caption, files: [file] });
        } else {
          fallbackBrowserDownload(blob, fileName);
          window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        }
      } else if (canNativeShareFile && !isDesktopEnvironment()) {
        await navigator.share({ title: caption, text: caption, files: [file] });
      } else {
        const text = encodeURIComponent(`${caption}
Arquivo preparado para compartilhamento.`);
        fallbackBrowserDownload(blob, fileName);
        window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
      }

    } catch (caughtError) {
      if ((caughtError as DOMException)?.name !== 'AbortError') {
        setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível compartilhar a mídia.');
      }
    } finally {
      setBusyAction(null);
    }
  }, [fallbackBrowserDownload, fetchMediaFile, isAdminPreview, patientData?.patient.firstName]);

  const toggleLike = useCallback(async (record: ResponsiblePortalMedia) => {
    if (isAdminPreview) return;
    setBusyAction({ id: record.id, type: 'like' });
    setActionError('');
    try {
      const nextLiked = !record.likedByCurrentResponsible;
      await recordResponsiblePortalAction({
        eventType: nextLiked ? 'media_like' : 'media_unlike',
        patientId: record.patientId,
        recordId: record.id,
        clientContext: buildPortalClientContext(
          'gallery',
          'Portal do Responsável / Galeria de atividades / Botão Curtir',
        ),
      });
      setData(current => updateMediaInData(current, record.patientId, record.id, item => ({
        ...item,
        likedByCurrentResponsible: nextLiked,
        likeCount: Math.max(item.likeCount + (nextLiked ? 1 : -1), 0),
      })));
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível registrar a curtida.');
    } finally {
      setBusyAction(null);
    }
  }, [isAdminPreview]);

  const submitComment = useCallback(async () => {
    if (isAdminPreview || !selectedMedia || !comment.trim()) return;
    setBusyAction({ id: selectedMedia.id, type: 'comment' });
    setActionError('');
    try {
      const result = await recordResponsiblePortalAction({
        eventType: 'media_comment',
        patientId: selectedMedia.patientId,
        recordId: selectedMedia.id,
        comment: comment.trim(),
        clientContext: buildPortalClientContext(
          'gallery',
          'Portal do Responsável / Galeria de atividades / Visualizador / Comentários',
        ),
      });
      if (result.comment) {
        setData(current => updateMediaInData(current, selectedMedia.patientId, selectedMedia.id, item => ({
          ...item,
          comments: [...item.comments, result.comment!],
        })));
      }
      setComment('');
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível enviar o comentário.');
    } finally {
      setBusyAction(null);
    }
  }, [comment, isAdminPreview, selectedMedia]);

  const navigateMedia = useCallback((direction: -1 | 1) => {
    if (!selectedMedia) return;
    const index = filteredMedia.findIndex(record => record.id === selectedMedia.id);
    if (index < 0) return;
    const next = filteredMedia[index + direction];
    if (next) void openMedia(next);
  }, [filteredMedia, openMedia, selectedMedia]);

  const toggleSelection = useCallback((recordId: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const selectedRecords = useMemo(() => filteredMedia.filter(record => selectedIds.has(record.id)), [filteredMedia, selectedIds]);

  const toggleSessionGroup = useCallback((groupKey: string) => {
    setExpandedSessionGroups(current => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const saveResponsibleProfile = useCallback(async () => {
    if (isAdminPreview || !patientData) return;
    const missingRequiredField = !profileForm.name.trim()
      || !String(profileForm.fullName || '').trim()
      || !profileForm.birthDate
      || !profileForm.guardianName.trim()
      || !profileForm.whatsapp.trim();
    if (missingRequiredField) {
      setActionError('Preencha o 1º nome e o nome completo do Atendente, a data de nascimento, o 1º nome do Responsável e o WhatsApp do Responsável.');
      return;
    }
    if (!profileDeclarationAccepted) {
      setProfileDeclarationError('Marque a declaração de ciência antes de enviar para análise.');
      return;
    }
    setProfileDeclarationError('');
    setProfileSaving(true);
    setActionError('');
    setProfileMessage('');
    try {
      const result = await requestResponsiblePatientUpdate(
        patientData.patient.id,
        profileForm,
        profileDeclarationAccepted,
        buildPortalClientContext(
          'profile',
          'Portal do Responsável / Solicitação de alteração cadastral / Botão Enviar para análise',
        ),
      );
      if (result.request) {
        setData(current => {
          if (!current) return current;
          return {
            ...current,
            patients: current.patients.map(item => (
              item.patient.id === patientData.patient.id
                ? {
                    ...item,
                    latestProfileChangeRequest: {
                      id: result.request!.id,
                      status: result.request!.status,
                      createdAt: result.request!.createdAt,
                      reviewedAt: result.request!.reviewedAt,
                    },
                  }
                : item
            )),
          };
        });
      }
      if (result.existingPending) {
        setProfileMessage('Já existe uma solicitação pendente para este cadastro. Aguarde a análise do profissional.');
      } else if (result.submitted) {
        setProfileMessage('Solicitação enviada para análise. Os dados oficiais só serão alterados após a aprovação do profissional.');
        window.setTimeout(() => { setProfileDeclarationAccepted(false); setProfileDeclarationError(''); setProfileEditOpen(false); }, 1200);
      } else {
        setProfileMessage('Nenhuma alteração foi necessária.');
      }
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível atualizar o cadastro.');
    } finally {
      setProfileSaving(false);
    }
  }, [isAdminPreview, patientData, profileDeclarationAccepted, profileForm]);

  const submitResponsibleDocument = useCallback(async () => {
    if (isAdminPreview || !patientData || !documentFile) return;
    setDocumentUploading(true);
    setDocumentMessage('');
    setActionError('');
    try {
      const uploaded = await uploadResponsibleDocument({
        patientId: patientData.patient.id,
        file: documentFile,
        category: documentCategory,
        note: documentNote.trim(),
        clientContext: buildPortalClientContext(
          'profile',
          'Portal do Responsável / Atualização cadastral / Enviar documento',
        ),
      });
      setData(current => {
        if (!current) return current;
        return {
          ...current,
          patients: current.patients.map(item => (
            item.patient.id === patientData.patient.id
              ? { ...item, documents: [uploaded, ...(item.documents || [])] }
              : item
          )),
        };
      });
      setDocumentFile(null);
      setDocumentNote('');
      setDocumentMessage('Documento enviado com sucesso. O profissional foi notificado pelo sino.');
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível enviar o documento.');
    } finally {
      setDocumentUploading(false);
    }
  }, [documentCategory, documentFile, documentNote, isAdminPreview, patientData]);

  const downloadResponsibleDocument = useCallback(async (document: { id: string; fileName: string }) => {
    if (!patientData) return;
    setActionError('');
    try {
      const saveHandle = await requestDesktopSaveHandle(document.fileName);
      const result = await getResponsibleDocumentUrl(patientData.patient.id, document.id, { adminPreview: isAdminPreview });
      const response = await fetch(result.url);
      if (!response.ok) throw new Error('Não foi possível carregar o documento.');
      const blob = await response.blob();
      if (saveHandle) await writeBlobToSaveHandle(saveHandle, blob);
      else fallbackBrowserDownload(blob, result.fileName || document.fileName);
    } catch (caughtError) {
      if ((caughtError as DOMException)?.name !== 'AbortError') {
        setActionError(caughtError instanceof Error ? caughtError.message : 'Não foi possível baixar o documento.');
      }
    }
  }, [fallbackBrowserDownload, isAdminPreview, patientData, requestDesktopSaveHandle, writeBlobToSaveHandle]);

  const resetFilters = () => {
    setPeriodFilter('all');
    setCategoryFilter('all');
    setMediaFilter('all');
    setSessionFilter('all');
    setVisibilityFilter('all');
    setShareFilter('all');
    setProfessionalFilter('all');
  };

  const sessionSummary = useMemo(() => {
    const summary = {
      realizada: 0,
      reposicao: 0,
      agendada: 0,
      falta: 0,
      faltaProfissional: 0,
      semReposicao: 0,
    };
    for (const session of selectedPackage?.sessions || []) {
      if (session.status === 'Realizada') summary.realizada += 1;
      else if (session.status === 'Reposição') summary.reposicao += 1;
      else if (session.status === 'Falta') summary.falta += 1;
      else if (session.status === 'Falta.Prof') summary.faltaProfissional += 1;
      else if (session.status === NO_REPLACEMENT_SESSION_STATUS) summary.semReposicao += 1;
      else summary.agendada += 1;
    }
    return summary;
  }, [selectedPackage?.sessions]);

  const portalTabs: Array<{ id: PortalTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'dashboard', label: 'Resumo geral', icon: BarChart3 },
    { id: 'sessions', label: 'Sessões agendadas', icon: CalendarDays },
    { id: 'gallery', label: 'Galeria de atividades', icon: ImageIcon },
    { id: 'profile', label: 'Atualização cadastral', icon: ClipboardList },
  ];

  return (
    <div className="min-h-screen bg-clinic-bg">
      {isAdminPreview && adminPreview && (
        <div className="sticky top-0 z-[160] border-b border-indigo-200 bg-indigo-950 text-white shadow-lg">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-indigo-100">
                <Eye size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-200">Visualização administrativa</p>
                <p className="truncate text-sm font-black">
                  Portal do Responsável — {adminPreview.patientName}
                </p>
                <p className="mt-0.5 text-xs text-indigo-100/85">
                  Somente leitura. Nenhuma solicitação, curtida, comentário, documento ou notificação será criada em nome da família.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {adminPreviewMeta && adminPreviewMeta.responsibleOptions.length > 1 && (
                <label className="min-w-0 sm:min-w-64">
                  <span className="sr-only">Responsável visualizado</span>
                  <select
                    value={adminPreviewMeta.selectedResponsibleUid}
                    onChange={event => {
                      const nextResponsibleUid = event.target.value;
                      previewResponsibleUidRef.current = nextResponsibleUid;
                      setPreviewResponsibleUid(nextResponsibleUid);
                      void loadPortal(nextResponsibleUid);
                    }}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-white/40"
                  >
                    {adminPreviewMeta.responsibleOptions.map(option => (
                      <option key={option.uid} value={option.uid} className="text-slate-900">
                        {option.displayName}{option.email ? ` — ${option.email}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {adminPreviewMeta && !adminPreviewMeta.hasLinkedResponsible && (
                <span className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">
                  Sem conta de responsável vinculada; exibindo a visão padrão do atendente.
                </span>
              )}

              <button
                type="button"
                onClick={adminPreview.onBack}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-indigo-950 transition hover:bg-indigo-50"
              >
                <ArrowLeft size={17} />
                Voltar para Administração
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-clinic-header text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-2 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="w-full min-w-0 md:hidden">
            <BrandLogo
              variant="compact"
              theme={data?.settings.visualTheme}
              name={data?.settings.name}
              subtitle={data?.settings.title}
              className="w-full justify-center"
            />
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <BrandLogo
              theme={data?.settings.visualTheme}
              name={data?.settings.name}
              subtitle={data?.settings.title}
              className="max-w-full"
            />
          </div>
          {!isAdminPreview && (
            <button
              type="button"
              onClick={() => void logout()}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/25 px-4 py-2 text-sm font-bold transition hover:bg-white/10"
            >
              <LogOut size={17} />
              Sair
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="rounded-2xl bg-gradient-to-br from-clinic-header to-clinic-primary p-6 text-white shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">{isAdminPreview ? 'Prévia segura do acesso familiar' : 'Acesso individual e protegido'}</p>
          <h1 className="mt-2 text-3xl font-bold">Portal do Responsável</h1>
          <div className="mt-5 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:gap-8">
            <span className="flex items-center gap-2">
              <UserRound size={18} />
              {data?.responsible.displayName || user.displayName || 'Responsável'}
            </span>
            <span className="break-all text-white/80">
              {data?.responsible.email || (isAdminPreview ? 'Responsável sem e-mail vinculado' : user.email)}
            </span>
          </div>
        </section>

        {loading && (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-clinic-border bg-clinic-surface text-clinic-text-muted">
            <Loader2 size={30} className="animate-spin text-clinic-primary" />
            Carregando informações autorizadas...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-status-red-text/20 bg-status-red-bg p-5 text-sm text-status-red-text">
            <p className="font-bold">{error}</p>
            <button
              type="button"
              onClick={() => void loadPortal()}
              className="mt-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-bold shadow-sm"
            >
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && data && data.patients.length === 0 && (
          <section className="rounded-2xl border border-status-orange-text/25 bg-status-orange-bg p-6 text-center">
            <ShieldCheck className="mx-auto text-status-orange-text" size={36} />
            <p className="mx-auto mt-4 max-w-2xl font-bold text-clinic-text">
              Seu acesso foi aprovado, mas ainda não há atendente vinculado ao seu perfil. Favor entrar em contato com a clínica responsável.
            </p>
          </section>
        )}

        {!loading && !error && patientData && selectedPackage && (
          <>
            {actionError && (
              <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">
                {actionError}
              </div>
            )}

            <section className="rounded-2xl border border-clinic-primary/20 bg-clinic-surface p-5 shadow-clinic">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => patientPhotoUrl && setPatientPhotoExpanded(true)}
                    disabled={!patientPhotoUrl}
                    className="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-clinic-border bg-clinic-bg text-2xl font-black text-clinic-primary shadow-sm transition-transform hover:scale-[1.02] disabled:cursor-default sm:h-32 sm:w-32"
                    aria-label={patientPhotoUrl ? `Ampliar foto de ${patientData.patient.name}` : `Sem foto de ${patientData.patient.name}`}
                  >
                    {patientPhotoLoading ? (
                      <Loader2 size={24} className="animate-spin" />
                    ) : patientPhotoUrl ? (
                      <img src={patientPhotoUrl} alt={patientData.patient.name} className="h-full w-full object-cover" />
                    ) : (
                      patientData.patient.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-clinic-primary">Atendente vinculado</p>
                    <h2 className="mt-2 break-words text-2xl font-bold text-clinic-text">{patientData.patient.name}</h2>
                    <p className="mt-2 text-sm text-clinic-text-muted">
                      Visualização de sessões, atividades e informações autorizadas pela clínica.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActivePortalTab('profile')}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
                    >
                      <RefreshCw size={15} />
                      Ir para atualização cadastral
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[580px]">
                  {data && data.patients.length > 1 && (
                    <label>
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Selecionar atendente</span>
                      <select
                        value={patientData.patient.id}
                        onChange={event => setSelectedPatientId(event.target.value)}
                        className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm font-bold text-clinic-text"
                      >
                        {data.patients.map(item => <option key={item.patient.id} value={item.patient.id}>{item.patient.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className={data && data.patients.length > 1 ? '' : 'sm:col-span-2'}>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Pacote de sessões</span>
                    <select
                      value={selectedPackage.number}
                      onChange={event => setSelectedPackageNumber(Number(event.target.value))}
                      className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm font-bold text-clinic-text"
                    >
                      {visiblePackages.map(pkg => <option key={pkg.number} value={pkg.number}>{packageLabel(pkg)}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            </section>

            <nav className="overflow-x-auto rounded-2xl border border-clinic-border bg-clinic-surface p-2 shadow-clinic" aria-label="Seções do Portal do Responsável">
              <div className="flex min-w-max gap-2 sm:min-w-0 sm:grid sm:grid-cols-5">
                {portalTabs.map(tab => {
                  const Icon = tab.icon;
                  const active = activePortalTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActivePortalTab(tab.id)}
                      className={`flex min-w-[190px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wide transition sm:min-w-0 ${active ? 'bg-clinic-primary text-white shadow-sm' : 'bg-clinic-bg text-clinic-text-muted hover:text-clinic-primary'}`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={17} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </nav>

            {activePortalTab === 'dashboard' && (
              <div className="space-y-6">
                <section className="grid gap-4 md:grid-cols-3">
              <article className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
                <p className="text-xs font-black uppercase tracking-wide text-clinic-text-faint">Progresso do pacote</p>
                <p className="mt-2 text-3xl font-black text-clinic-primary">{selectedPackage.consumedCount}/10</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-clinic-bg">
                  <div className="h-full rounded-full bg-clinic-primary" style={{ width: `${Math.min(selectedPackage.consumedCount * 10, 100)}%` }} />
                </div>
                <p className="mt-2 text-xs font-bold text-clinic-text-muted">{selectedPackage.remainingCount} sessões restantes</p>
              </article>
              <article className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic md:row-span-2">
                <p className="text-xs font-black uppercase tracking-wide text-clinic-text-faint">Situação financeira</p>
                <div className="mt-2 flex items-center gap-2">
                  <WalletCards className="text-clinic-primary" size={24} />
                  <p className="text-2xl font-black capitalize text-clinic-text">{selectedPackage.financialStatus}</p>
                </div>
                <p className="mt-2 text-xs font-bold text-clinic-text-muted">
                  Pago: {formatCurrency(selectedPackage.paidAmount)} • Pendente: {formatCurrency(selectedPackage.pendingAmount)}
                </p>
                {selectedPackage.installments.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-clinic-border pt-4">
                    <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Pagamentos registrados</p>
                    {selectedPackage.installments.map(payment => (
                      <div key={payment.id} className="rounded-xl bg-clinic-bg px-3 py-3">
                        <p className="text-sm font-black text-clinic-text">
                          {payment.installment || 'Pagamento'} — {formatCurrency(payment.amount)}
                        </p>
                        <p className="mt-1 text-xs text-clinic-text-muted">
                          {formatDate(payment.date, false)} • {payment.method || 'Forma não informada'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className={`rounded-2xl border p-5 shadow-clinic ${selectedPackage.consumedCount >= 9 ? 'border-status-orange-text/30 bg-status-orange-bg' : 'border-clinic-border bg-clinic-surface'}`}>
                <p className="text-xs font-black uppercase tracking-wide text-clinic-text-faint">Renovação</p>
                <p className="mt-2 text-lg font-black text-clinic-text">
                  {selectedPackage.consumedCount >= 9 ? 'Pacote próximo do encerramento' : 'Acompanhamento em andamento'}
                </p>
                <p className="mt-2 text-xs font-bold text-clinic-text-muted">
                  {selectedPackage.consumedCount >= 9
                    ? 'A clínica poderá entrar em contato para organizar a continuidade.'
                    : 'O aviso de renovação aparecerá a partir da 9ª sessão.'}
                </p>
              </article>
                </section>

                <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-clinic-text-faint">Resumo das sessões</p>
                      <h2 className="mt-1 text-lg font-black text-clinic-text">Visão rápida do pacote atual</h2>
                      <p className="mt-1 text-xs text-clinic-text-muted">Acompanhe os principais estados sem precisar abrir toda a lista de sessões.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div
                        className="relative flex h-24 w-24 items-center justify-center rounded-full"
                        style={{ background: `conic-gradient(var(--color-clinic-primary) ${Math.min(selectedPackage.consumedCount * 10, 100)}%, color-mix(in srgb, var(--color-clinic-primary) 12%, white) 0)` }}
                        aria-label={`${selectedPackage.consumedCount} de 10 sessões concluídas`}
                      >
                        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white shadow-sm">
                          <span className="text-xl font-black text-clinic-primary">{selectedPackage.consumedCount}/10</span>
                          <span className="text-[9px] font-black uppercase text-clinic-text-faint">concluídas</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      ['Realizadas', sessionSummary.realizada, 'bg-status-green-bg text-status-green-text'],
                      ['Reposições', sessionSummary.reposicao, 'bg-status-orange-bg text-status-orange-text'],
                      ['Agendadas', sessionSummary.agendada, 'bg-status-blue-bg text-status-blue-text'],
                      ['Faltas', sessionSummary.falta, 'bg-status-red-bg text-status-red-text'],
                      ['Sem reposição', sessionSummary.semReposicao, 'bg-[#FFF4F4] text-[#A94444]'],
                      ['Falta profissional', sessionSummary.faltaProfissional, 'bg-orange-100 text-orange-700'],
                    ].map(([label, value, tone]) => (
                      <article key={String(label)} className={`rounded-xl px-4 py-3 ${String(tone)}`}>
                        <p className="text-2xl font-black">{String(value)}</p>
                        <p className="text-[10px] font-black uppercase tracking-wide">{String(label)}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activePortalTab === 'sessions' && (
              <PackageSessionsTable pkg={selectedPackage} />
            )}

            {activePortalTab === 'gallery' && patientData && (
              <ResponsibleGooglePhotosGallery
                patientId={patientData.patient.id}
                patientName={patientData.patient.fullName || patientData.patient.name}
                packageNumber={selectedPackage.number}
              />
            )}

            {activePortalTab === 'profile' && (
              <section className="space-y-5 rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-6">
                <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-clinic-primary">Atualização cadastral</p>
                    <h2 className="mt-1 text-xl font-black text-clinic-text">Dados detalhados de {patientData.patient.firstName}</h2>
                    <p className="mt-1 text-xs text-clinic-text-muted">
                      {isAdminPreview
                        ? 'Visualização administrativa dos mesmos dados apresentados à família.'
                        : 'As alterações ficam registradas no histórico e geram notificação no sino da área profissional.'}
                    </p>
                  </div>
                  {isAdminPreview ? (
                    <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-indigo-700">
                      <Eye size={16} />
                      Somente leitura
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setProfileMessage(''); setProfileDeclarationAccepted(false); setProfileDeclarationError(''); setProfileEditOpen(true); }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase tracking-wide text-white"
                    >
                      <RefreshCw size={16} />
                      Editar cadastro
                    </button>
                  )}
                </header>

                {patientData.latestProfileChangeRequest && (
                  <div className={`rounded-xl border p-4 text-sm font-bold ${
                    patientData.latestProfileChangeRequest.status === 'pending'
                      ? 'border-status-orange-text/25 bg-status-orange-bg text-status-orange-text'
                      : patientData.latestProfileChangeRequest.status === 'approved'
                        ? 'border-status-green-text/25 bg-status-green-bg text-status-green-text'
                        : 'border-status-red-text/25 bg-status-red-bg text-status-red-text'
                  }`}>
                    {patientData.latestProfileChangeRequest.status === 'pending' && 'Sua última solicitação está pendente de análise pelo profissional.'}
                    {patientData.latestProfileChangeRequest.status === 'approved' && 'Sua última solicitação foi aprovada e os dados oficiais foram atualizados.'}
                    {patientData.latestProfileChangeRequest.status === 'rejected' && 'Sua última solicitação foi recusada. Confira os dados atuais antes de enviar uma nova solicitação.'}
                  </div>
                )}

                <PatientRegistrationSummary value={patientData.patient} />

                <section className="rounded-2xl border border-clinic-border bg-clinic-bg/50 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-clinic-primary">
                        <FileText size={18} />
                        <h3 className="font-black text-clinic-text">Documentos e anexos</h3>
                      </div>
                      <p className="mt-1 text-xs text-clinic-text-muted">Envie receitas, laudos, exames e relatórios. O arquivo será armazenado no Google Drive da clínica e aparecerá no cadastro profissional.</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase text-clinic-primary shadow-sm">Máximo de 20 MB</span>
                  </div>

                  {isAdminPreview && (
                    <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-bold text-indigo-800">
                      O envio de documentos está desativado nesta visualização. Os documentos já liberados continuam disponíveis para conferência.
                    </div>
                  )}

                  {!isAdminPreview && (
                    <>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
                    <label>
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Tipo de documento</span>
                      <select
                        value={documentCategory}
                        onChange={event => setDocumentCategory(event.target.value)}
                        className="w-full rounded-xl border border-clinic-border bg-white px-3 py-3 text-sm text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
                      >
                        {[
                          'Receita médica',
                          'Laudo',
                          'Exame',
                          'Relatório escolar',
                          'Atestado',
                          'Encaminhamento',
                          'Carteira de vacinação',
                          'Comprovante de pagamento',
                          'Outro',
                        ].map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Arquivo</span>
                      <input
                        type="file"
                        accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                        onChange={event => {
                          const nextFile = event.target.files?.[0] || null;
                          setDocumentFile(nextFile);
                          setDocumentMessage('');
                        }}
                        className="block w-full rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-sm text-clinic-text file:mr-3 file:rounded-lg file:border-0 file:bg-clinic-primary file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:text-white"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void submitResponsibleDocument()}
                      disabled={!documentFile || documentUploading}
                      className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-5 py-3 text-xs font-black uppercase text-white disabled:opacity-45"
                    >
                      {documentUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      Enviar documento
                    </button>
                  </div>

                  <label className="mt-3 block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Observação opcional</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={documentNote}
                      onChange={event => setDocumentNote(event.target.value)}
                      className="w-full rounded-xl border border-clinic-border bg-white p-3 text-sm text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
                      placeholder="Ex.: receita atualizada pelo neurologista em junho de 2026."
                    />
                  </label>

                  {documentFile && (
                    <p className="mt-2 text-xs font-bold text-clinic-text-muted">
                      Selecionado: {documentFile.name} • {formatFileSize(documentFile.size)}
                    </p>
                  )}
                  {documentMessage && <p className="mt-3 rounded-xl bg-status-green-bg p-3 text-sm font-bold text-status-green-text">{documentMessage}</p>}
                    </>
                  )}

                  <div className="mt-5 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Documentos já enviados</p>
                    {(patientData.documents || []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-clinic-border bg-white p-5 text-center text-sm text-clinic-text-muted">Nenhum documento enviado pelo portal.</div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {(patientData.documents || []).map(document => (
                          <article key={document.id} className="flex items-start justify-between gap-3 rounded-xl border border-clinic-border bg-white p-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-clinic-text">{document.category}</p>
                              <p className="mt-1 truncate text-xs text-clinic-text-muted">{document.fileName}</p>
                              <p className="mt-1 text-[10px] font-bold text-clinic-text-faint">
                                {formatFileSize(document.sizeBytes)} • {formatDateTime(document.createdAt)}
                              </p>
                              {document.note && <p className="mt-2 line-clamp-2 text-xs text-clinic-text-muted">{document.note}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={() => void downloadResponsibleDocument(document)}
                              className="shrink-0 rounded-lg bg-clinic-bg p-2.5 text-clinic-primary"
                              aria-label={`Baixar ${document.fileName}`}
                            >
                              <Download size={16} />
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </section>
            )}
          </>
        )}
      </main>

      {!isAdminPreview && profileEditOpen && patientData && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Atualizar cadastro do atendente">
          <div className="max-h-[96vh] w-full max-w-4xl overflow-auto rounded-2xl bg-clinic-surface shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-clinic-border bg-clinic-surface/95 px-4 py-4 backdrop-blur sm:px-6">
              <div>
                <h2 className="text-lg font-black text-clinic-text">Atualizar cadastro</h2>
                <p className="text-xs text-clinic-text-muted">As alterações serão enviadas para análise. Os dados oficiais só mudam após aprovação do profissional.</p>
              </div>
              <button type="button" onClick={() => { setProfileDeclarationAccepted(false); setProfileDeclarationError(''); setProfileEditOpen(false); }} className="rounded-full bg-clinic-bg p-2 text-clinic-text-muted" aria-label="Fechar atualização cadastral"><X size={20} /></button>
            </header>
            <div className="space-y-5 p-4 sm:p-6">
              <PatientRegistrationFields
                value={profileForm}
                onChange={patch => setProfileForm(current => ({ ...current, ...patch }))}
                disabled={profileSaving}
                requiredCore
              />
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${profileDeclarationAccepted ? 'border-clinic-primary/35 bg-clinic-primary/5' : 'border-clinic-border bg-clinic-bg'}`}>
                <input
                  type="checkbox"
                  checked={profileDeclarationAccepted}
                  onChange={event => {
                    setProfileDeclarationAccepted(event.target.checked);
                    if (event.target.checked) setProfileDeclarationError('');
                  }}
                  disabled={profileSaving}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-clinic-primary"
                />
                <span className="text-xs leading-relaxed text-clinic-text-muted">
                  Declaro que as informações fornecidas são verdadeiras e não substituem orientação ou prescrição médica.
                </span>
              </label>
              {profileDeclarationError && (
                <p className="rounded-xl border border-status-red-text/20 bg-status-red-bg p-3 text-xs font-bold text-status-red-text">
                  {profileDeclarationError}
                </p>
              )}
              {profileMessage && <p className="rounded-xl bg-status-green-bg p-3 text-sm font-bold text-status-green-text">{profileMessage}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => { setProfileDeclarationAccepted(false); setProfileDeclarationError(''); setProfileEditOpen(false); }} disabled={profileSaving} className="rounded-xl border border-clinic-border px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">Cancelar</button>
                <button type="button" onClick={() => void saveResponsibleProfile()} disabled={profileSaving || !profileDeclarationAccepted || !profileForm.name.trim() || !String(profileForm.fullName || '').trim() || !profileForm.birthDate || !profileForm.guardianName.trim() || !profileForm.whatsapp.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-5 py-3 text-xs font-black uppercase text-white disabled:opacity-45">
                  {profileSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Enviar para análise
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {patientPhotoExpanded && patientPhotoUrl && patientData && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ampliada de ${patientData.patient.name}`}
          onClick={() => setPatientPhotoExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setPatientPhotoExpanded(false)}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow-lg"
            aria-label="Fechar foto ampliada"
          >
            <X size={24} />
          </button>
          <div className="flex max-h-[94vh] max-w-[96vw] flex-col items-center gap-3" onClick={event => event.stopPropagation()}>
            <img src={patientPhotoUrl} alt={`Foto ampliada de ${patientData.patient.name}`} className="max-h-[84vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl" />
            <p className="max-w-[90vw] truncate rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white">{patientData.patient.name}</p>
          </div>
        </div>
      )}

      {selectedMedia && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-2 sm:p-4">
          <div className="max-h-[96vh] w-full max-w-6xl overflow-auto rounded-2xl bg-clinic-surface shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-clinic-border bg-clinic-surface/95 px-4 py-3 backdrop-blur">
              <div className="min-w-0">
                <p className="truncate font-bold text-clinic-text">{getActivityRecordCategoryLabel(selectedMedia.category)}</p>
                <p className="truncate text-xs text-clinic-text-muted">{formatDate(selectedMedia.sessionDate, false)} às {selectedMedia.sessionTime}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void navigateMedia(-1)} className="rounded-full bg-clinic-bg p-2 text-clinic-primary" aria-label="Mídia anterior"><ChevronLeft size={20} /></button>
                <button type="button" onClick={() => void navigateMedia(1)} className="rounded-full bg-clinic-bg p-2 text-clinic-primary" aria-label="Próxima mídia"><ChevronRight size={20} /></button>
                <button type="button" onClick={() => void mediaElementRef.current?.requestFullscreen?.()} className="rounded-full bg-clinic-bg p-2 text-clinic-primary" aria-label="Tela cheia"><Expand size={19} /></button>
                <button type="button" onClick={() => void closeSelectedMedia()} className="rounded-full bg-clinic-bg p-2 text-clinic-text-muted hover:text-clinic-primary" aria-label="Fechar mídia"><X size={20} /></button>
              </div>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                {selectedMedia.mediaType === 'video' ? (
                  <video
                    ref={element => { mediaElementRef.current = element; }}
                    src={mediaUrls[selectedMedia.id]}
                    controls
                    playsInline
                    preload="metadata"
                    onPlay={event => handleVideoPlay(event.currentTarget)}
                    onPause={event => handleVideoPause(event.currentTarget)}
                    onSeeking={handleVideoSeeking}
                    onSeeked={event => handleVideoSeeked(event.currentTarget)}
                    onTimeUpdate={event => handleVideoTimeUpdate(event.currentTarget)}
                    onLoadedMetadata={event => handleVideoTimeUpdate(event.currentTarget)}
                    onEnded={() => void handleVideoEnded()}
                    className="max-h-[72vh] w-full rounded-xl bg-black"
                  />
                ) : (
                  <img
                    ref={element => { mediaElementRef.current = element; }}
                    src={mediaUrls[selectedMedia.id]}
                    alt={selectedMedia.description || getActivityRecordCategoryLabel(selectedMedia.category)}
                    className="max-h-[72vh] w-full rounded-xl bg-black/5 object-contain"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void downloadMedia(selectedMedia)} className="flex items-center gap-2 rounded-lg bg-clinic-primary px-4 py-2 text-xs font-black uppercase text-white"><Download size={15} /> Baixar</button>
                  {!isAdminPreview && (
                    <>
                      <button type="button" onClick={() => void shareMedia(selectedMedia, 'instagram')} className="flex items-center gap-2 rounded-lg bg-pink-50 px-4 py-2 text-xs font-black uppercase text-pink-700"><Instagram size={15} /> Compartilhar mídia no Instagram</button>
                      <button type="button" onClick={() => void shareMedia(selectedMedia, 'whatsapp')} className="flex items-center gap-2 rounded-lg bg-status-green-bg px-4 py-2 text-xs font-black uppercase text-status-green-text"><MessageCircle size={15} /> Compartilhar mídia no WhatsApp</button>
                      <button type="button" onClick={() => void toggleLike(selectedMedia)} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black uppercase ${selectedMedia.likedByCurrentResponsible ? 'bg-red-50 text-red-600' : 'bg-clinic-bg text-clinic-text-muted'}`}><Heart size={15} fill={selectedMedia.likedByCurrentResponsible ? 'currentColor' : 'none'} /> {selectedMedia.likeCount}</button>
                    </>
                  )}
                  {isAdminPreview && (
                    <span className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black uppercase text-indigo-700">
                      <Eye size={15} />
                      Interações desativadas
                    </span>
                  )}
                </div>
                <div className="rounded-xl border border-clinic-border bg-clinic-bg p-4 text-sm">
                  <p className="font-bold text-clinic-text">{getActivityRecordCategoryLabel(selectedMedia.category)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-clinic-text-muted">{selectedMedia.description || 'Sem observação.'}</p>
                  <p className="mt-3 text-xs font-bold text-clinic-text-faint">Profissional: {selectedMedia.professionalName || 'Fábio Denarde'}</p>
                </div>
              </div>

              <aside className="space-y-3 rounded-xl border border-clinic-border bg-clinic-bg p-4">
                <div>
                  <h3 className="font-bold text-clinic-text">Comentários</h3>
                  <p className="text-xs text-clinic-text-muted">O profissional será notificado quando um comentário for enviado.</p>
                </div>
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {selectedMedia.comments.length === 0 && <p className="rounded-lg bg-white p-3 text-xs text-clinic-text-muted">Nenhum comentário ainda.</p>}
                  {selectedMedia.comments.map(item => (
                    <article key={item.id} className="rounded-lg bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black text-clinic-text">{item.responsibleName}</p>
                        <span className="text-[10px] text-clinic-text-faint">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-clinic-text-muted">{item.comment}</p>
                    </article>
                  ))}
                </div>
                {isAdminPreview ? (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs font-bold text-indigo-800">
                    Os comentários existentes podem ser conferidos, mas novos comentários não podem ser enviados na visualização administrativa.
                  </div>
                ) : (
                  <>
                    <label>
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Adicionar comentário</span>
                      <textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} rows={4} className="w-full rounded-xl border border-clinic-border bg-white p-3 text-sm text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary" placeholder="Escreva uma observação sobre esta atividade..." />
                    </label>
                    <button type="button" onClick={() => void submitComment()} disabled={!comment.trim() || busyAction?.type === 'comment'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-45">
                      {busyAction?.type === 'comment' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                      Enviar comentário
                    </button>
                  </>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
