import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActivityRecord } from '../../types/activityRecords';
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
        {url && mediaKind === 'photo' && <img src={url} alt={record.description || record.category} onError={handleMediaError} className="max-h-[70vh] w-full rounded-xl object-contain bg-black/5" />}
        {url && mediaKind === 'video' && <video src={url} controls playsInline preload="metadata" onError={handleMediaError} className="max-h-[70vh] w-full rounded-xl bg-black" />}
        <div className="rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm">
          <p className="font-bold text-clinic-text">{record.category}</p>
          <p className="text-clinic-text-muted whitespace-pre-wrap">{record.description || 'Sem observação.'}</p>
        </div>
      </div>}
    </Modal>
  );
}
