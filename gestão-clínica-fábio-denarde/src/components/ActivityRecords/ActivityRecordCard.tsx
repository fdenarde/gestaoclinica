import React, { useEffect, useState } from 'react';
import { Eye, Loader2, Pencil, Trash2 } from 'lucide-react';
import type { ActivityRecord } from '../../types/activityRecords';
import { getActivityPhotoUrl } from '../../lib/activityRecordsApi';
import { safeFormatDate } from '../../lib/utils';

export default function ActivityRecordCard({ record, onView, onEdit, onDelete }: { key?: React.Key; record: ActivityRecord; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    getActivityPhotoUrl(record.id, record.patientId).then(value => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [record.id, record.patientId]);
  const visibility = record.visibility === 'share_allowed' ? 'Compartilhamento permitido' : record.visibility === 'do_not_share' ? 'Não compartilhar' : 'Somente interno';
  return (
    <article className="overflow-hidden rounded-2xl border border-clinic-border bg-white shadow-sm">
      <button type="button" onClick={onView} className="relative block aspect-[4/3] w-full bg-clinic-bg">
        {url ? <img src={url} alt={record.description || record.category} className="h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-clinic-primary" /></span>}
        {record.status === 'delete_failed' && <span className="absolute left-2 top-2 rounded-full bg-status-red-text px-2 py-1 text-[9px] font-black uppercase text-white">Exclusão pendente</span>}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-sm font-black text-clinic-text">{record.category}</p><p className="text-[10px] font-bold uppercase tracking-wide text-clinic-text-faint">{safeFormatDate(record.sessionDate, 'dd/MM/yyyy')} às {record.sessionTime}</p></div>
          <span className="rounded-full bg-clinic-bg px-2 py-1 text-[9px] font-black uppercase text-clinic-text-muted">Foto</span>
        </div>
        <p className="line-clamp-2 min-h-8 text-xs text-clinic-text-muted">{record.description || 'Sem observação.'}</p>
        <div className="space-y-0.5 text-[10px] font-bold text-clinic-text-faint">
          <p>{record.sessionNumber ? `Sessão ${record.sessionNumber}` : 'Sessão relacionada'} • {record.sessionStatusSnapshot}</p>
          <p>Profissional: {record.createdByName || 'Não informado'}</p>
          <p>{visibility} • {record.shareStatus === 'shared_confirmed' ? 'Compartilhado' : 'Não compartilhado'}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-clinic-border pt-2">
          <button type="button" onClick={onView} className="flex items-center justify-center gap-1 rounded-lg bg-clinic-bg py-2 text-[10px] font-black uppercase text-clinic-primary"><Eye size={13} /> Ver</button>
          <button type="button" onClick={onEdit} className="flex items-center justify-center gap-1 rounded-lg bg-clinic-bg py-2 text-[10px] font-black uppercase text-clinic-primary"><Pencil size={13} /> Editar</button>
          <button type="button" onClick={onDelete} className="flex items-center justify-center gap-1 rounded-lg bg-status-red-bg py-2 text-[10px] font-black uppercase text-status-red-text"><Trash2 size={13} /> Excluir</button>
        </div>
      </div>
    </article>
  );
}
