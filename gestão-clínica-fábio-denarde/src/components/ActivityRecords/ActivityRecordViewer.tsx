import React, { useEffect, useMemo, useState } from 'react';
import { Film, ImageIcon, Loader2, PlayCircle } from 'lucide-react';
import type { ActivityRecord } from '../../types/activityRecords';
import { getActivityPhotoUrl } from '../../lib/activityRecordsApi';
import { safeFormatDate } from '../../lib/utils';
import Modal from '../Common/Modal';

function getMediaKind(record: ActivityRecord): 'photo' | 'video' {
  if (record.mediaType === 'video' || record.mimeType?.startsWith('video/')) return 'video';
  return 'photo';
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

export default function ActivityRecordViewer({ record, onClose }: { record: ActivityRecord | null; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const mediaKind = useMemo(() => record ? getMediaKind(record) : 'photo', [record]);
  const duration = useMemo(() => record ? formatDuration(record.durationSeconds) : null, [record]);

  useEffect(() => {
    let active = true;
    if (!record) return;
    setUrl('');
    setError('');
    getActivityPhotoUrl(record.id, record.patientId)
      .then(value => { if (active) setUrl(value); })
      .catch(() => { if (active) setError('Não foi possível carregar esta mídia.'); });
    return () => { active = false; };
  }, [record?.id, record?.patientId]);

  return (
    <Modal isOpen={!!record} onClose={onClose} title="Registro de atividade" width="max-w-5xl">
      {record && <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl border border-clinic-border bg-slate-950">
          {!url && !error && <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-white" /></div>}
          {error && <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center font-bold text-white/85">{mediaKind === 'video' ? <Film size={30} /> : <ImageIcon size={30} />}{error}</div>}
          {url && mediaKind === 'photo' && <img src={url} alt={record.description || record.category} className="max-h-[72vh] w-full object-contain" />}
          {url && mediaKind === 'video' && <video src={url} controls preload="metadata" playsInline className="max-h-[72vh] w-full bg-black" />}
          {url && mediaKind === 'video' && (
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white backdrop-blur-sm">
              <PlayCircle size={14} /> Vídeo {duration ? `• ${duration}` : ''}
            </div>
          )}
        </div>
        <div className="grid gap-3 rounded-2xl border border-clinic-border bg-clinic-bg p-4 text-sm sm:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-clinic-primary">{mediaKind === 'video' ? <Film size={12} /> : <ImageIcon size={12} />} {mediaKind === 'video' ? 'Vídeo' : 'Foto'}</span>
              <span className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">{safeFormatDate(record.sessionDate, 'dd/MM/yyyy')} às {record.sessionTime}</span>
            </div>
            <p className="font-bold text-clinic-text">{record.category}</p>
            <p className="whitespace-pre-wrap text-clinic-text-muted">{record.description || 'Sem observação.'}</p>
          </div>
          <div className="text-left text-[10px] font-bold uppercase tracking-wide text-clinic-text-faint sm:text-right">
            <p>{record.sessionNumber ? `Sessão ${record.sessionNumber}` : 'Sessão relacionada'}</p>
            <p>{record.createdByName || 'Profissional não informado'}</p>
          </div>
        </div>
      </div>}
    </Modal>
  );
}
