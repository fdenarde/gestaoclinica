import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Save, X } from 'lucide-react';
import type { Patient, Session } from '../../types';
import { SessionStatus } from '../../types';
import { ACTIVITY_RECORD_CATEGORIES, getDefaultActivityAuthorization, type ActivityRecordCategory, type ActivityRecordVisibility } from '../../types/activityRecords';
import { processActivityPhoto, type ProcessedActivityPhoto } from '../../lib/imageProcessing';
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

export default function ActivityRecordModal({ isOpen, onClose, patient, sessions, initialSession, currentUserName }: ActivityRecordModalProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [sessionId, setSessionId] = useState(initialSession?.id || '');
  const [category, setCategory] = useState<ActivityRecordCategory>('Atividade pedagógica');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ActivityRecordVisibility>('internal_only');
  const [photo, setPhoto] = useState<ProcessedActivityPhoto | null>(null);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [progress, setProgress] = useState(0);

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

  useEffect(() => () => { if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl); }, [photo?.previewUrl]);

  const resetAndClose = () => {
    if (busy) {
      const cancelled = cancelActiveActivityUpload();
      if (cancelled) showToast('Cancelando o envio da foto...', 'success');
      return;
    }
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    setDescription('');
    setCategory('Atividade pedagógica');
    setVisibility('internal_only');
    setProgress(0);
    onClose();
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setStage('preparing');
    try {
      const prepared = await processActivityPhoto(file);
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(prepared);
      showToast('Foto selecionada e preparada.', 'success');
    } catch (error) {
      showToast(getActivityRecordErrorMessage(error), 'error');
    } finally {
      setStage('idle');
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!canRecord) return showToast('Autorize o registro interno no cadastro antes de salvar fotos.', 'error');
    if (!selectedSession) return showToast('Selecione a sessão relacionada.', 'error');
    if (!photo) return showToast('Tire uma foto ou escolha uma imagem da galeria.', 'error');
    setStage('uploading');
    setProgress(0);
    try {
      await uploadActivityPhoto({
        patient,
        session: selectedSession,
        file: photo.file,
        width: photo.width,
        height: photo.height,
        sha256: photo.sha256,
        category,
        description,
        visibility,
        createdByName: currentUserName,
        onProgress: value => {
          setProgress(value);
          if (value >= 100) setStage('finalizing');
        },
      });
      showToast('Registro de atividade salvo com segurança.', 'success');
      if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
      setDescription('');
      setProgress(0);
      setStage('idle');
      onClose();
    } catch (error) {
      showToast(getActivityRecordErrorMessage(error), 'error');
      setStage('idle');
      setProgress(0);
    }
  };

  const stageLabel = stage === 'preparing' ? 'Preparando a foto...' : stage === 'uploading' ? `Enviando: ${progress}%` : stage === 'finalizing' ? 'Finalizando o registro...' : '';

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title="Registrar atividade" width="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-xl border border-clinic-border bg-clinic-bg/60 p-3">
          <p className="font-bold text-clinic-text">{patient.name}</p>
          <p className="text-xs text-clinic-text-muted">O registro ficará associado à criança e à sessão selecionada.</p>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button type="button" disabled={busy || !canRecord} onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <Camera size={18} /> Tirar foto
          </button>
          <button type="button" disabled={busy || !canRecord} onClick={() => galleryInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-primary disabled:opacity-50">
            <ImagePlus size={18} /> Escolher da galeria
          </button>
          <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={event => void handleFile(event.target.files?.[0])} />
          <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => void handleFile(event.target.files?.[0])} />
        </div>

        {photo && (
          <div className="rounded-2xl border border-clinic-border bg-clinic-bg/40 p-3">
            <img src={photo.previewUrl} alt="Pré-visualização da atividade" className="max-h-72 w-full rounded-xl object-contain bg-black/5" />
            <p className="mt-2 text-xs text-clinic-text-muted">Foto preparada: {photo.width} × {photo.height} • {(photo.file.size / 1024).toFixed(0)} KB</p>
          </div>
        )}

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
              <option value="do_not_share">Não compartilhar</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-clinic-text-faint mb-1">Observação opcional</label>
          <textarea value={description} disabled={busy} maxLength={2000} onChange={event => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" placeholder="Descreva a atividade, o nível de auxílio ou alguma observação relevante." />
        </div>

        {busy && (
          <div className="rounded-xl border border-clinic-primary/20 bg-clinic-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-bold text-clinic-primary"><Loader2 size={16} className="animate-spin" /> {stageLabel}</div>
            {stage === 'uploading' && <div className="mt-2 h-2 overflow-hidden rounded-full bg-clinic-border"><div className="h-full bg-clinic-primary transition-all" style={{ width: `${progress}%` }} /></div>}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button type="button" onClick={resetAndClose} className="flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2.5 text-xs font-black uppercase tracking-wide text-clinic-text-muted">
            <X size={15} /> {busy ? 'Cancelar envio' : 'Cancelar'}
          </button>
          <button type="button" disabled={busy || !photo || !selectedSession || !canRecord} onClick={() => void handleSave()} className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Save size={15} /> Salvar registro
          </button>
        </div>
      </div>
    </Modal>
  );
}
