import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Film, ImagePlus, Loader2, Save, Trash2, X } from 'lucide-react';
import type { Patient, Session } from '../../types';
import { SessionStatus } from '../../types';
import { ACTIVITY_RECORD_CATEGORIES, getDefaultActivityAuthorization, type ActivityRecordCategory, type ActivityRecordVisibility } from '../../types/activityRecords';
import { processActivityMedia, type ProcessedActivityMedia } from '../../lib/imageProcessing';
import { cancelActiveActivityUpload, getActivityRecordErrorMessage, uploadActivityPhoto } from '../../lib/activityRecordsApi';
import Modal from '../Common/Modal';
import { showToast } from '../Common/Toast';
import { safeFormatDate } from '../../lib/utils';

interface ActivityRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient;
  sessions: Session[];
  initialSession?: Session | null;
  currentUserName: string;
}

type SaveStage = 'idle' | 'preparing' | 'uploading' | 'finalizing';

interface QueuedActivityMedia extends ProcessedActivityMedia {
  id: string;
  originalName: string;
  addedAt: number;
}

function createLocalMediaId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `midia-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokeQueuedMedia(items: QueuedActivityMedia[]): void {
  for (const item of items) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
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

export default function ActivityRecordModal({ isOpen, onClose, patient, sessions, initialSession, currentUserName }: ActivityRecordModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const queuedMediaRef = useRef<QueuedActivityMedia[]>([]);
  const [sessionId, setSessionId] = useState(initialSession?.id || '');
  const [category, setCategory] = useState<ActivityRecordCategory>('Atividade pedagógica');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ActivityRecordVisibility>('internal_only');
  const [queuedMedia, setQueuedMedia] = useState<QueuedActivityMedia[]>([]);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [progress, setProgress] = useState(0);
  const [captureKey, setCaptureKey] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);

  const authorization = patient.activityMediaAuthorization || getDefaultActivityAuthorization();
  const canRecord = authorization.internalRecordingStatus === 'authorized';
  const canShare = authorization.guardianSharingStatus === 'authorized';
  const availableSessions = useMemo(() => sessions
    .filter(session => session.patientId === patient.id && !session.isBlocked && ![SessionStatus.FALTA, SessionStatus.FALTA_PROF, SessionStatus.CANCELADA].includes(session.status))
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)), [patient.id, sessions]);
  const selectedSession = availableSessions.find(item => item.id === sessionId) || initialSession || null;
  const busy = stage !== 'idle';

  useEffect(() => {
    if (initialSession) setSessionId(initialSession.id);
  }, [initialSession?.id]);

  useEffect(() => {
    queuedMediaRef.current = queuedMedia;
  }, [queuedMedia]);

  useEffect(() => () => {
    revokeQueuedMedia(queuedMediaRef.current);
  }, []);

  const resetCaptureInputs = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    setCaptureKey(value => value + 1);
  };

  const resetBatch = () => {
    revokeQueuedMedia(queuedMediaRef.current);
    queuedMediaRef.current = [];
    setQueuedMedia([]);
    setDescription('');
    setCategory('Atividade pedagógica');
    setVisibility('internal_only');
    setProgress(0);
    setUploadTotal(0);
    setUploadIndex(0);
    resetCaptureInputs();
  };

  const resetAndClose = () => {
    if (busy) {
      const cancelled = cancelActiveActivityUpload();
      if (cancelled) showToast('Cancelando o envio das mídias...', 'success');
      return;
    }
    resetBatch();
    onClose();
  };

  const handleFiles = async (files?: FileList | File[] | null) => {
    const selectedFiles = Array.from(files || []).filter(Boolean);
    if (selectedFiles.length === 0) return;

    setStage('preparing');
    try {
      const preparedMedia: QueuedActivityMedia[] = [];

      for (const file of selectedFiles) {
        const prepared = await processActivityMedia(file);
        preparedMedia.push({
          ...prepared,
          id: createLocalMediaId(),
          originalName: file.name || prepared.file.name,
          addedAt: Date.now(),
        });
      }

      setQueuedMedia(current => [...current, ...preparedMedia]);
      showToast(`${preparedMedia.length} ${preparedMedia.length === 1 ? 'mídia adicionada' : 'mídias adicionadas'} à remessa.`, 'success');
    } catch (error) {
      showToast(getActivityRecordErrorMessage(error), 'error');
    } finally {
      setStage('idle');
      resetCaptureInputs();
    }
  };

  const removeQueuedMedia = (mediaId: string) => {
    if (busy) return;
    setQueuedMedia(current => {
      const mediaToRemove = current.find(item => item.id === mediaId);
      if (mediaToRemove?.previewUrl) URL.revokeObjectURL(mediaToRemove.previewUrl);
      return current.filter(item => item.id !== mediaId);
    });
  };

  const handleSave = async () => {
    if (!canRecord) return showToast('Autorize o registro interno no cadastro antes de salvar mídias.', 'error');
    if (!selectedSession) return showToast('Selecione a sessão relacionada.', 'error');
    if (queuedMedia.length === 0) return showToast('Adicione uma ou mais mídias antes de salvar a remessa.', 'error');

    const mediaToUpload = [...queuedMedia];
    const total = mediaToUpload.length;
    setStage('uploading');
    setProgress(0);
    setUploadTotal(total);
    setUploadIndex(0);

    try {
      for (let index = 0; index < mediaToUpload.length; index += 1) {
        const queuedItem = mediaToUpload[index];
        setUploadIndex(index + 1);

        await uploadActivityPhoto({
          patient,
          session: selectedSession,
          file: queuedItem.file,
          width: queuedItem.width,
          height: queuedItem.height,
          sha256: queuedItem.sha256,
          mediaType: queuedItem.mediaType,
          durationSeconds: queuedItem.mediaType === 'video' ? queuedItem.durationSeconds : undefined,
          lastModified: queuedItem.lastModified || queuedItem.file.lastModified || Date.now(),
          category,
          description,
          visibility,
          createdByName: currentUserName,
          onProgress: value => {
            const overallProgress = Math.min(99, Math.round(((index + value / 100) / total) * 100));
            setProgress(overallProgress);
            if (value >= 100 && index === mediaToUpload.length - 1) setStage('finalizing');
          },
        });

        if (queuedItem.previewUrl) URL.revokeObjectURL(queuedItem.previewUrl);
        setQueuedMedia(current => current.filter(item => item.id !== queuedItem.id));
      }

      setProgress(100);
      showToast(`${total} ${total === 1 ? 'mídia salva' : 'mídias salvas'} na galeria.`, 'success');
      setQueuedMedia([]);
      queuedMediaRef.current = [];
      setDescription('');
      setProgress(0);
      setUploadTotal(0);
      setUploadIndex(0);
      setStage('idle');
      resetCaptureInputs();
    } catch (error) {
      showToast(getActivityRecordErrorMessage(error), 'error');
      setStage('idle');
      setProgress(0);
      setUploadTotal(0);
      setUploadIndex(0);
    }
  };

  const stageLabel = stage === 'preparing'
    ? 'Preparando mídias...'
    : stage === 'uploading'
      ? `Enviando mídia ${uploadIndex || 1} de ${uploadTotal || queuedMedia.length}: ${progress}%`
      : stage === 'finalizing'
        ? 'Finalizando a remessa de mídias...'
        : '';

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title="Registrar atividade" width="max-w-3xl">
      <div className="space-y-5">
        <div className="rounded-xl border border-clinic-border bg-clinic-bg/60 p-3">
          <p className="font-bold text-clinic-text">{patient.name}</p>
          <p className="text-xs text-clinic-text-muted">Primeiro adicione todas as fotos e vídeos curtos da sessão. Depois salve a remessa inteira de uma vez.</p>
        </div>

        {!canRecord && (
          <div className="rounded-xl border border-status-orange-text/30 bg-status-orange-bg p-3 text-sm font-bold text-status-orange-text">
            Registro interno não autorizado. Atualize a autorização em Dados Cadastrais.
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Sessão relacionada</label>
          <select value={sessionId} onChange={event => setSessionId(event.target.value)} disabled={busy || !!initialSession} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary disabled:opacity-70">
            <option value="">Selecione a sessão...</option>
            {availableSessions.map(session => (
              <option key={session.id} value={session.id}>{safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time} • {session.status} {session.packageNumber ? `• Sessão ${session.packageNumber}` : ''}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button type="button" disabled={busy || !canRecord} onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Camera size={18} /> Tirar foto
          </button>
          <button type="button" disabled={busy || !canRecord} onClick={() => videoInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Film size={18} /> Gravar vídeo
          </button>
          <button type="button" disabled={busy || !canRecord} onClick={() => galleryInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-primary disabled:opacity-50">
            <ImagePlus size={18} /> Escolher fotos/vídeos
          </button>
          <input key={`camera-${captureKey}`} ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={event => void handleFiles(event.target.files)} />
          <input key={`video-${captureKey}`} ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" className="hidden" onChange={event => void handleFiles(event.target.files)} />
          <input key={`gallery-${captureKey}`} ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple className="hidden" onChange={event => void handleFiles(event.target.files)} />
        </div>

        <div className="rounded-2xl border border-clinic-border bg-clinic-bg/40 p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-clinic-text">Mídias da remessa</p>
              <p className="text-xs text-clinic-text-muted">{queuedMedia.length === 0 ? 'Nenhuma mídia adicionada ainda.' : `${queuedMedia.length} ${queuedMedia.length === 1 ? 'mídia pronta' : 'mídias prontas'} para salvar.`}</p>
            </div>
            {queuedMedia.length > 0 && !busy && <p className="text-[11px] font-bold text-clinic-primary">Continue adicionando mídias ou salve a remessa.</p>}
          </div>

          {queuedMedia.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {queuedMedia.map((item, index) => {
                const duration = formatDuration(item.durationSeconds);
                return (
                  <div key={item.id} className="group overflow-hidden rounded-xl border border-clinic-border bg-white shadow-sm">
                    <div className="relative aspect-square bg-slate-950">
                      {item.mediaType === 'video' ? (
                        <video src={item.previewUrl} preload="metadata" muted playsInline controls className="h-full w-full object-cover" />
                      ) : (
                        <img src={item.previewUrl} alt={`Foto ${index + 1} da remessa`} className="h-full w-full object-cover" />
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
                    <div className="p-2 text-[10px] font-bold text-clinic-text-muted">
                      {item.width} × {item.height} • {formatFileSize(item.file.size)}{duration ? ` • ${duration}` : ''}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Categoria</label>
            <select value={category} disabled={busy} onChange={event => setCategory(event.target.value as ActivityRecordCategory)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm">
              {ACTIVITY_RECORD_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Visibilidade</label>
            <select value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as ActivityRecordVisibility)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm">
              <option value="internal_only">Somente interno</option>
              {canShare && <option value="share_allowed">Pode ser compartilhado com o responsável</option>}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Observação opcional</label>
          <textarea value={description} disabled={busy} maxLength={2000} onChange={event => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" placeholder="Descreva a atividade, o nível de auxílio ou alguma observação relevante. A observação será aplicada a todas as mídias da remessa." />
        </div>

        {busy && (
          <div className="rounded-xl border border-clinic-primary/20 bg-clinic-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-clinic-primary"><Loader2 size={16} className="animate-spin" /> {stageLabel}</div>
            {stage === 'uploading' && <div className="mt-2 h-2 overflow-hidden rounded-full bg-clinic-border"><div className="h-full bg-clinic-primary transition-all" style={{ width: `${progress}%` }} /></div>}
          </div>
        )}

        <p className="rounded-xl bg-clinic-bg/70 px-3 py-2 text-xs font-bold text-clinic-text-muted">Fluxo correto: adicione todas as mídias necessárias, confira a remessa visual acima e clique em Salvar somente no final. Vídeos estão limitados a no máximo 3 minutos e até 600 MB. Para melhor envio, grave em resolução comum, preferencialmente HD/Full HD.</p>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onClick={resetAndClose} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2.5 text-xs font-black uppercase tracking-wide text-clinic-text-muted">
            <X size={15} /> {busy ? 'Cancelar envio' : 'Voltar para galeria'}
          </button>
          <button type="button" disabled={busy || queuedMedia.length === 0 || !selectedSession || !canRecord} onClick={() => void handleSave()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Save size={15} /> {queuedMedia.length <= 1 ? 'Salvar mídia' : `Salvar ${queuedMedia.length} mídias`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
