import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Eye, Film, ImageIcon, Loader2, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import type { ActivityRecord } from '../../types/activityRecords';
import { getActivityPhotoUrl } from '../../lib/activityRecordsApi';
import { safeFormatDate } from '../../lib/utils';

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function getMediaKind(record: ActivityRecord): 'photo' | 'video' {
  if (record.mediaType === 'video' || record.mimeType?.startsWith('video/')) return 'video';
  return 'photo';
}

interface ActivityRecordCardProps {
  key?: React.Key;
  record: ActivityRecord;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export default function ActivityRecordCard({ record, onView, onEdit, onDelete, selectMode = false, selected = false, onToggleSelect }: ActivityRecordCardProps) {
  const [url, setUrl] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [retriedUrl, setRetriedUrl] = useState(false);
  const mediaKind = getMediaKind(record);
  const duration = formatDuration(record.durationSeconds);
  const visibility = record.visibility === 'share_allowed' ? 'Compartilhamento permitido' : 'Somente interno';

  useEffect(() => {
    let active = true;
    setUrl('');
    setLoadError(false);
    setRetriedUrl(false);
    getActivityPhotoUrl(record.id, record.patientId)
      .then(value => { if (active) setUrl(value); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [record.id, record.patientId]);

  const mediaLabel = useMemo(() => mediaKind === 'video' ? 'Vídeo' : 'Foto', [mediaKind]);
  const mediaIcon = mediaKind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />;

  const handleMediaError = () => {
    if (retriedUrl) {
      setLoadError(true);
      return;
    }
    setRetriedUrl(true);
    getActivityPhotoUrl(record.id, record.patientId, true)
      .then(value => setUrl(value))
      .catch(() => setLoadError(true));
  };

  return (
    <article className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl ${selected ? 'border-clinic-primary ring-2 ring-clinic-primary/30' : 'border-clinic-border'}`}>
      <button type="button" onClick={selectMode ? onToggleSelect : onView} className="relative block aspect-video w-full overflow-hidden bg-slate-950 text-left">
        {url && mediaKind === 'photo' && (
          <img src={url} alt={record.description || record.category} onError={handleMediaError} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        )}
        {url && mediaKind === 'video' && (
          <video src={url} preload="metadata" muted playsInline onError={handleMediaError} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        )}
        {!url && !loadError && (
          <span className="absolute inset-0 flex items-center justify-center bg-clinic-bg">
            <Loader2 className="animate-spin text-clinic-primary" />
          </span>
        )}
        {loadError && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-clinic-bg px-4 text-center text-xs font-bold text-clinic-text-muted">
            {mediaKind === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}
            Prévia indisponível
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white backdrop-blur-sm">
          {mediaIcon} {mediaLabel}
        </span>

        {selectMode && (
          <span className={`absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-lg ${selected ? 'border-white bg-clinic-primary text-white' : 'border-white/80 bg-black/55 text-white'}`}>
            {selected ? <Check size={17} strokeWidth={3} /> : null}
          </span>
        )}
        {duration && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black text-white backdrop-blur-sm">
            <Clock3 size={11} /> {duration}
          </span>
        )}
        {mediaKind === 'video' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-white/90 p-2 text-clinic-primary shadow-lg transition-transform duration-200 group-hover:scale-110">
              <PlayCircle size={34} fill="currentColor" className="text-clinic-primary" />
            </span>
          </span>
        )}
        {record.status === 'delete_failed' && <span className="absolute left-2 top-10 rounded-full bg-status-red-text px-2 py-1 text-[9px] font-black uppercase text-white">Exclusão pendente</span>}
        <span className="absolute bottom-2 left-2 right-2">
          <span className="line-clamp-1 text-xs font-black text-white drop-shadow-sm">{record.category}</span>
          <span className="mt-0.5 block text-[10px] font-bold text-white/85">{safeFormatDate(record.sessionDate, 'dd/MM/yyyy')} às {record.sessionTime}</span>
        </span>
      </button>

      <div className="space-y-2 p-3">
        <p className="line-clamp-2 min-h-8 text-xs text-clinic-text-muted">{record.description || 'Sem observação.'}</p>
        <div className="space-y-0.5 text-[10px] font-bold text-clinic-text-faint">
          <p>{record.sessionNumber ? `Sessão ${record.sessionNumber}` : 'Sessão relacionada'} • {record.sessionStatusSnapshot}</p>
          <p>Profissional: {record.createdByName || 'Não informado'}</p>
          <p>{visibility} • {record.shareStatus === 'shared_confirmed' ? 'Compartilhado' : 'Não compartilhado'}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-clinic-border pt-2">
          <button type="button" onClick={onView} disabled={selectMode} className="flex items-center justify-center gap-1 rounded-lg bg-clinic-bg py-2 text-[10px] font-black uppercase text-clinic-primary disabled:opacity-45"><Eye size={13} /> Ver</button>
          <button type="button" onClick={onEdit} disabled={selectMode} className="flex items-center justify-center gap-1 rounded-lg bg-clinic-bg py-2 text-[10px] font-black uppercase text-clinic-primary disabled:opacity-45"><Pencil size={13} /> Editar</button>
          <button type="button" onClick={selectMode ? onToggleSelect : onDelete} className="flex items-center justify-center gap-1 rounded-lg bg-status-red-bg py-2 text-[10px] font-black uppercase text-status-red-text"><Trash2 size={13} /> {selectMode ? 'Marcar' : 'Excluir'}</button>
        </div>
      </div>
    </article>
  );
}
