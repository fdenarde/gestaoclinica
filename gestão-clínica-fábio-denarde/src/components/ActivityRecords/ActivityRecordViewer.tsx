import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { getActivityRecordCategoryLabel, type ActivityRecord } from '../../types/activityRecords';
import { getActivityPhotoUrl } from '../../lib/activityRecordsApi';
import Modal from '../Common/Modal';

function getMediaKind(record: ActivityRecord): 'photo' | 'video' {
  if (record.mediaType === 'video' || record.mimeType?.startsWith('video/')) return 'video';
  return 'photo';
}

export default function ActivityRecordViewer({ record, onClose }: { record: ActivityRecord | null; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retriedUrl, setRetriedUrl] = useState(false);

  const mediaKind = record ? getMediaKind(record) : 'photo';

  useEffect(() => {
    let active = true;
    if (!record) return;
    setUrl('');
    setError('');
    setRetriedUrl(false);
    getActivityPhotoUrl(record.id, record.patientId)
      .then(value => { if (active) setUrl(value); })
      .catch(() => { if (active) setError('Não foi possível carregar a mídia.'); });
    return () => { active = false; };
  }, [record?.id, record?.patientId]);


  const downloadUrl = (() => {
    if (!url || !record || typeof window === 'undefined') return '';
    try {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set('download', '1');
      parsed.searchParams.set('fileName', record.fileName || `atividade-${record.id}`);
      return parsed.toString();
    } catch {
      return '';
    }
  })();

  const handleMediaError = () => {
    if (!record) return;
    if (retriedUrl) {
      setError('Não foi possível carregar a mídia.');
      return;
    }
    setRetriedUrl(true);
    getActivityPhotoUrl(record.id, record.patientId, true)
      .then(value => setUrl(value))
      .catch(() => setError('Não foi possível carregar a mídia.'));
  };

  return (
    <Modal isOpen={!!record} onClose={onClose} title="Registro de atividade" width="max-w-4xl">
      {record && <div className="space-y-3">
        {!url && !error && <div className="min-h-64 flex items-center justify-center"><Loader2 className="animate-spin text-clinic-primary" /></div>}
        {error && <div className="p-6 text-center text-status-red-text font-bold">{error}</div>}
        {url && mediaKind === 'photo' && <img src={url} alt={record.description || getActivityRecordCategoryLabel(record.category)} onError={handleMediaError} className="max-h-[70vh] w-full rounded-xl object-contain bg-black/5" />}
        {url && mediaKind === 'video' && <video src={url} controls playsInline preload="metadata" onError={handleMediaError} className="max-h-[70vh] w-full rounded-xl bg-black" />}
        <div className="rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-bold text-clinic-text">{getActivityRecordCategoryLabel(record.category)}</p>
              <p className="whitespace-pre-wrap text-clinic-text-muted">{record.description || 'Sem observação.'}</p>
            </div>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={record.fileName || undefined}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase text-white"
              >
                <Download size={15} /> Baixar mídia
              </a>
            )}
          </div>
        </div>
      </div>}
    </Modal>
  );
}
