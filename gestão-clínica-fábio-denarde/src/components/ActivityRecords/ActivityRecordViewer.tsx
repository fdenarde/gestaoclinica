import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActivityRecord } from '../../types/activityRecords';
import { getActivityPhotoUrl } from '../../lib/activityRecordsApi';
import Modal from '../Common/Modal';

export default function ActivityRecordViewer({ record, onClose }: { record: ActivityRecord | null; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!record) return;
    setUrl(''); setError('');
    getActivityPhotoUrl(record.id, record.patientId).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setError('Não foi possível carregar a foto.'); });
    return () => { active = false; };
  }, [record?.id]);
  return (
    <Modal isOpen={!!record} onClose={onClose} title="Registro de atividade" width="max-w-4xl">
      {record && <div className="space-y-3">
        {!url && !error && <div className="min-h-64 flex items-center justify-center"><Loader2 className="animate-spin text-clinic-primary" /></div>}
        {error && <div className="p-6 text-center text-status-red-text font-bold">{error}</div>}
        {url && <img src={url} alt={record.description || record.category} className="max-h-[70vh] w-full rounded-xl object-contain bg-black/5" />}
        <div className="rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm">
          <p className="font-bold text-clinic-text">{record.category}</p>
          <p className="text-clinic-text-muted whitespace-pre-wrap">{record.description || 'Sem observação.'}</p>
        </div>
      </div>}
    </Modal>
  );
}
