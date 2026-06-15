import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Film, ImagePlus, Loader2, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { Patient, Session } from '../../types';
import { SessionStatus } from '../../types';
import { ACTIVITY_RECORD_CATEGORIES, getDefaultActivityAuthorization, type ActivityRecordCategory, type ActivityRecordVisibility } from '../../types/activityRecords';
import { assertActivityMediaSourceReadable, inspectActivityMediaSource, processActivityMedia } from '../../lib/imageProcessing';
import {
  activityFileNeedsReselection,
  cancelActivityUpload,
  cancelActiveActivityUpload,
  checkActivityMediaDuplicate,
  getActivityRecordErrorMessage,
  prepareActivityUploadBatch,
  uploadPreparedActivityMediaDirect,
  type PreparedDirectActivityUpload,
  type UploadActivityPhotoInput,
} from '../../lib/activityRecordsApi';
import { selectActivityUploadItems } from '../../lib/activityUploadRetry.js';
import {
  calculateActivityUploadProgress,
  calculateActivityUploadTelemetry,
  formatActivityUploadEta,
  runActivityUploadPools,
} from '../../lib/activityUploadScheduler.js';
import {
  MAX_ACTIVITY_TOTAL_MEDIA,
  canAddNextActivityBatch,
  classifyActivityMediaError,
  createPreparedPhotoRetry,
  createActivityMediaRetention,
  formatActivityUploadSummary,
  getActivityFailurePresentation,
  getAcceptedActivityBatchFiles,
  getActivityBatchOverview,
  getActivityCloseImpact,
  getActivityQueueStatusMessage,
  getActivitySelectionErrorMessage,
  getActivityUploadSummaryTitle,
  getActivityUploadSummaryTone,
  isSameSessionDuplicateError,
  matchActivityMediaReplacements,
  processAfterNonBlockingProbe,
  releaseActivityMediaRetention,
  validateActivityBatchSelection,
} from '../../lib/activityMediaQueue.js';
import Modal from '../Common/Modal';
import { showToast } from '../Common/Toast';
import { safeFormatDate } from '../../lib/utils';
import { getPatientSessionsThroughDate } from '../../lib/sessionVisibility';
import {
  assertDurableActivityStorageCapacity,
  buildActivityMediaManifest,
  buildActivityMediaScopeKey,
  cleanupActivityMediaAcquisition,
  estimateActivityAcquisitionBytes,
  inspectDurableActivityStorage,
  isExactActivityMediaDuplicate,
  hashBlobIncrementally,
  listActivityMediaManifests,
  persistActivityBlob,
  persistActivitySelectionBlobs,
  pinActivityMediaSelection,
  releasePinnedActivityMediaSelection,
  readPersistedActivityFile,
  saveActivityMediaManifest,
} from '../../lib/activityMediaAcquisition.js';
import { createActivityMediaThumbnail } from '../../lib/activityMediaThumbnails.js';

interface ActivityRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient;
  sessions: Session[];
  initialSession?: Session | null;
  currentUserName: string;
  onViewGallery?: () => void;
}

type SaveStage = 'idle' | 'preparing' | 'uploading' | 'finalizing';

type QueueStatus = 'acquiring' | 'duplicate' | 'verification' | 'queued' | 'preparing' | 'uploading' | 'failed';
type UploadMode = 'all' | 'failed' | 'pending';
type ActivityStorageMode = 'opfs' | 'indexeddb' | 'memory-fallback';

interface QueuedActivityMedia {
  id: string;
  uploadAttemptId: string;
  sourceFile: File;
  previewUrl: string;
  retentionUrl: string;
  originalSelectionPosition: number;
  originalName: string;
  addedAt: number;
  mediaType: 'photo' | 'video';
  fileSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  status: QueueStatus;
  progress: number;
  errorMessage?: string;
  needsReselection?: boolean;
  durableName?: string;
  storageMode?: ActivityStorageMode;
  originalContentHash?: string;
  preparedContentHash?: string;
  duplicateWarning?: {
    sessionDate: string;
    sessionTime: string;
  };
  duplicateVerificationWarning?: boolean;
  thumbnailName?: string;
  thumbnailMimeType?: string;
  thumbnailStatus: 'generating' | 'ready' | 'unavailable';
  metadataSnapshot: {
    sessionId: string;
    category: ActivityRecordCategory;
    description: string;
    visibility: ActivityRecordVisibility;
    createdByName: string;
  };
  preparedPhotoForRetry?: {
    file: File;
    width: number;
    height: number;
    sha256: string;
    lastModified?: number;
  };
}

interface WakeLockHandle {
  released?: boolean;
  release: () => Promise<void>;
}

interface UploadSummary {
  saved: number;
  failed: number;
  pending: number;
  duplicates: number;
  failedNames: string[];
  totalConfirmed: number;
}

function createLocalMediaId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `midia-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokeQueuedMedia(items: QueuedActivityMedia[]): void {
  for (const item of items) {
    releaseActivityMediaRetention(item);
  }
}

function cleanupQueuedMedia(items: QueuedActivityMedia[]): void {
  revokeQueuedMedia(items);
  for (const item of items) {
    void cleanupActivityMediaAcquisition({
      attemptId: item.uploadAttemptId,
      durableName: item.durableName,
      thumbnailName: item.thumbnailName,
    });
  }
}

function logActivityMediaDiagnostic(
  item: Pick<QueuedActivityMedia, 'uploadAttemptId' | 'originalSelectionPosition' | 'mediaType' | 'fileSize' | 'previewUrl' | 'retentionUrl' | 'durableName' | 'storageMode'>,
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.info('[activity-media-local]', {
    attemptId: item.uploadAttemptId,
    position: item.originalSelectionPosition,
    mediaType: item.mediaType,
    size: item.fileSize,
    hasPreviewUrl: Boolean(item.previewUrl),
    hasTechnicalRetention: Boolean(item.retentionUrl || item.durableName),
    storageMode: item.storageMode || 'temporary-file',
    event,
    ...details,
  });
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function getMediaLabel(mediaType: 'photo' | 'video'): string {
  return mediaType === 'video' ? 'Vídeo' : 'Foto';
}

export default function ActivityRecordModal({ isOpen, onClose, patient, sessions, initialSession, currentUserName, onViewGallery }: ActivityRecordModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const multipleReplacementInputRef = useRef<HTMLInputElement>(null);
  const replacementMediaIdRef = useRef<string | null>(null);
  const queuedMediaRef = useRef<QueuedActivityMedia[]>([]);
  const pendingDuplicateSummaryRef = useRef(0);
  const nextSelectionPositionRef = useRef(0);
  const recoveredScopeRef = useRef('');
  const [sessionId, setSessionId] = useState(initialSession?.id || '');
  const [category, setCategory] = useState<ActivityRecordCategory>('Atividade pedagógica');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ActivityRecordVisibility>(() => patient.activityMediaAuthorization?.guardianSharingStatus === 'authorized' ? 'share_allowed' : 'internal_only');
  const [queuedMedia, setQueuedMedia] = useState<QueuedActivityMedia[]>([]);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [progress, setProgress] = useState(0);
  const [captureKey, setCaptureKey] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [uploadBytesSent, setUploadBytesSent] = useState(0);
  const [uploadBytesTotal, setUploadBytesTotal] = useState(0);
  const [uploadSpeedBytesPerSecond, setUploadSpeedBytesPerSecond] = useState(0);
  const [uploadEtaSeconds, setUploadEtaSeconds] = useState<number | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [confirmedMediaCount, setConfirmedMediaCount] = useState(0);
  const [ignoredDuplicateCount, setIgnoredDuplicateCount] = useState(0);
  const [sameSessionDuplicateCount, setSameSessionDuplicateCount] = useState(0);
  const [recoveredNeedsMetadataConfirmation, setRecoveredNeedsMetadataConfirmation] = useState(false);
  const saveLockRef = useRef(false);
  const cancelBatchRef = useRef(false);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const [viewingMedia, setViewingMedia] = useState<QueuedActivityMedia | null>(null);
  const [viewingMediaUrl, setViewingMediaUrl] = useState('');

  const authorization = patient.activityMediaAuthorization || getDefaultActivityAuthorization();
  const canRecord = authorization.internalRecordingStatus === 'authorized';
  const canShare = authorization.guardianSharingStatus === 'authorized';
  const availableSessions = useMemo(() => getPatientSessionsThroughDate({ patient, sessions })
    .filter(session => !session.isBlocked && ![SessionStatus.FALTA, SessionStatus.FALTA_PROF, SessionStatus.CANCELADA].includes(session.status))
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)), [patient.id, patient.startDate, sessions]);
  const allowedInitialSession = initialSession && availableSessions.some(item => item.id === initialSession.id)
    ? initialSession
    : null;
  const selectedSession = availableSessions.find(item => item.id === sessionId) || allowedInitialSession;
  const busy = stage !== 'idle';
  const batchOverview = useMemo(
    () => getActivityBatchOverview(confirmedMediaCount, queuedMedia),
    [confirmedMediaCount, queuedMedia],
  );
  const canAddNextBatch = canAddNextActivityBatch({
    confirmedCount: confirmedMediaCount,
    queuedItems: queuedMedia,
    busy,
  });
  const metadataLocked = confirmedMediaCount > 0
    || (queuedMedia.length > 0 && !recoveredNeedsMetadataConfirmation);
  const thumbnailOverview = useMemo(() => ({
    generating: queuedMedia.filter(item => item.thumbnailStatus === 'generating').length,
    unavailable: queuedMedia.filter(item => item.thumbnailStatus === 'unavailable').length,
  }), [queuedMedia]);
  const summaryTone = summary ? getActivityUploadSummaryTone(summary) : null;
  const summaryTitle = summary ? getActivityUploadSummaryTitle(summary) : '';
  const summaryStyle = summaryTone === 'success'
    ? {
        container: 'border-status-green-text/30 bg-status-green-bg',
        text: 'text-status-green-text',
      }
    : summaryTone === 'error'
      ? {
          container: 'border-status-red-text/35 bg-status-red-bg',
          text: 'text-status-red-text',
        }
      : {
          container: 'border-amber-300 bg-amber-50',
          text: 'text-amber-800',
        };

  const requestWakeLock = async () => {
    if (typeof navigator === 'undefined') return;
    const wakeLockNavigator = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockHandle> } };
    if (!wakeLockNavigator.wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await wakeLockNavigator.wakeLock.request('screen');
    } catch {
      // Alguns navegadores não oferecem Wake Lock; o envio continua normalmente.
    }
  };

  const releaseWakeLock = async () => {
    const currentWakeLock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!currentWakeLock || currentWakeLock.released) return;
    await currentWakeLock.release().catch(() => undefined);
  };

  useEffect(() => {
    if (allowedInitialSession) {
      setSessionId(allowedInitialSession.id);
      return;
    }

    setSessionId(current => availableSessions.some(item => item.id === current) ? current : '');
  }, [allowedInitialSession?.id, availableSessions]);

  useEffect(() => {
    queuedMediaRef.current = queuedMedia;
  }, [queuedMedia]);

  const closeMediaViewer = () => {
    if (viewingMediaUrl) URL.revokeObjectURL(viewingMediaUrl);
    setViewingMediaUrl('');
    setViewingMedia(null);
  };

  const openMediaViewer = (item: QueuedActivityMedia) => {
    if (viewingMediaUrl) URL.revokeObjectURL(viewingMediaUrl);
    setViewingMedia(item);
    setViewingMediaUrl(URL.createObjectURL(item.sourceFile));
  };

  useEffect(() => () => {
    revokeQueuedMedia(queuedMediaRef.current);
    void releaseWakeLock();
  }, []);

  useEffect(() => () => {
    if (viewingMediaUrl) URL.revokeObjectURL(viewingMediaUrl);
  }, [viewingMediaUrl]);

  useEffect(() => {
    if (!isOpen) {
      recoveredScopeRef.current = '';
      return;
    }
    if (!selectedSession || queuedMediaRef.current.length > 0) return;

    let cancelled = false;
    void (async () => {
      const scopeKey = await buildActivityMediaScopeKey({
        patientId: patient.id,
        sessionId: selectedSession.id,
      });
      if (cancelled || recoveredScopeRef.current === scopeKey) return;
      recoveredScopeRef.current = scopeKey;

      let manifests: Awaited<ReturnType<typeof listActivityMediaManifests>> = [];
      try {
        manifests = await listActivityMediaManifests(scopeKey);
      } catch {
        return;
      }
      if (cancelled || manifests.length === 0 || queuedMediaRef.current.length > 0) return;

      const recoveredItems: QueuedActivityMedia[] = [];
      let recoveredSameSessionDuplicates = 0;
      const orderedManifests = manifests
        .slice()
        .sort((left, right) => left.originalSelectionPosition - right.originalSelectionPosition);
      for (const manifest of orderedManifests) {
        try {
          const file = await readPersistedActivityFile({
            durableName: manifest.durableName,
            originalName: manifest.originalName,
            type: manifest.mimeType,
            lastModified: manifest.lastModified,
          });
          const recoveredContentHash = manifest.originalContentHash || manifest.preparedContentHash;
          const duplicateResult = recoveredContentHash
              ? await checkActivityMediaDuplicate({
                patientId: patient.id,
                sessionId: selectedSession.id,
                sha256: recoveredContentHash,
                fileSize: file.size,
                mediaType: manifest.mediaType,
                mimeType: manifest.mimeType,
              }).catch(() => ({
                duplicate: false,
                scope: 'none' as const,
                verification: 'inconclusive' as const,
                reason: 'verification-request-failed',
                existing: null,
              }))
            : null;
          if (duplicateResult?.scope === 'same-session') {
            recoveredSameSessionDuplicates += 1;
            pendingDuplicateSummaryRef.current += 1;
            await cleanupActivityMediaAcquisition({
              attemptId: manifest.attemptId,
              durableName: manifest.durableName,
              thumbnailName: manifest.thumbnailName,
            });
            continue;
          }
          let thumbnailName = manifest.thumbnailName || '';
          let thumbnailMimeType = manifest.thumbnailMimeType || 'image/jpeg';
          let thumbnailStatus: QueuedActivityMedia['thumbnailStatus'] = 'unavailable';
          let previewUrl = '';
          try {
            let thumbnailFile: File;
            if (thumbnailName) {
              thumbnailFile = await readPersistedActivityFile({
                durableName: thumbnailName,
                originalName: `${manifest.attemptId}-thumbnail.jpg`,
                type: thumbnailMimeType,
                lastModified: manifest.lastModified || Date.now(),
              });
            } else {
              const thumbnail = await createActivityMediaThumbnail(file, manifest.mediaType);
              const persistedThumbnail = await persistActivityBlob({
                blob: thumbnail.blob,
                attemptId: `${manifest.attemptId}-thumbnail`,
              });
              thumbnailName = persistedThumbnail.durableName;
              thumbnailMimeType = thumbnail.blob.type || 'image/jpeg';
              thumbnailFile = new File(
                [persistedThumbnail.persistedBlob],
                `${manifest.attemptId}-thumbnail.jpg`,
                { type: thumbnailMimeType },
              );
              await saveActivityMediaManifest({
                ...manifest,
                thumbnailName,
                thumbnailMimeType,
                thumbnailStatus: 'ready',
              });
            }
            previewUrl = URL.createObjectURL(thumbnailFile);
            thumbnailStatus = 'ready';
          } catch {
            thumbnailStatus = 'unavailable';
            await saveActivityMediaManifest({
              ...manifest,
              thumbnailName: '',
              thumbnailMimeType: '',
              thumbnailStatus,
            }).catch(() => undefined);
          }
          recoveredItems.push({
            id: createLocalMediaId(),
            uploadAttemptId: manifest.attemptId,
            sourceFile: file,
            previewUrl,
            retentionUrl: '',
            durableName: manifest.durableName,
            storageMode: manifest.storageMode || 'opfs',
            originalContentHash: manifest.originalContentHash,
            preparedContentHash: manifest.preparedContentHash,
            originalSelectionPosition: manifest.originalSelectionPosition,
            originalName: manifest.originalName,
            addedAt: Date.parse(manifest.acquiredAt) || Date.now(),
            mediaType: manifest.mediaType,
            fileSize: manifest.fileSize,
            width: manifest.width,
            height: manifest.height,
            durationSeconds: manifest.duration,
            thumbnailName: thumbnailName || undefined,
            thumbnailMimeType: thumbnailMimeType || undefined,
            thumbnailStatus,
            status: duplicateResult?.scope === 'other-session'
              ? 'duplicate'
              : duplicateResult?.verification === 'inconclusive'
                ? 'verification'
                : 'queued',
            progress: 0,
            duplicateVerificationWarning: duplicateResult?.verification === 'inconclusive',
            duplicateWarning: duplicateResult?.scope === 'other-session' && duplicateResult.existing ? {
              sessionDate: duplicateResult.existing.sessionDate,
              sessionTime: duplicateResult.existing.sessionTime,
            } : undefined,
            metadataSnapshot: {
              sessionId: selectedSession.id,
              category,
              description,
              visibility,
              createdByName: currentUserName,
            },
            preparedPhotoForRetry: manifest.mediaType === 'photo'
              && manifest.preparedContentHash
              && manifest.width
              && manifest.height
              ? {
                  file,
                  width: manifest.width,
                  height: manifest.height,
                  sha256: manifest.preparedContentHash,
                  lastModified: manifest.lastModified,
                }
              : undefined,
          });
        } catch {
          await cleanupActivityMediaAcquisition({
            attemptId: manifest.attemptId,
            durableName: manifest.durableName,
            thumbnailName: manifest.thumbnailName,
          });
        }
      }

      if (!cancelled && recoveredItems.length > 0) {
        nextSelectionPositionRef.current = Math.max(
          nextSelectionPositionRef.current,
          ...recoveredItems.map(item => item.originalSelectionPosition),
        );
        setQueuedMedia(recoveredItems);
        setRecoveredNeedsMetadataConfirmation(true);
        showToast(
          `${recoveredItems.length} ${recoveredItems.length === 1 ? 'mídia pendente foi recuperada' : 'mídias pendentes foram recuperadas'} com segurança.`,
          'success',
        );
      }
      if (!cancelled && recoveredSameSessionDuplicates > 0) {
        setIgnoredDuplicateCount(current => current + recoveredSameSessionDuplicates);
        setSameSessionDuplicateCount(current => current + recoveredSameSessionDuplicates);
        showToast(
          recoveredSameSessionDuplicates === 1
            ? 'Uma mídia recuperada já estava nesta sessão e não foi enviada novamente.'
            : `${recoveredSameSessionDuplicates} mídias recuperadas já estavam nesta sessão e não foram enviadas novamente.`,
          'info',
        );
        if (recoveredItems.length === 0) {
          setSummary({
            saved: 0,
            failed: 0,
            pending: 0,
            duplicates: recoveredSameSessionDuplicates,
            failedNames: [],
            totalConfirmed: confirmedMediaCount,
          });
          pendingDuplicateSummaryRef.current = 0;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, patient.id, selectedSession?.id]);

  useEffect(() => {
    if (!busy) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [busy]);

  const resetCaptureInputs = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (replacementInputRef.current) replacementInputRef.current.value = '';
    if (multipleReplacementInputRef.current) multipleReplacementInputRef.current.value = '';
    replacementMediaIdRef.current = null;
    setCaptureKey(value => value + 1);
  };

  const resetActivity = () => {
    closeMediaViewer();
    cleanupQueuedMedia(queuedMediaRef.current);
    queuedMediaRef.current = [];
    nextSelectionPositionRef.current = 0;
    setQueuedMedia([]);
    setConfirmedMediaCount(0);
    setIgnoredDuplicateCount(0);
    setSameSessionDuplicateCount(0);
    pendingDuplicateSummaryRef.current = 0;
    setRecoveredNeedsMetadataConfirmation(false);
    setDescription('');
    setCategory('Atividade pedagógica');
    setVisibility(patient.activityMediaAuthorization?.guardianSharingStatus === 'authorized' ? 'share_allowed' : 'internal_only');
    setProgress(0);
    setUploadTotal(0);
    setUploadIndex(0);
    setUploadBytesSent(0);
    setUploadBytesTotal(0);
    setUploadSpeedBytesPerSecond(0);
    setUploadEtaSeconds(null);
    setSummary(null);
    resetCaptureInputs();
  };

  const resetAndClose = async () => {
    if (busy) {
      cancelBatchRef.current = true;
      const cancelled = cancelActiveActivityUpload();
      if (cancelled) showToast('Cancelando o envio das mídias...', 'success');
      return;
    }
    if (queuedMediaRef.current.length > 0) {
      const closeImpact = getActivityCloseImpact(confirmedMediaCount, queuedMediaRef.current);
      const savedMessage = closeImpact.confirmedPreserved > 0
        ? `${closeImpact.confirmedPreserved} ${closeImpact.confirmedPreserved === 1 ? 'mídia já confirmada permanecerá salva' : 'mídias já confirmadas permanecerão salvas'}. `
        : '';
      const shouldDiscard = window.confirm(
        `${savedMessage}Os ${closeImpact.localItemsDiscarded} itens locais ainda não enviados serão descartados. Deseja fechar a atividade?`,
      );
      if (!shouldDiscard) return;
      await Promise.allSettled(
        queuedMediaRef.current.map(item => cancelActivityUpload(patient.id, item.uploadAttemptId)),
      );
    } else if (confirmedMediaCount > 0) {
      showToast(
        `${confirmedMediaCount} ${confirmedMediaCount === 1 ? 'mídia confirmada permanece salva' : 'mídias confirmadas permanecem salvas'}.`,
        'success',
      );
    }
    resetActivity();
    onClose();
  };

  const handleFiles = async (files?: FileList | File[] | null) => {
    const incomingFiles = Array.from(files || []).filter(Boolean);
    if (incomingFiles.length === 0) return;
    if (!selectedSession) {
      showToast('Selecione a sessão relacionada antes de adicionar as mídias.', 'error');
      resetCaptureInputs();
      return;
    }

    const selectionValidation = validateActivityBatchSelection({
      incomingCount: incomingFiles.length,
      confirmedCount: confirmedMediaCount,
      queuedItems: queuedMediaRef.current,
      busy,
    });
    if (!selectionValidation.allowed) {
      showToast(getActivitySelectionErrorMessage(selectionValidation), 'error');
      resetCaptureInputs();
      return;
    }

    const selectedFiles = getAcceptedActivityBatchFiles(incomingFiles, selectionValidation) as File[];
    let pinnedSelection: ReturnType<typeof pinActivityMediaSelection> = [];
    try {
      // Inicia a primeira leitura de todos os arquivos antes do primeiro await.
      // Isso é obrigatório em alguns Androids, que revogam o File ao sair do evento.
      pinnedSelection = pinActivityMediaSelection(selectedFiles);
    } catch (error) {
      showToast(getActivityRecordErrorMessage(error), 'error');
      resetCaptureInputs();
      return;
    }

    const storageStatus = await inspectDurableActivityStorage().catch(() => ({
      supported: false,
      quota: 0,
      usage: 0,
      available: 0,
      reason: 'opfs-unavailable',
      mode: 'memory-fallback',
    }));
    const requiredBytes = estimateActivityAcquisitionBytes(selectedFiles);
    const capacity = assertDurableActivityStorageCapacity({ requiredBytes, storageStatus });
    if (storageStatus.supported && !capacity.ok) {
      showToast(
        `Espaço local insuficiente para proteger esta seleção. Necessário: ${formatFileSize(requiredBytes)}; disponível: ${formatFileSize(capacity.availableBytes)}.`,
        'error',
      );
      await releasePinnedActivityMediaSelection(pinnedSelection);
      resetCaptureInputs();
      return;
    }
    if (!storageStatus.supported) {
      const hasVideo = selectedFiles.some(file => {
        try {
          return inspectActivityMediaSource(file).mediaType === 'video';
        } catch {
          return false;
        }
      });
      if (hasVideo) {
        showToast(
          'Este navegador não consegue proteger vídeos durante o envio. Atualize o navegador ou use a versão segura do sistema.',
          'error',
        );
        await releasePinnedActivityMediaSelection(pinnedSelection);
        resetCaptureInputs();
        return;
      }
      showToast(
        'Este navegador não consegue preservar a remessa após uma atualização da página. Mantenha esta tela aberta até concluir o envio das fotos.',
        'warning',
      );
    } else if (storageStatus.mode === 'indexeddb') {
      showToast(
        'Protegendo todos os arquivos no celular antes de preparar as mídias.',
        'info',
      );
    }

    const scopeKey = await buildActivityMediaScopeKey({
      patientId: patient.id,
      sessionId: selectedSession.id,
    });
    setSummary(null);
    setStage('preparing');

    const failedNames: string[] = [];
    let acquiredCount = 0;
    let duplicateCount = 0;
    const knownHashes = new Set(
      queuedMediaRef.current
        .map(item => item.originalContentHash || item.preparedContentHash)
        .filter((hash): hash is string => Boolean(hash)),
    );

    type SelectionEntry = {
      file: File;
      item: QueuedActivityMedia;
      rawFile: File;
      durableName: string;
      readyForProcessing: boolean;
      pinned: ReturnType<typeof pinActivityMediaSelection>[number];
    };

    const entries: SelectionEntry[] = [];

    try {
      for (const [fileIndex, file] of selectedFiles.entries()) {
        try {
          const sourceInfo = inspectActivityMediaSource(file);
          const retention = createActivityMediaRetention(file, false);
          const item: QueuedActivityMedia = {
            id: createLocalMediaId(),
            uploadAttemptId: createLocalMediaId(),
            sourceFile: file,
            previewUrl: '',
            retentionUrl: retention.retentionUrl,
            originalSelectionPosition: ++nextSelectionPositionRef.current,
            originalName: file.name || 'Mídia sem nome',
            addedAt: Date.now(),
            mediaType: sourceInfo.mediaType,
            fileSize: file.size,
            status: 'acquiring',
            thumbnailStatus: 'generating',
            progress: 0,
            storageMode: storageStatus.mode as ActivityStorageMode,
            metadataSnapshot: {
              sessionId: selectedSession.id,
              category,
              description,
              visibility,
              createdByName: currentUserName,
            },
          };
          entries.push({
            file,
            item,
            rawFile: file,
            durableName: '',
            readyForProcessing: !storageStatus.supported,
            pinned: pinnedSelection[fileIndex],
          });
          logActivityMediaDiagnostic(item, 'acquisition-start', {
            acquisitionIndex: entries.length,
            acquisitionTotal: selectedFiles.length,
            selectedAt: new Date(item.addedAt).toISOString(),
          });
        } catch (error) {
          await releasePinnedActivityMediaSelection([pinnedSelection[fileIndex]]);
          failedNames.push(file.name || 'Mídia sem nome');
          showToast(getActivityRecordErrorMessage(error), 'error');
        }
      }

      if (entries.length === 0) return;
      setQueuedMedia(current => [...current, ...entries.map(entry => entry.item)]);

      // Fase 1: protege toda a seleção antes de decodificar, verificar duplicidade
      // ou gerar miniaturas. No modo IndexedDB, todos os arquivos são enfileirados
      // na mesma transação imediatamente, evitando referências tardias do Android.
      if (storageStatus.supported) {
        const acquisitionResults = await persistActivitySelectionBlobs({
          items: entries.map(entry => ({
            blob: entry.file,
            attemptId: entry.item.uploadAttemptId,
            reader: entry.pinned.reader,
            firstRead: entry.pinned.firstRead,
          })),
          onProgress: ({ index, bytesProcessed, totalBytes }: {
            index: number;
            bytesProcessed: number;
            totalBytes: number;
          }) => {
            const entry = entries[index];
            if (!entry) return;
            const acquisitionProgress = totalBytes > 0
              ? Math.round((bytesProcessed / totalBytes) * 100)
              : 0;
            setQueuedMedia(current => current.map(item => item.id === entry.item.id
              ? { ...item, progress: acquisitionProgress }
              : item));
          },
        });

        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          const result = acquisitionResults[index];
          if (!result || result.status === 'rejected') {
            failedNames.push(entry.item.originalName);
            releaseActivityMediaRetention(entry.item);
            const error = result?.reason || new Error('Não foi possível proteger o arquivo no celular.');
            const errorMessage = getActivityRecordErrorMessage(error);
            logActivityMediaDiagnostic(entry.item, 'acquisition-failed', {
              errorClassification: classifyActivityMediaError(error),
              acquisitionPhase: 'source-copy',
            });
            setQueuedMedia(current => current.map(item => item.id === entry.item.id ? {
              ...item,
              status: 'failed',
              progress: 0,
              thumbnailStatus: 'unavailable',
              errorMessage,
              needsReselection: true,
            } : item));
            continue;
          }

          entry.durableName = result.value.durableName;
          try {
            entry.rawFile = await readPersistedActivityFile({
              durableName: entry.durableName,
              originalName: entry.file.name,
              type: entry.file.type,
              lastModified: entry.file.lastModified,
            });
            entry.readyForProcessing = true;
            releaseActivityMediaRetention(entry.item);
            entry.item = {
              ...entry.item,
              sourceFile: entry.rawFile,
              retentionUrl: '',
              durableName: entry.durableName,
              progress: 100,
              status: 'preparing',
            };
            setQueuedMedia(current => current.map(item => item.id === entry.item.id ? entry.item : item));
            await saveActivityMediaManifest(buildActivityMediaManifest({
              attemptId: entry.item.uploadAttemptId,
              scopeKey,
              durableName: entry.durableName,
              originalName: entry.item.originalName,
              originalSelectionPosition: entry.item.originalSelectionPosition,
              mediaType: entry.item.mediaType,
              mimeType: entry.rawFile.type,
              fileSize: entry.item.fileSize,
              originalContentHash: undefined,
              preparedContentHash: undefined,
              width: undefined,
              height: undefined,
              duration: undefined,
              lastModified: entry.rawFile.lastModified,
              storageMode: storageStatus.mode,
              thumbnailName: undefined,
              thumbnailMimeType: undefined,
              thumbnailStatus: 'unavailable',
            }));
            logActivityMediaDiagnostic(entry.item, 'source-protected', {
              acquisitionIndex: index + 1,
              acquisitionTotal: entries.length,
            });
          } catch (error) {
            failedNames.push(entry.item.originalName);
            releaseActivityMediaRetention(entry.item);
            await cleanupActivityMediaAcquisition({
              attemptId: entry.item.uploadAttemptId,
              durableName: entry.durableName,
            });
            const errorMessage = getActivityRecordErrorMessage(error);
            setQueuedMedia(current => current.map(item => item.id === entry.item.id ? {
              ...item,
              status: 'failed',
              progress: 0,
              thumbnailStatus: 'unavailable',
              errorMessage,
              needsReselection: true,
            } : item));
          }
        }
      }

      // Fase 2: somente depois que todos os arquivos possíveis estão protegidos,
      // processa uma mídia por vez para limitar memória, decodificadores e canvas.
      for (const entry of entries) {
        if (!entry.readyForProcessing) continue;

        const file = entry.rawFile;
        let queuedItem = entry.item;
        let preparedPreviewUrl = '';
        let thumbnailName = '';
        try {
          let durableFile: File;
          let originalContentHash = '';
          let preparedContentHash = '';
          let width: number | undefined;
          let height: number | undefined;
          let durationSeconds: number | undefined;
          let preparedPhotoForRetry: QueuedActivityMedia['preparedPhotoForRetry'];

          if (queuedItem.mediaType === 'photo') {
            logActivityMediaDiagnostic(queuedItem, 'real-read-start');
            logActivityMediaDiagnostic(queuedItem, 'hash-start');
            const prepared = storageStatus.supported
              ? await processActivityMedia(file)
              : await processAfterNonBlockingProbe({
                  probe: () => assertActivityMediaSourceReadable(file),
                  process: () => processActivityMedia(file),
                  onProbeResult: result => logActivityMediaDiagnostic(
                    queuedItem,
                    result.readable ? 'probe-confirmed' : 'probe-failed-real-read-will-run',
                  ),
                });
            preparedPreviewUrl = prepared.previewUrl;
            preparedContentHash = prepared.sha256;
            width = prepared.width;
            height = prepared.height;
            logActivityMediaDiagnostic(queuedItem, 'hash-confirmed', {
              hashAlgorithm: 'SHA-256',
              contentHashPrefix: prepared.sha256.slice(0, 12),
            });
            logActivityMediaDiagnostic(queuedItem, 'preparation-confirmed', {
              preparedSize: prepared.file.size,
            });

            if (storageStatus.supported) {
              const persisted = await persistActivityBlob({
                blob: prepared.file,
                attemptId: queuedItem.uploadAttemptId,
              });
              entry.durableName = persisted.durableName;
              durableFile = await readPersistedActivityFile({
                durableName: entry.durableName,
                originalName: prepared.file.name,
                type: prepared.file.type,
                lastModified: prepared.lastModified,
              });
            } else {
              durableFile = prepared.file;
            }
            preparedPhotoForRetry = {
              file: durableFile,
              width: prepared.width,
              height: prepared.height,
              sha256: prepared.sha256,
              lastModified: prepared.lastModified,
            };
          } else {
            logActivityMediaDiagnostic(queuedItem, 'real-read-start');
            logActivityMediaDiagnostic(queuedItem, 'hash-start');
            if (storageStatus.supported) {
              originalContentHash = await hashBlobIncrementally(file);
              const inspectedVideo = await processActivityMedia(file);
              preparedPreviewUrl = inspectedVideo.previewUrl;
              durableFile = file;
              width = inspectedVideo.width;
              height = inspectedVideo.height;
              durationSeconds = inspectedVideo.durationSeconds;
            } else {
              const inspectedVideo = await processAfterNonBlockingProbe({
                probe: () => assertActivityMediaSourceReadable(file),
                process: () => processActivityMedia(file),
                onProbeResult: result => logActivityMediaDiagnostic(
                  queuedItem,
                  result.readable ? 'probe-confirmed' : 'probe-failed-real-read-will-run',
                ),
              });
              preparedPreviewUrl = inspectedVideo.previewUrl;
              originalContentHash = inspectedVideo.sha256;
              durableFile = inspectedVideo.file;
              width = inspectedVideo.width;
              height = inspectedVideo.height;
              durationSeconds = inspectedVideo.durationSeconds;
            }
            logActivityMediaDiagnostic(queuedItem, 'hash-confirmed', {
              hashAlgorithm: 'SHA-256',
              contentHashPrefix: originalContentHash.slice(0, 12),
            });
          }

          const dedupeContentHash = originalContentHash || preparedContentHash;
          if (isExactActivityMediaDuplicate(knownHashes, dedupeContentHash)) {
            duplicateCount += 1;
            pendingDuplicateSummaryRef.current += 1;
            setIgnoredDuplicateCount(current => current + 1);
            if (preparedPreviewUrl) URL.revokeObjectURL(preparedPreviewUrl);
            await cleanupActivityMediaAcquisition({
              attemptId: queuedItem.uploadAttemptId,
              durableName: entry.durableName,
            });
            setQueuedMedia(current => current.filter(item => item.id !== queuedItem.id));
            logActivityMediaDiagnostic(queuedItem, 'duplicate-ignored', {
              duplicateScope: 'current-selection',
            });
            continue;
          }
          knownHashes.add(dedupeContentHash);

          const duplicateResult = await checkActivityMediaDuplicate({
            patientId: patient.id,
            sessionId: selectedSession.id,
            sha256: dedupeContentHash,
            fileSize: durableFile.size,
            mediaType: queuedItem.mediaType,
            mimeType: durableFile.type,
          }).catch(() => ({
            duplicate: false,
            scope: 'none' as const,
            verification: 'inconclusive' as const,
            reason: 'verification-request-failed',
            existing: null,
          }));
          if (duplicateResult?.scope === 'same-session') {
            duplicateCount += 1;
            pendingDuplicateSummaryRef.current += 1;
            setIgnoredDuplicateCount(current => current + 1);
            setSameSessionDuplicateCount(current => current + 1);
            if (preparedPreviewUrl) URL.revokeObjectURL(preparedPreviewUrl);
            await cleanupActivityMediaAcquisition({
              attemptId: queuedItem.uploadAttemptId,
              durableName: entry.durableName,
            });
            setQueuedMedia(current => current.filter(item => item.id !== queuedItem.id));
            logActivityMediaDiagnostic(queuedItem, 'duplicate-ignored', {
              duplicateScope: 'same-session',
            });
            continue;
          }

          if (preparedPreviewUrl) URL.revokeObjectURL(preparedPreviewUrl);
          let thumbnailMimeType = '';
          let thumbnailStatus: QueuedActivityMedia['thumbnailStatus'] = 'generating';
          let thumbnailUrl = '';
          setQueuedMedia(current => current.map(item => item.id === queuedItem.id
            ? {
                ...item,
                sourceFile: durableFile,
                durableName: entry.durableName || undefined,
                retentionUrl: '',
                previewUrl: '',
                thumbnailStatus: 'generating',
                status: 'preparing',
                progress: 0,
              }
            : item));
          try {
            logActivityMediaDiagnostic(queuedItem, 'thumbnail-start');
            const thumbnail = await createActivityMediaThumbnail(durableFile, queuedItem.mediaType);
            thumbnailMimeType = thumbnail.blob.type || 'image/jpeg';
            if (storageStatus.supported) {
              const persistedThumbnail = await persistActivityBlob({
                blob: thumbnail.blob,
                attemptId: `${queuedItem.uploadAttemptId}-thumbnail`,
              });
              thumbnailName = persistedThumbnail.durableName;
              thumbnailUrl = URL.createObjectURL(persistedThumbnail.persistedBlob);
            } else {
              thumbnailUrl = URL.createObjectURL(thumbnail.blob);
            }
            thumbnailStatus = 'ready';
            logActivityMediaDiagnostic(queuedItem, 'thumbnail-confirmed', {
              thumbnailSize: thumbnail.blob.size,
            });
          } catch {
            thumbnailStatus = 'unavailable';
            logActivityMediaDiagnostic(queuedItem, 'thumbnail-unavailable');
          }

          const acquiredItem: QueuedActivityMedia = {
            ...queuedItem,
            sourceFile: durableFile,
            previewUrl: thumbnailUrl,
            retentionUrl: '',
            durableName: entry.durableName || undefined,
            thumbnailName: thumbnailName || undefined,
            thumbnailMimeType: thumbnailMimeType || undefined,
            thumbnailStatus,
            storageMode: storageStatus.mode as ActivityStorageMode,
            originalContentHash: originalContentHash || undefined,
            preparedContentHash: preparedContentHash || undefined,
            width,
            height,
            durationSeconds,
            status: duplicateResult?.scope === 'other-session'
              ? 'duplicate'
              : duplicateResult?.verification === 'inconclusive'
                ? 'verification'
                : 'queued',
            progress: 0,
            duplicateVerificationWarning: duplicateResult?.verification === 'inconclusive',
            duplicateWarning: duplicateResult?.scope === 'other-session' && duplicateResult.existing ? {
              sessionDate: duplicateResult.existing.sessionDate,
              sessionTime: duplicateResult.existing.sessionTime,
            } : undefined,
            preparedPhotoForRetry,
          };

          if (storageStatus.supported) {
            await saveActivityMediaManifest(buildActivityMediaManifest({
              attemptId: acquiredItem.uploadAttemptId,
              scopeKey,
              durableName: entry.durableName,
              originalName: acquiredItem.originalName,
              originalSelectionPosition: acquiredItem.originalSelectionPosition,
              mediaType: acquiredItem.mediaType,
              mimeType: durableFile.type,
              fileSize: acquiredItem.fileSize,
              originalContentHash: originalContentHash || undefined,
              preparedContentHash,
              width,
              height,
              duration: durationSeconds,
              lastModified: durableFile.lastModified,
              storageMode: storageStatus.mode,
              thumbnailName: thumbnailName || undefined,
              thumbnailMimeType: thumbnailMimeType || undefined,
              thumbnailStatus,
            }));
          }

          acquiredCount += 1;
          entry.item = acquiredItem;
          setQueuedMedia(current => current.map(item => item.id === acquiredItem.id ? acquiredItem : item));
          logActivityMediaDiagnostic(acquiredItem, 'acquisition-confirmed', {
            durable: storageStatus.supported,
            contentHashPrefix: dedupeContentHash.slice(0, 12),
          });
        } catch (error) {
          failedNames.push(queuedItem.originalName);
          if (preparedPreviewUrl) URL.revokeObjectURL(preparedPreviewUrl);
          const errorMessage = getActivityRecordErrorMessage(error);
          const needsReselection = activityFileNeedsReselection(error) && !storageStatus.supported;
          logActivityMediaDiagnostic(queuedItem, 'acquisition-failed', {
            errorClassification: classifyActivityMediaError(error),
            acquisitionPhase: 'processing',
          });
          setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
            ...item,
            sourceFile: file,
            durableName: entry.durableName || undefined,
            status: 'failed',
            progress: 0,
            thumbnailStatus: 'unavailable',
            errorMessage,
            needsReselection,
          } : item));
        }
      }

      if (failedNames.length > 0) {
        const acquiredText = acquiredCount === 1 ? '1 mídia ficou pronta para envio' : `${acquiredCount} mídias ficaram prontas para envio`;
        const failedText = failedNames.length === 1 ? '1 arquivo precisa de atenção' : `${failedNames.length} arquivos precisam de atenção`;
        showToast(`${acquiredText}. ${failedText}.`, 'error');
      } else if (acquiredCount === 0 && duplicateCount > 0) {
        const duplicatesForSummary = pendingDuplicateSummaryRef.current;
        setSummary({
          saved: 0,
          failed: 0,
          pending: 0,
          duplicates: duplicatesForSummary,
          failedNames: [],
          totalConfirmed: confirmedMediaCount,
        });
        pendingDuplicateSummaryRef.current = 0;
        showToast(
          duplicateCount === 1
            ? 'Nenhuma nova mídia foi adicionada. O arquivo selecionado já está na galeria desta sessão.'
            : `Nenhuma nova mídia foi adicionada. Os ${duplicateCount} arquivos selecionados já estão na galeria desta sessão.`,
          'warning',
        );
      } else {
        showToast(
          `${acquiredCount} ${acquiredCount === 1 ? 'mídia ficou pronta' : 'mídias ficaram prontas'} para envio${duplicateCount > 0 ? `. ${duplicateCount} ${duplicateCount === 1 ? 'arquivo repetido foi ignorado' : 'arquivos repetidos foram ignorados'}` : ''}.`,
          duplicateCount > 0 ? 'warning' : 'success',
        );
      }
    } finally {
      await releasePinnedActivityMediaSelection(pinnedSelection);
      setStage('idle');
    }
  };

  const removeQueuedMedia = (mediaId: string) => {
    if (busy) return;
    setQueuedMedia(current => {
      const mediaToRemove = current.find(item => item.id === mediaId);
      if (mediaToRemove) {
        logActivityMediaDiagnostic(mediaToRemove, 'manual-removal');
        releaseActivityMediaRetention(mediaToRemove);
        void cleanupActivityMediaAcquisition({
          attemptId: mediaToRemove.uploadAttemptId,
          durableName: mediaToRemove.durableName,
          thumbnailName: mediaToRemove.thumbnailName,
        });
      }
      return current.filter(item => item.id !== mediaId);
    });
  };

  const allowDuplicateMedia = (mediaId: string) => {
    if (busy) return;
    setQueuedMedia(current => current.map(item => {
      if (item.id !== mediaId) return item;
      logActivityMediaDiagnostic(item, 'duplicate-approved', {
        duplicateScope: 'other-session',
      });
      return {
        ...item,
        status: 'queued',
        duplicateWarning: undefined,
        duplicateVerificationWarning: undefined,
      };
    }));
  };

  const allowUnverifiedMedia = (mediaId: string) => {
    if (busy) return;
    setQueuedMedia(current => current.map(item => {
      if (item.id !== mediaId) return item;
      logActivityMediaDiagnostic(item, 'legacy-duplicate-verification-overridden');
      return {
        ...item,
        status: 'queued',
        duplicateVerificationWarning: undefined,
      };
    }));
  };

  const ignoreDuplicateMedia = (mediaId: string) => {
    pendingDuplicateSummaryRef.current += 1;
    setIgnoredDuplicateCount(current => current + 1);
    removeQueuedMedia(mediaId);
  };

  const acquireReplacementFile = async (
    item: QueuedActivityMedia,
    replacement: File,
  ): Promise<QueuedActivityMedia> => {
    const sourceInfo = inspectActivityMediaSource(replacement);
    if (sourceInfo.mediaType !== item.mediaType) {
      throw new Error(`Selecione novamente um arquivo do tipo ${getMediaLabel(item.mediaType).toLowerCase()}.`);
    }
    if (replacement.name !== item.originalName || replacement.size !== item.fileSize) {
      throw new Error(`Selecione o mesmo arquivo "${item.originalName}" (${formatFileSize(item.fileSize)}).`);
    }

    const storageStatus = await inspectDurableActivityStorage();
    const capacity = assertDurableActivityStorageCapacity({
      requiredBytes: estimateActivityAcquisitionBytes([replacement]),
      storageStatus,
    });
    if (!storageStatus.supported && sourceInfo.mediaType === 'video') {
      throw new Error('Este navegador não consegue manter o vídeo disponível com segurança. Atualize o navegador ou use a versão segura do sistema.');
    }
    if (storageStatus.supported && !capacity.ok) {
      throw new Error('Não há espaço suficiente no celular para preparar este arquivo novamente.');
    }

    setQueuedMedia(current => current.map(currentItem => currentItem.id === item.id ? {
      ...currentItem,
      sourceFile: replacement,
      status: 'acquiring',
      progress: 0,
      errorMessage: undefined,
      needsReselection: false,
    } : currentItem));

    let preparedPreviewUrl = '';
    let durableName = '';
    let durableFile: File;
    let originalContentHash = '';
    let preparedContentHash = '';
    let width: number | undefined;
    let height: number | undefined;
    let durationSeconds: number | undefined;
    let preparedPhotoForRetry: QueuedActivityMedia['preparedPhotoForRetry'];

    if (sourceInfo.mediaType === 'photo') {
      const prepared = await processAfterNonBlockingProbe({
        probe: () => assertActivityMediaSourceReadable(replacement),
        process: () => processActivityMedia(replacement),
        onProbeResult: result => logActivityMediaDiagnostic(
          item,
          result.readable ? 'replacement-probe-confirmed' : 'replacement-probe-failed-real-read-will-run',
        ),
      });
      preparedPreviewUrl = prepared.previewUrl;
      preparedContentHash = prepared.sha256;
      width = prepared.width;
      height = prepared.height;
      if (storageStatus.supported) {
        const persisted = await persistActivityBlob({
          blob: prepared.file,
          attemptId: item.uploadAttemptId,
        });
        durableName = persisted.durableName;
        durableFile = await readPersistedActivityFile({
          durableName,
          originalName: prepared.file.name,
          type: prepared.file.type,
          lastModified: prepared.lastModified,
        });
      } else {
        durableFile = prepared.file;
      }
      preparedPhotoForRetry = {
        file: durableFile,
        width: prepared.width,
        height: prepared.height,
        sha256: prepared.sha256,
        lastModified: prepared.lastModified,
      };
    } else if (storageStatus.supported) {
      const persisted = await persistActivityBlob({
        blob: replacement,
        attemptId: item.uploadAttemptId,
        calculateHash: true,
      });
      durableName = persisted.durableName;
      originalContentHash = persisted.sha256;
      durableFile = await readPersistedActivityFile({
        durableName,
        originalName: replacement.name,
        type: replacement.type,
        lastModified: replacement.lastModified,
      });
      const inspectedVideo = await processActivityMedia(durableFile);
      preparedPreviewUrl = inspectedVideo.previewUrl;
      width = inspectedVideo.width;
      height = inspectedVideo.height;
      durationSeconds = inspectedVideo.durationSeconds;
    } else {
      const inspectedVideo = await processActivityMedia(replacement);
      preparedPreviewUrl = inspectedVideo.previewUrl;
      durableFile = inspectedVideo.file;
      originalContentHash = inspectedVideo.sha256;
      width = inspectedVideo.width;
      height = inspectedVideo.height;
      durationSeconds = inspectedVideo.durationSeconds;
    }

    releaseActivityMediaRetention(item);
    if (preparedPreviewUrl) URL.revokeObjectURL(preparedPreviewUrl);
    let thumbnailName = '';
    let thumbnailMimeType = '';
    let thumbnailStatus: QueuedActivityMedia['thumbnailStatus'] = 'generating';
    let thumbnailUrl = '';
    try {
      const thumbnail = await createActivityMediaThumbnail(durableFile, item.mediaType);
      thumbnailMimeType = thumbnail.blob.type || 'image/jpeg';
      if (storageStatus.supported) {
        const persistedThumbnail = await persistActivityBlob({
          blob: thumbnail.blob,
          attemptId: `${item.uploadAttemptId}-thumbnail`,
        });
        thumbnailName = persistedThumbnail.durableName;
        thumbnailUrl = URL.createObjectURL(persistedThumbnail.persistedBlob);
      } else {
        thumbnailUrl = URL.createObjectURL(thumbnail.blob);
      }
      thumbnailStatus = 'ready';
    } catch {
      thumbnailStatus = 'unavailable';
    }
    const replacedItem: QueuedActivityMedia = {
      ...item,
      sourceFile: durableFile,
      previewUrl: thumbnailUrl,
      retentionUrl: '',
      durableName: durableName || undefined,
      thumbnailName: thumbnailName || undefined,
      thumbnailMimeType: thumbnailMimeType || undefined,
      thumbnailStatus,
      storageMode: storageStatus.mode as ActivityStorageMode,
      originalContentHash: originalContentHash || undefined,
      preparedContentHash: preparedContentHash || undefined,
      width,
      height,
      durationSeconds,
      status: 'queued',
      progress: 0,
      errorMessage: undefined,
      needsReselection: false,
      duplicateWarning: undefined,
      preparedPhotoForRetry,
    };

    if (storageStatus.supported && selectedSession) {
      const scopeKey = await buildActivityMediaScopeKey({
        patientId: patient.id,
        sessionId: selectedSession.id,
      });
      await saveActivityMediaManifest(buildActivityMediaManifest({
        attemptId: replacedItem.uploadAttemptId,
        scopeKey,
        durableName,
        originalName: replacedItem.originalName,
        originalSelectionPosition: replacedItem.originalSelectionPosition,
        mediaType: replacedItem.mediaType,
        mimeType: durableFile.type,
        fileSize: replacedItem.fileSize,
        originalContentHash: originalContentHash || undefined,
        preparedContentHash,
        width,
        height,
        duration: durationSeconds,
        lastModified: durableFile.lastModified,
        storageMode: storageStatus.mode,
        thumbnailName: thumbnailName || undefined,
        thumbnailMimeType: thumbnailMimeType || undefined,
        thumbnailStatus,
      }));
    }
    logActivityMediaDiagnostic(replacedItem, 'replacement-acquired');
    return replacedItem;
  };

  const handleReplacementFile = async (files?: FileList | null) => {
    const replacement = files?.[0];
    const mediaId = replacementMediaIdRef.current;
    replacementMediaIdRef.current = null;
    if (replacementInputRef.current) replacementInputRef.current.value = '';
    if (!replacement || !mediaId) return;

    const currentItem = queuedMediaRef.current.find(item => item.id === mediaId);
    if (!currentItem) return;

    setStage('preparing');
    try {
      const replacedItem = await acquireReplacementFile(currentItem, replacement);
      setQueuedMedia(current => current.map(item => item.id === mediaId ? replacedItem : item));
      showToast(`Arquivo "${currentItem.originalName}" selecionado novamente.`, 'success');
    } catch (error) {
      setQueuedMedia(current => current.map(item => item.id === mediaId ? {
        ...item,
        status: 'failed',
        progress: 0,
        errorMessage: getActivityRecordErrorMessage(error),
        needsReselection: true,
      } : item));
      showToast(getActivityRecordErrorMessage(error), 'error');
    } finally {
      setStage('idle');
    }
  };

  const requestMediaReplacement = (mediaId: string) => {
    replacementMediaIdRef.current = mediaId;
    replacementInputRef.current?.click();
  };

  const handleMultipleReplacementFiles = async (files?: FileList | null) => {
    const replacements = Array.from(files || []);
    if (multipleReplacementInputRef.current) multipleReplacementInputRef.current.value = '';
    if (replacements.length === 0) return;

    const result = matchActivityMediaReplacements(queuedMediaRef.current, replacements);
    if (result.matches.length === 0) {
      showToast('Nenhum arquivo selecionado corresponde aos itens que precisam ser escolhidos novamente.', 'warning');
      return;
    }

    setStage('preparing');
    let replacedCount = 0;
    try {
      for (const match of result.matches) {
        try {
          const replacedItem = await acquireReplacementFile(match.item, match.file);
          setQueuedMedia(current => current.map(item => item.id === replacedItem.id ? replacedItem : item));
          replacedCount += 1;
        } catch (error) {
          setQueuedMedia(current => current.map(item => item.id === match.item.id ? {
            ...item,
            status: 'failed',
            errorMessage: getActivityRecordErrorMessage(error),
            needsReselection: true,
          } : item));
        }
      }
    } finally {
      setStage('idle');
    }

    const unmatchedCount = result.unmatchedFiles.length;
    showToast(
      `${replacedCount} ${replacedCount === 1 ? 'arquivo foi preparado novamente' : 'arquivos foram preparados novamente'}${unmatchedCount > 0 ? `; ${unmatchedCount} não corresponderam aos itens aguardados` : ''}.`,
      unmatchedCount > 0 ? 'warning' : 'success',
    );
  };

  const handleSave = async (mode: UploadMode = 'all') => {
    if (saveLockRef.current || busy) return;
    if (!canRecord) return showToast('Autorize o registro interno no cadastro antes de salvar mídias.', 'error');
    if (!selectedSession) return showToast('Selecione a sessão relacionada.', 'error');
    if (recoveredNeedsMetadataConfirmation) return showToast('Revise e confirme os dados da atividade recuperada antes do envio.', 'warning');
    if (queuedMedia.length === 0) return showToast('Adicione uma ou mais mídias antes de salvar a remessa.', 'error');

    saveLockRef.current = true;
    cancelBatchRef.current = false;
    const mediaToUpload = selectActivityUploadItems(queuedMedia, mode) as QueuedActivityMedia[];
    const total = mediaToUpload.length;
    if (total === 0) {
      saveLockRef.current = false;
      showToast(mode === 'failed' ? 'Não há mídias com falha disponíveis para tentar novamente.' : 'Não há mídias pendentes para enviar.', 'error');
      return;
    }

    type ReadyUpload = {
      id: string;
      queuedItem: QueuedActivityMedia;
      input: UploadActivityPhotoInput;
      mediaType: 'photo' | 'video';
      prepared: PreparedDirectActivityUpload;
    };

    const failedNames: string[] = [];
    let savedCount = 0;
    const duplicatesBeforeUpload = pendingDuplicateSummaryRef.current;
    pendingDuplicateSummaryRef.current = 0;
    let duplicateCount = duplicatesBeforeUpload;
    let duplicatesDetectedDuringUpload = 0;
    let terminalCount = 0;
    const confirmedCountAtStart = confirmedMediaCount;
    const readyInputs: Array<{
      id: string;
      queuedItem: QueuedActivityMedia;
      input: UploadActivityPhotoInput;
    }> = [];
    const progressById = new Map<string, number>();
    let uploadStartedAt = Date.now();

    const markTerminal = () => {
      terminalCount += 1;
      setUploadIndex(terminalCount);
    };

    const cleanupConfirmedItem = async (queuedItem: QueuedActivityMedia) => {
      releaseActivityMediaRetention(queuedItem);
      logActivityMediaDiagnostic(queuedItem, 'cleanup-start');
      await cleanupActivityMediaAcquisition({
        attemptId: queuedItem.uploadAttemptId,
        durableName: queuedItem.durableName,
        thumbnailName: queuedItem.thumbnailName,
      });
      logActivityMediaDiagnostic(queuedItem, 'cleanup-confirmed');
      setQueuedMedia(current => current.filter(item => item.id !== queuedItem.id));
    };

    const markDuplicate = async (queuedItem: QueuedActivityMedia) => {
      duplicateCount += 1;
      duplicatesDetectedDuringUpload += 1;
      setIgnoredDuplicateCount(current => current + 1);
      setSameSessionDuplicateCount(current => current + 1);
      logActivityMediaDiagnostic(queuedItem, 'duplicate-ignored', {
        duplicateScope: 'same-session',
        duplicateSource: 'upload-reservation',
      });
      await cleanupConfirmedItem(queuedItem);
      markTerminal();
    };

    const markFailure = (queuedItem: QueuedActivityMedia, error: unknown, preparedPhotoForRetry?: QueuedActivityMedia['preparedPhotoForRetry']) => {
      const errorMessage = getActivityRecordErrorMessage(error);
      const errorClassification = classifyActivityMediaError(error);
      logActivityMediaDiagnostic(queuedItem, 'failed', { errorClassification });
      failedNames.push(queuedItem.originalName);
      setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
        ...item,
        status: 'failed',
        progress: 0,
        errorMessage,
        needsReselection: activityFileNeedsReselection(error),
        preparedPhotoForRetry: preparedPhotoForRetry || item.preparedPhotoForRetry,
      } : item));
      markTerminal();
    };

    const updateOverallProgress = (ready: Array<{ id: string; input: UploadActivityPhotoInput }>) => {
      const progressState = calculateActivityUploadProgress(
        ready.map(item => ({ id: item.id, file: item.input.file })),
        progressById,
      );
      const telemetry = calculateActivityUploadTelemetry({
        bytesSent: progressState.bytesSent,
        totalBytes: progressState.totalBytes,
        startedAt: uploadStartedAt,
      });
      setProgress(Math.min(99, progressState.percent));
      setUploadBytesSent(progressState.bytesSent);
      setUploadBytesTotal(progressState.totalBytes);
      setUploadSpeedBytesPerSecond(telemetry.bytesPerSecond);
      setUploadEtaSeconds(telemetry.etaSeconds);
    };

    setSummary(null);
    setStage('preparing');
    setProgress(0);
    setUploadTotal(total);
    setUploadIndex(0);
    setUploadBytesSent(0);
    setUploadBytesTotal(0);
    setUploadSpeedBytesPerSecond(0);
    setUploadEtaSeconds(null);
    await requestWakeLock();

    try {
      // A aquisição já protegeu e preparou as mídias. Nesta etapa, apenas reutilizamos
      // os arquivos duráveis; só processamos novamente um item recuperado sem metadados.
      for (const queuedItem of mediaToUpload) {
        if (cancelBatchRef.current) break;
        setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
          ...item,
          status: 'preparing',
          progress: 0,
          errorMessage: undefined,
          needsReselection: false,
        } : item));

        try {
          let file = queuedItem.sourceFile;
          let width = queuedItem.width;
          let height = queuedItem.height;
          let durationSeconds = queuedItem.durationSeconds;
          let originalContentHash = queuedItem.originalContentHash || '';
          let preparedContentHash = queuedItem.preparedContentHash || '';
          let preparedPhotoForRetry = queuedItem.preparedPhotoForRetry;

          if (queuedItem.mediaType === 'photo' && preparedPhotoForRetry) {
            file = preparedPhotoForRetry.file;
            width = preparedPhotoForRetry.width;
            height = preparedPhotoForRetry.height;
            preparedContentHash = preparedContentHash || preparedPhotoForRetry.sha256;
            logActivityMediaDiagnostic(queuedItem, 'prepared-photo-reused');
          } else if (
            !width
            || !height
            || (queuedItem.mediaType === 'video' && (!durationSeconds || !originalContentHash))
            || (queuedItem.mediaType === 'photo' && !preparedContentHash)
          ) {
            logActivityMediaDiagnostic(queuedItem, 'real-read-start');
            if (queuedItem.mediaType === 'video' && !originalContentHash) {
              originalContentHash = await hashBlobIncrementally(queuedItem.sourceFile);
            }
            const preparedMedia = await processAfterNonBlockingProbe({
              probe: () => assertActivityMediaSourceReadable(queuedItem.sourceFile),
              process: () => processActivityMedia(queuedItem.sourceFile),
              onProbeResult: result => logActivityMediaDiagnostic(
                queuedItem,
                result.readable ? 'probe-confirmed' : 'probe-failed-real-read-will-run',
              ),
            });
            file = preparedMedia.file;
            width = preparedMedia.width;
            height = preparedMedia.height;
            durationSeconds = preparedMedia.durationSeconds;
            if (preparedMedia.mediaType === 'photo') {
              preparedContentHash = preparedMedia.sha256;
              preparedPhotoForRetry = createPreparedPhotoRetry(preparedMedia);
            } else {
              originalContentHash = originalContentHash || preparedMedia.sha256;
            }
            if (preparedMedia.previewUrl) URL.revokeObjectURL(preparedMedia.previewUrl);
          }

          if (!width || !height) throw new Error('Não foi possível confirmar as dimensões da mídia.');
          const sha256 = originalContentHash || preparedContentHash;
          if (!sha256) throw new Error('Não foi possível confirmar a identificação da mídia.');

          const input: UploadActivityPhotoInput = {
            patient,
            session: selectedSession,
            file,
            width,
            height,
            sha256,
            originalContentHash: originalContentHash || undefined,
            preparedContentHash: preparedContentHash || undefined,
            originalByteSize: queuedItem.fileSize,
            mediaType: queuedItem.mediaType,
            durationSeconds: queuedItem.mediaType === 'video' ? durationSeconds : undefined,
            lastModified: file.lastModified || queuedItem.sourceFile.lastModified || Date.now(),
            category: queuedItem.metadataSnapshot.category,
            description: queuedItem.metadataSnapshot.description,
            visibility: queuedItem.metadataSnapshot.visibility,
            createdByName: queuedItem.metadataSnapshot.createdByName,
            uploadAttemptId: queuedItem.uploadAttemptId,
          };

          if (preparedPhotoForRetry) {
            setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
              ...item,
              preparedPhotoForRetry,
              width,
              height,
            } : item));
          }
          readyInputs.push({ id: queuedItem.id, queuedItem, input });
        } catch (error) {
          markFailure(queuedItem, error);
        }
      }

      if (readyInputs.length > 0 && !cancelBatchRef.current) {
        setStage('uploading');
        setUploadBytesTotal(readyInputs.reduce((sum, item) => sum + item.input.file.size, 0));
        const preparedByAttempt = await prepareActivityUploadBatch(readyInputs.map(item => item.input));
        const readyUploads: ReadyUpload[] = [];

        for (const ready of readyInputs) {
          const prepared = preparedByAttempt.get(ready.queuedItem.uploadAttemptId);
          if (!prepared) {
            markFailure(ready.queuedItem, new Error('O servidor não preparou esta mídia para o envio rápido.'));
            continue;
          }
          if (prepared.error) {
            const error = Object.assign(
              new Error(prepared.error.message || 'Não foi possível preparar a mídia.'),
              { code: prepared.error.code },
            );
            if (isSameSessionDuplicateError(error)) await markDuplicate(ready.queuedItem);
            else markFailure(ready.queuedItem, error, ready.queuedItem.preparedPhotoForRetry);
            continue;
          }
          if (prepared.completed) {
            savedCount += 1;
            setConfirmedMediaCount(current => Math.min(MAX_ACTIVITY_TOTAL_MEDIA, current + 1));
            progressById.set(ready.id, 100);
            await cleanupConfirmedItem(ready.queuedItem);
            markTerminal();
            continue;
          }
          readyUploads.push({
            ...ready,
            mediaType: ready.queuedItem.mediaType,
            prepared,
          });
        }

        uploadStartedAt = Date.now();
        updateOverallProgress(readyUploads);

        await runActivityUploadPools(readyUploads, async (entry: ReadyUpload) => {
          if (cancelBatchRef.current) return;
          const { queuedItem, input, prepared } = entry;
          setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
            ...item,
            status: 'uploading',
            progress: Number(prepared.nextOffset || 0) > 0
              ? Math.round((Number(prepared.nextOffset) / input.file.size) * 100)
              : 0,
          } : item));
          logActivityMediaDiagnostic(queuedItem, 'direct-upload-start', {
            resumedAt: Number(prepared.nextOffset || 0),
            uploadMode: 'drive-direct-binary',
          });

          try {
            await uploadPreparedActivityMediaDirect({
              ...input,
              onProgress: value => {
                progressById.set(entry.id, value);
                setQueuedMedia(current => current.map(item => item.id === queuedItem.id ? {
                  ...item,
                  progress: value,
                } : item));
                updateOverallProgress(readyUploads);
              },
            }, prepared);
            progressById.set(entry.id, 100);
            savedCount += 1;
            setConfirmedMediaCount(current => Math.min(MAX_ACTIVITY_TOTAL_MEDIA, current + 1));
            logActivityMediaDiagnostic(queuedItem, 'upload-confirmed', {
              uploadMode: 'drive-direct-binary',
            });
            await cleanupConfirmedItem(queuedItem);
            markTerminal();
            updateOverallProgress(readyUploads);
          } catch (error) {
            if (isSameSessionDuplicateError(error)) {
              await markDuplicate(queuedItem);
              return;
            }
            if (cancelBatchRef.current || (error as { code?: string } | null)?.code === 'activity-records/upload-cancelled') {
              return;
            }
            markFailure(queuedItem, error, queuedItem.preparedPhotoForRetry);
          }
        });
      }

      setStage('finalizing');
      setProgress(100);
      const remainingCount = mediaToUpload.length - savedCount - duplicatesDetectedDuringUpload - failedNames.length;
      const wasCancelled = cancelBatchRef.current && remainingCount > 0;
      const totalConfirmed = Math.min(MAX_ACTIVITY_TOTAL_MEDIA, confirmedCountAtStart + savedCount);
      setSummary({
        saved: savedCount,
        failed: failedNames.length,
        pending: wasCancelled ? remainingCount : 0,
        duplicates: duplicateCount,
        failedNames,
        totalConfirmed,
      });

      if (wasCancelled) {
        showToast(
          `Envio interrompido. ${savedCount} ${savedCount === 1 ? 'mídia foi salva' : 'mídias foram salvas'}; os arquivos restantes continuam seguros nesta remessa.`,
          'warning',
        );
      } else if (failedNames.length === 0 && duplicateCount > 0) {
        showToast(formatActivityUploadSummary({
          saved: savedCount,
          failed: 0,
          pending: 0,
          duplicates: duplicateCount,
          totalConfirmed,
        }), 'warning');
      } else if (savedCount > 0 && failedNames.length === 0) {
        showToast(
          totalConfirmed >= MAX_ACTIVITY_TOTAL_MEDIA
            ? `Envio concluído. O limite de ${MAX_ACTIVITY_TOTAL_MEDIA} mídias foi atingido.`
            : `Envio concluído: ${savedCount} ${savedCount === 1 ? 'mídia foi salva' : 'mídias foram salvas'}. Você pode adicionar mais mídias ou finalizar a atividade.`,
          'success',
        );
      } else if (savedCount > 0) {
        showToast(
          `Envio parcial: ${savedCount} ${savedCount === 1 ? 'mídia foi salva' : 'mídias foram salvas'} e ${failedNames.length} ${failedNames.length === 1 ? 'não foi enviada' : 'não foram enviadas'}. Confira os avisos da remessa.`,
          'warning',
        );
      } else if (!wasCancelled) {
        showToast('Nenhuma mídia foi salva. Os arquivos permanecem disponíveis; confira os avisos e tente novamente.', 'warning');
      }
    } finally {
      setStage('idle');
      setProgress(0);
      setUploadTotal(0);
      setUploadIndex(0);
      setUploadBytesSent(0);
      setUploadBytesTotal(0);
      setUploadSpeedBytesPerSecond(0);
      setUploadEtaSeconds(null);
      saveLockRef.current = false;
      cancelBatchRef.current = false;
      await releaseWakeLock();
      if (failedNames.length === 0 && savedCount + duplicateCount === total) resetCaptureInputs();
    }
  };

  const confirmRecoveredMetadata = () => {
    if (!selectedSession) {
      showToast('Selecione a sessão relacionada antes de confirmar os dados da atividade.', 'error');
      return;
    }
    setQueuedMedia(current => current.map(item => ({
      ...item,
      metadataSnapshot: {
        sessionId: selectedSession.id,
        category,
        description,
        visibility,
        createdByName: currentUserName,
      },
    })));
    setRecoveredNeedsMetadataConfirmation(false);
    showToast('Os dados da atividade foram confirmados para todas as mídias recuperadas.', 'success');
  };

  const handleAddMoreMedia = () => {
    if (!canAddNextBatch) {
      showToast(
        batchOverview.remaining === 0
          ? `Limite de ${MAX_ACTIVITY_TOTAL_MEDIA} mídias atingido.`
          : 'Conclua ou remova os arquivos atuais antes de adicionar mais mídias.',
        'error',
      );
      return;
    }
    setSummary(null);
    setProgress(0);
    setUploadTotal(0);
    setUploadIndex(0);
    galleryInputRef.current?.click();
  };

  const handleFinalizeActivity = () => {
    if (queuedMediaRef.current.length > 0 || busy) {
      showToast('Conclua ou remova os arquivos pendentes antes de finalizar a atividade.', 'error');
      return;
    }
    showToast(
      `${confirmedMediaCount} ${confirmedMediaCount === 1 ? 'mídia salva nesta atividade' : 'mídias salvas nesta atividade'}.`,
      'success',
    );
    resetActivity();
    onClose();
    onViewGallery?.();
  };

  const uploadTransferLabel = uploadBytesTotal > 0
    ? `${formatFileSize(uploadBytesSent)} de ${formatFileSize(uploadBytesTotal)}`
    : '';
  const uploadSpeedLabel = uploadSpeedBytesPerSecond > 0
    ? `${formatFileSize(uploadSpeedBytesPerSecond)}/s`
    : '';
  const uploadEtaLabel = formatActivityUploadEta(uploadEtaSeconds);
  const stageLabel = stage === 'preparing'
    ? 'Protegendo e preparando mídias...'
    : stage === 'uploading'
      ? [
          `Envio rápido: ${uploadIndex} de ${uploadTotal || queuedMedia.length} concluídas • ${progress}%`,
          uploadTransferLabel,
          uploadSpeedLabel,
          uploadEtaLabel ? `aprox. ${uploadEtaLabel} restantes` : '',
        ].filter(Boolean).join(' • ')
      : stage === 'finalizing'
        ? 'Finalizando a remessa de mídias...'
        : '';

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title="Registrar atividade" width="max-w-3xl">
      <div className="space-y-5">
        <div className="rounded-xl border border-clinic-border bg-clinic-bg/60 p-3">
          <p className="font-bold text-clinic-text">{patient.name}</p>
          <p className="text-xs text-clinic-text-muted">Selecione até 50 mídias. Cada arquivo é preparado antes do envio, e as mídias já confirmadas não serão enviadas novamente.</p>
        </div>

        {!canRecord && (
          <div className="rounded-xl border border-status-orange-text/30 bg-status-orange-bg p-3 text-sm font-bold text-status-orange-text">
            Registro interno não autorizado. Atualize a autorização em Dados Cadastrais.
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Sessão relacionada</label>
          <select value={sessionId} onChange={event => setSessionId(event.target.value)} disabled={busy || metadataLocked || !!allowedInitialSession} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary disabled:opacity-70">
            <option value="">Selecione a sessão...</option>
            {availableSessions.map(session => (
              <option key={session.id} value={session.id}>{safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time} • {session.status} {session.packageNumber ? `• Sessão ${session.packageNumber}` : ''}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button type="button" disabled={!canAddNextBatch || !canRecord} onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Camera size={18} /> Tirar foto
          </button>
          <button type="button" disabled={!canAddNextBatch || !canRecord} onClick={() => videoInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Film size={18} /> Gravar vídeo
          </button>
          <button type="button" disabled={!canAddNextBatch || !canRecord} onClick={() => galleryInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-primary disabled:opacity-50">
            <ImagePlus size={18} /> Selecionar mídias
          </button>
          <input key={`camera-${captureKey}`} ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={event => void handleFiles(event.target.files)} />
          <input key={`video-${captureKey}`} ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" className="hidden" onChange={event => void handleFiles(event.target.files)} />
          <input key={`gallery-${captureKey}`} ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple className="hidden" onChange={event => void handleFiles(event.target.files)} />
          <input ref={replacementInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" className="hidden" onChange={event => void handleReplacementFile(event.target.files)} />
          <input ref={multipleReplacementInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple className="hidden" onChange={event => void handleMultipleReplacementFiles(event.target.files)} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-clinic-border bg-white p-3"><p className="text-[10px] font-black uppercase text-clinic-text-faint">Já salvas</p><p className="text-xl font-black text-status-green-text">{batchOverview.confirmed}</p></div>
          <div className="rounded-xl border border-clinic-border bg-white p-3"><p className="text-[10px] font-black uppercase text-clinic-text-faint">Na remessa</p><p className="text-xl font-black text-clinic-primary">{batchOverview.currentBatch}</p></div>
          <div className="rounded-xl border border-clinic-border bg-white p-3"><p className="text-[10px] font-black uppercase text-clinic-text-faint">Espaço restante</p><p className="text-xl font-black text-clinic-text">{batchOverview.remaining}</p></div>
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="text-[10px] font-black uppercase text-amber-800">Repetidas ignoradas</p><p className="text-xl font-black text-amber-800">{ignoredDuplicateCount}</p></div>
        </div>

        {ignoredDuplicateCount > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900" role="status" aria-live="polite">
            <p className="font-black">Mídias repetidas protegidas</p>
            <p className="mt-1">
              {ignoredDuplicateCount === 1
                ? '1 mídia repetida não foi enviada novamente e não ocupou uma nova vaga.'
                : `${ignoredDuplicateCount} mídias repetidas não foram enviadas novamente e não ocuparam novas vagas.`}
            </p>
            {sameSessionDuplicateCount > 0 && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {sameSessionDuplicateCount === 1
                    ? 'Esta mídia já se encontra na galeria desta sessão.'
                    : `${sameSessionDuplicateCount} mídias já se encontram na galeria desta sessão.`}
                </span>
                {onViewGallery && (
                  <button type="button" onClick={onViewGallery} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-black uppercase text-amber-900">
                    Ver mídia existente
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-clinic-border bg-clinic-bg/40 p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-clinic-text">Mídias da remessa</p>
              <p className="text-xs text-clinic-text-muted">{getActivityQueueStatusMessage(batchOverview)}</p>
            </div>
            {queuedMedia.length > 0 && !busy && <p className="text-[11px] font-bold text-clinic-primary">Os arquivos disponíveis estão seguros e prontos para envio.</p>}
          </div>

          {queuedMedia.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {queuedMedia.map((item, index) => {
                const duration = formatDuration(item.durationSeconds);
                const failurePresentation = item.status === 'failed'
                  ? getActivityFailurePresentation({
                      needsReselection: Boolean(item.needsReselection),
                      errorMessage: item.errorMessage,
                    })
                  : null;
                return (
                  <div key={item.id} className="group overflow-hidden rounded-xl border border-clinic-border bg-white shadow-sm">
                    <div className="relative aspect-square bg-slate-950">
                      {item.previewUrl ? (
                        <button type="button" onClick={() => openMediaViewer(item)} className="h-full w-full" title="Visualizar esta mídia">
                          <img src={item.previewUrl} alt={`${getMediaLabel(item.mediaType)} ${index + 1} da remessa`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-clinic-bg px-3 text-center text-clinic-text-muted">
                          {item.mediaType === 'video' ? <Film size={28} /> : <Camera size={28} />}
                          <span className="line-clamp-3 text-[10px] font-bold break-all">{item.originalName}</span>
                          <span className="text-[9px] font-black text-status-orange-text">
                            {item.status === 'acquiring'
                              ? 'Protegendo arquivo...'
                              : item.status === 'failed'
                                ? 'Arquivo precisa de atenção.'
                                : item.thumbnailStatus === 'generating'
                                  ? 'Gerando miniatura...'
                                  : 'Arquivo preparado. Prévia indisponível.'}
                          </span>
                        </div>
                      )}
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black text-white">
                        {item.mediaType === 'video' ? <Film size={11} /> : <Camera size={11} />}
                        {getMediaLabel(item.mediaType)} {index + 1}
                      </span>
                      {!busy && (
                        <button type="button" onClick={() => removeQueuedMedia(item.id)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-status-red-text text-white shadow-md" title="Remover esta mídia da remessa">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="space-y-1 p-2 text-[10px] font-bold text-clinic-text-muted">
                      <div>{item.width && item.height ? `${item.width} × ${item.height} • ` : ''}{formatFileSize(item.fileSize)}{duration ? ` • ${duration}` : ''}</div>
                      {item.status === 'acquiring' && <div className="text-status-orange-text">Protegendo arquivo no celular: {Math.round(item.progress)}%</div>}
                      {item.status !== 'acquiring' && item.status !== 'failed' && item.thumbnailStatus === 'generating' && <div className="text-status-orange-text">Gerando miniatura...</div>}
                      {item.status !== 'acquiring' && item.status !== 'failed' && item.thumbnailStatus === 'unavailable' && <div className="text-status-orange-text">O arquivo está pronto, mas a imagem de prévia não pôde ser criada.</div>}
                      {item.status === 'duplicate' && (
                        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
                          <div className="font-black">Mídia já registrada</div>
                          <div>
                            Esta mídia já foi registrada em outra sessão deste paciente
                            {item.duplicateWarning?.sessionDate ? ` (${safeFormatDate(item.duplicateWarning.sessionDate, 'dd/MM/yyyy')}${item.duplicateWarning.sessionTime ? ` às ${item.duplicateWarning.sessionTime}` : ''})` : ''}.
                            {' '}Confira o registro existente antes de decidir se deseja enviá-la novamente.
                          </div>
                          <div className="flex flex-col gap-1">
                            {onViewGallery && (
                              <button type="button" onClick={onViewGallery} className="rounded-lg border border-amber-400 bg-white px-2 py-1 text-[9px] font-black uppercase text-amber-900">
                                Ver mídia existente
                              </button>
                            )}
                            <button type="button" onClick={() => ignoreDuplicateMedia(item.id)} className="rounded-lg border border-clinic-border bg-white px-2 py-1 text-[9px] font-black uppercase text-clinic-text-muted">
                              Não enviar novamente
                            </button>
                            <button type="button" onClick={() => allowDuplicateMedia(item.id)} className="rounded-lg border border-status-orange-text/30 bg-white px-2 py-1 text-[9px] font-black uppercase text-status-orange-text">
                              Enviar mesmo assim
                            </button>
                          </div>
                        </div>
                      )}
                      {item.status === 'verification' && (
                        <div className="space-y-2 rounded-lg bg-status-orange-bg p-2 text-status-orange-text">
                          <div>Não foi possível verificar automaticamente se esta mídia já existe entre os registros antigos.</div>
                          <div className="flex flex-col gap-1">
                            {onViewGallery && (
                              <button type="button" onClick={onViewGallery} className="rounded-lg border border-clinic-border bg-white px-2 py-1 text-[9px] font-black uppercase text-clinic-primary">
                                Conferir galeria
                              </button>
                            )}
                            <button type="button" onClick={() => allowUnverifiedMedia(item.id)} className="rounded-lg border border-status-orange-text/30 bg-white px-2 py-1 text-[9px] font-black uppercase">
                              Enviar mesmo assim
                            </button>
                            <button type="button" onClick={() => removeQueuedMedia(item.id)} className="rounded-lg border border-clinic-border bg-white px-2 py-1 text-[9px] font-black uppercase text-clinic-text-muted">
                              Remover da remessa
                            </button>
                          </div>
                        </div>
                      )}
                      {item.status === 'preparing' && <div className="text-clinic-primary">Preparando esta mídia...</div>}
                      {item.status === 'uploading' && <div className="text-clinic-primary">Enviando ou aguardando confirmação: {Math.round(item.progress)}%</div>}
                      {item.status === 'queued' && (
                        <div className="text-clinic-primary">
                          {item.mediaType === 'photo' ? 'Foto preparada' : 'Vídeo preparado'} e pronta para envio.
                        </div>
                      )}
                      {item.status === 'failed' && (
                        <div className="space-y-1 rounded-lg border border-status-red-text/30 bg-status-red-bg p-2 text-status-red-text">
                          <div className="font-black">{failurePresentation?.title}</div>
                          <div>{failurePresentation?.message}</div>
                          {item.needsReselection && (
                            <button type="button" onClick={() => requestMediaReplacement(item.id)} className="rounded-lg border border-status-red-text/30 bg-status-red-bg px-2 py-1 text-[9px] font-black uppercase">
                              Selecionar arquivo novamente
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-clinic-border bg-white p-5 text-center text-xs font-bold text-clinic-text-muted">
              Toque em Tirar foto ou escolha fotos/vídeos para montar a galeria da sessão antes de salvar.
            </div>
          )}
        </div>

        {recoveredNeedsMetadataConfirmation && (
          <div className="rounded-xl border border-status-orange-text/30 bg-status-orange-bg p-3 text-sm font-bold text-status-orange-text">
            <p>A remessa foi recuperada sem guardar a observação clínica. Revise sessão, categoria, visibilidade e observação; depois confirme esses dados para todas as mídias.</p>
            <button type="button" onClick={confirmRecoveredMetadata} className="mt-3 rounded-lg border border-status-orange-text/30 bg-white px-3 py-2 text-xs font-black uppercase">
              Confirmar dados da atividade
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Categoria</label>
            <select value={category} disabled={busy || metadataLocked} onChange={event => setCategory(event.target.value as ActivityRecordCategory)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm">
              {ACTIVITY_RECORD_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Visibilidade</label>
            <select value={visibility} disabled={busy || metadataLocked} onChange={event => setVisibility(event.target.value as ActivityRecordVisibility)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm">
              <option value="internal_only">Somente interno</option>
              {canShare && <option value="share_allowed">Pode ser compartilhado com o responsável</option>}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Observação opcional</label>
          <textarea value={description} disabled={busy || metadataLocked} maxLength={2000} onChange={event => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" placeholder="Descreva a atividade, o nível de auxílio ou alguma observação relevante. A observação será aplicada a todos os lotes desta atividade." />
        </div>

        {summary && (
          <div className={`rounded-2xl border p-4 ${summaryStyle.container}`} role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              {summaryTone === 'success'
                ? <CheckCircle2 className={summaryStyle.text} size={22} />
                : <AlertTriangle className={summaryStyle.text} size={22} />}
              <div className="flex-1 space-y-2">
                <p className={`font-black ${summaryStyle.text}`}>{summaryTitle}</p>
                <p className={`text-sm font-bold ${summaryStyle.text}`}>
                  {formatActivityUploadSummary(summary)}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Resumo do envio">
                  {summary.saved > 0 && (
                    <div className="rounded-xl border border-status-green-text/30 bg-status-green-bg px-3 py-2 text-status-green-text">
                      <p className="text-[10px] font-black uppercase">Salvas</p>
                      <p className="text-lg font-black">{summary.saved}</p>
                    </div>
                  )}
                  {summary.duplicates > 0 && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                      <p className="text-[10px] font-black uppercase">Repetidas</p>
                      <p className="text-lg font-black">{summary.duplicates}</p>
                    </div>
                  )}
                  {summary.failed > 0 && (
                    <div className="rounded-xl border border-status-red-text/35 bg-status-red-bg px-3 py-2 text-status-red-text">
                      <p className="text-[10px] font-black uppercase">Falharam</p>
                      <p className="text-lg font-black">{summary.failed}</p>
                    </div>
                  )}
                </div>
                {summary.failedNames.length > 0 && (
                  <div className="text-xs font-bold text-clinic-text-muted">
                    <p>Arquivos que precisam de atenção:</p>
                    <ul className="mt-1 list-disc pl-5">{summary.failedNames.map(name => <li key={name}>{name}</li>)}</ul>
                    <p className="mt-2">As mídias já confirmadas estão protegidas e não serão enviadas novamente.</p>
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  {onViewGallery && confirmedMediaCount > 0 && <button type="button" onClick={onViewGallery} className="rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-clinic-primary">Ver galeria</button>}
                  {canAddNextBatch && <button type="button" onClick={handleAddMoreMedia} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-clinic-primary"><ImagePlus size={15} /> Adicionar mais mídias</button>}
                  {summary.pending > 0 && <button type="button" onClick={() => void handleSave('pending')} className="flex items-center justify-center gap-2 rounded-xl border border-status-orange-text/30 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-status-orange-text"><RotateCcw size={15} /> Continuar envio</button>}
                  {batchOverview.retryable > 0 && <button type="button" onClick={() => void handleSave('failed')} className="flex items-center justify-center gap-2 rounded-xl border border-status-orange-text/30 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-status-orange-text"><RotateCcw size={15} /> Tentar enviar novamente</button>}
                  {batchOverview.needsReselection > 0 && <button type="button" onClick={() => multipleReplacementInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-status-red-text/30 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-status-red-text"><ImagePlus size={15} /> Selecionar arquivos novamente ({batchOverview.needsReselection})</button>}
                </div>
              </div>
            </div>
          </div>
        )}

        {busy && (
          <div className="rounded-xl border border-clinic-primary/20 bg-clinic-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-clinic-primary"><Loader2 size={16} className="animate-spin" /> {stageLabel}</div>
            {stage === 'uploading' && <div className="mt-2 h-2 overflow-hidden rounded-full bg-clinic-border"><div className="h-full bg-clinic-primary transition-all" style={{ width: `${progress}%` }} /></div>}
          </div>
        )}

        <p className="rounded-xl bg-clinic-bg/70 px-3 py-2 text-xs font-bold text-clinic-text-muted">Esta atividade aceita até {MAX_ACTIVITY_TOTAL_MEDIA} mídias em uma única seleção. Os arquivos e as imagens de prévia são preparados um por vez para proteger a memória do celular. {thumbnailOverview.generating} {thumbnailOverview.generating === 1 ? 'prévia em preparação' : 'prévias em preparação'}; {thumbnailOverview.unavailable} {thumbnailOverview.unavailable === 1 ? 'prévia indisponível' : 'prévias indisponíveis'}.</p>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onClick={resetAndClose} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2.5 text-xs font-black uppercase tracking-wide text-clinic-text-muted">
            <X size={15} /> {busy ? 'Cancelar envio' : queuedMedia.length > 0 ? 'Fechar atividade' : 'Fechar'}
          </button>
          {batchOverview.available > 0 && (
            <button type="button" disabled={busy || !selectedSession || !canRecord} onClick={() => void handleSave()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50">
              <Save size={15} /> {batchOverview.available === 1 ? 'Enviar mídia disponível' : `Enviar mídias disponíveis (${batchOverview.available})`}
            </button>
          )}
          {confirmedMediaCount > 0 && queuedMedia.length === 0 && (
            <button type="button" onClick={handleFinalizeActivity} className="flex items-center justify-center gap-2 rounded-xl bg-status-green-text px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white">
              <CheckCircle2 size={15} /> Finalizar atividade
            </button>
          )}
        </div>

        {viewingMedia && viewingMediaUrl && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Visualização da mídia">
            <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-black p-3">
              <button type="button" onClick={closeMediaViewer} className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-clinic-text shadow-lg" title="Fechar visualização">
                <X size={20} />
              </button>
              {viewingMedia.mediaType === 'video' ? (
                <video src={viewingMediaUrl} preload="metadata" playsInline controls className="max-h-[86vh] w-full object-contain" />
              ) : (
                <img src={viewingMediaUrl} alt="Mídia selecionada" className="max-h-[86vh] w-full object-contain" />
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
