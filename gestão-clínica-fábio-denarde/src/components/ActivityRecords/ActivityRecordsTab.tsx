import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Camera, CheckSquare, Filter, Film, Image, Images, LayoutGrid, Loader2, LockKeyhole, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Patient, Session } from '../../types';
import { ACTIVITY_RECORD_CATEGORIES, getDefaultActivityAuthorization, type ActivityRecord, type ActivityRecordCategory, type ActivityRecordVisibility } from '../../types/activityRecords';
import { useActivityRecords } from '../../lib/useActivityRecords';
import { deleteActivityRecord, getActivityRecordErrorMessage, updateActivityRecordMetadata } from '../../lib/activityRecordsApi';
import ActivityRecordModal from './ActivityRecordModal';
import ActivityRecordCard from './ActivityRecordCard';
import ActivityRecordViewer from './ActivityRecordViewer';
import Modal from '../Common/Modal';
import { showToast } from '../Common/Toast';
import { safeFormatDate } from '../../lib/utils';

interface Props { patient: Patient; sessions: Session[]; currentUserId: string; currentUserName: string; onOpenAuthorization?: () => void; }
type MediaFilter = 'all' | 'photo' | 'video';

function getRecordMediaKind(record: ActivityRecord): 'photo' | 'video' {
  if (record.mediaType === 'video' || record.mimeType?.startsWith('video/')) return 'video';
  return 'photo';
}

function getSessionGroupKey(record: ActivityRecord): string {
  return `${record.sessionDate}|${record.sessionTime}|${record.sessionId}`;
}

function getSessionGroupTitle(records: ActivityRecord[]): string {
  const first = records[0];
  if (!first) return 'Sessão';
  return `${safeFormatDate(first.sessionDate, 'dd/MM/yyyy')} às ${first.sessionTime}`;
}

function getSessionGroupSubtitle(records: ActivityRecord[]): string {
  const first = records[0];
  const sessionLabel = first?.sessionNumber ? `Sessão ${first.sessionNumber}` : 'Sessão relacionada';
  const photos = records.filter(record => getRecordMediaKind(record) === 'photo').length;
  const videos = records.filter(record => getRecordMediaKind(record) === 'video').length;
  const parts = [`${photos} ${photos === 1 ? 'foto' : 'fotos'}`];
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`);
  return `${sessionLabel} • ${parts.join(' • ')}`;
}

export default function ActivityRecordsTab({ patient, sessions, currentUserId, currentUserName, onOpenAuthorization }: Props) {
  const { records, loading, error } = useActivityRecords(currentUserId, patient.id);
  const [newOpen, setNewOpen] = useState(false);
  const [authorizationHelpOpen, setAuthorizationHelpOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<ActivityRecord | null>(null);
  const [editRecord, setEditRecord] = useState<ActivityRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<ActivityRecord | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [shareFilter, setShareFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [editCategory, setEditCategory] = useState<ActivityRecordCategory>('Atividade pedagógica');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<ActivityRecordVisibility>('internal_only');
  const [busy, setBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);
  const authorization = patient.activityMediaAuthorization || getDefaultActivityAuthorization();
  const canRecord = authorization.internalRecordingStatus === 'authorized';
  const authorizationMessage = authorization.internalRecordingStatus === 'not_authorized'
    ? 'O responsável não autorizou o registro interno de imagens ou mídias para esta criança.'
    : 'O registro de atividades está bloqueado porque a autorização para registro interno está pendente.';

  const handleNewRecord = () => {
    if (canRecord) {
      setNewOpen(true);
      return;
    }
    setAuthorizationHelpOpen(true);
  };


  const returnToGallery = () => {
    setNewOpen(false);
    setViewRecord(null);
    window.setTimeout(() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const filtered = useMemo(() => records.filter(record => {
    const recordDate = new Date(`${record.sessionDate}T12:00:00`);
    const today = new Date();
    const days = periodFilter === '30' ? 30 : periodFilter === '90' ? 90 : null;
    const mediaKind = getRecordMediaKind(record);
    const periodMatches = periodFilter === 'all'
      || (periodFilter === 'year' && recordDate.getFullYear() === today.getFullYear())
      || (days !== null && recordDate >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
    return periodMatches
      && (categoryFilter === 'all' || record.category === categoryFilter)
      && (sessionFilter === 'all' || record.sessionId === sessionFilter)
      && (visibilityFilter === 'all' || record.visibility === visibilityFilter)
      && (mediaFilter === 'all' || mediaKind === mediaFilter)
      && (shareFilter === 'all' || (shareFilter === 'shared' ? record.shareStatus === 'shared_confirmed' : record.shareStatus !== 'shared_confirmed'));
  }), [records, categoryFilter, sessionFilter, shareFilter, visibilityFilter, periodFilter, mediaFilter]);

  const groupedRecords = useMemo(() => {
    const groups = new Map<string, ActivityRecord[]>();
    for (const record of filtered) {
      const key = getSessionGroupKey(record);
      const current = groups.get(key) || [];
      current.push(record);
      groups.set(key, current);
    }
    return Array.from(groups.values())
      .map(group => group.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`)))
      .sort((groupA, groupB) => {
        const firstA = groupA[0];
        const firstB = groupB[0];
        return `${firstB.sessionDate}T${firstB.sessionTime}`.localeCompare(`${firstA.sessionDate}T${firstA.sessionTime}`);
      });
  }, [filtered]);


  useEffect(() => {
    setSelectedIds(current => {
      const visibleIds = new Set(filtered.map(record => record.id));
      const next = new Set(Array.from(current).filter(id => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filtered]);

  const selectedRecords = useMemo(() => filtered.filter(record => selectedIds.has(record.id)), [filtered, selectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(record => selectedIds.has(record.id));

  const toggleRecordSelection = (recordId: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const toggleAllFiltered = () => {
    setSelectedIds(current => {
      if (allFilteredSelected) return new Set();
      const next = new Set(current);
      for (const record of filtered) next.add(record.id);
      return next;
    });
  };

  const confirmBulkDelete = async () => {
    if (selectedRecords.length === 0) return;
    setBusy(true);
    try {
      for (const record of selectedRecords) {
        await deleteActivityRecord(record);
      }
      showToast(`${selectedRecords.length} ${selectedRecords.length === 1 ? 'mídia excluída' : 'mídias excluídas'} da galeria.`, 'success');
      setBulkDeleteOpen(false);
      clearSelection();
    } catch (err) {
      showToast(getActivityRecordErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (record: ActivityRecord) => {
    setEditRecord(record);
    setEditCategory(record.category);
    setEditDescription(record.description);
    setEditVisibility(record.visibility === 'do_not_share' ? 'internal_only' : record.visibility);
  };

  const saveEdit = async () => {
    if (!editRecord) return;
    setBusy(true);
    try {
      await updateActivityRecordMetadata(editRecord, { category: editCategory, description: editDescription, visibility: editVisibility });
      showToast('Informações do registro atualizadas.', 'success');
      setEditRecord(null);
    } catch (err) { showToast(getActivityRecordErrorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleteRecord) return;
    setBusy(true);
    try {
      await deleteActivityRecord(deleteRecord);
      showToast('Registro e mídia excluídos com segurança.', 'success');
      setDeleteRecord(null);
    } catch (err) { showToast(getActivityRecordErrorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  return <div ref={galleryRef} className="space-y-5 animate-in fade-in slide-in-from-top-2 scroll-mt-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-clinic-border bg-gradient-to-br from-clinic-bg to-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><Images size={19} className="text-clinic-primary" /><h4 className="font-black text-clinic-text">Galeria de atividades</h4></div>
        <p className="mt-1 text-xs text-clinic-text-muted">Fotos e vídeos em cards visuais, vinculados à criança e à sessão correta.</p>
      </div>
      <button type="button" onClick={handleNewRecord} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-wide transition-all ${canRecord ? 'bg-clinic-primary text-white hover:bg-clinic-primary-hover' : 'border border-status-orange-text/30 bg-status-orange-bg text-status-orange-text hover:brightness-95'}`} title={canRecord ? 'Registrar uma nova atividade' : 'Ver motivo do bloqueio'}>{canRecord ? <Plus size={16} /> : <LockKeyhole size={16} />} Nova mídia</button>
    </div>

    <div className={`rounded-xl border p-3 text-sm font-bold ${authorization.internalRecordingStatus === 'authorized' ? 'border-status-green-text/20 bg-status-green-bg text-status-green-text' : 'border-status-orange-text/20 bg-status-orange-bg text-status-orange-text'}`}>
      <div className="flex items-center gap-2"><ShieldCheck size={16} /> Registro interno: {authorization.internalRecordingStatus === 'authorized' ? 'autorizado' : authorization.internalRecordingStatus === 'not_authorized' ? 'não autorizado' : 'pendente'} • Compartilhamento: {authorization.guardianSharingStatus === 'authorized' ? 'autorizado' : authorization.guardianSharingStatus === 'not_authorized' ? 'não autorizado' : 'pendente'}</div>
    </div>

    <div className="grid grid-cols-1 gap-2 rounded-xl border border-clinic-border bg-white p-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="relative"><CalendarDays size={14} className="absolute left-3 top-3.5 text-clinic-text-faint" /><select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg py-2.5 pl-9 pr-2 text-xs"><option value="all">Todo o período</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="year">Ano atual</option></select></label>
      <label className="relative"><Filter size={14} className="absolute left-3 top-3.5 text-clinic-text-faint" /><select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg py-2.5 pl-9 pr-2 text-xs"><option value="all">Todas as categorias</option>{ACTIVITY_RECORD_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="relative"><LayoutGrid size={14} className="absolute left-3 top-3.5 text-clinic-text-faint" /><select value={mediaFilter} onChange={e => setMediaFilter(e.target.value as MediaFilter)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg py-2.5 pl-9 pr-2 text-xs"><option value="all">Fotos e vídeos</option><option value="photo">Somente fotos</option><option value="video">Somente vídeos</option></select></label>
      <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs"><option value="all">Todas as sessões</option>{sessions.filter(s => s.patientId === patient.id).sort((a,b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map(s => <option key={s.id} value={s.id}>{s.date.split('-').reverse().join('/')} às {s.time}</option>)}</select>
      <select value={visibilityFilter} onChange={e => setVisibilityFilter(e.target.value)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs"><option value="all">Todas as visibilidades</option><option value="internal_only">Somente interno</option><option value="share_allowed">Compartilhamento permitido</option></select>
      <select value={shareFilter} onChange={e => setShareFilter(e.target.value)} className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs"><option value="all">Todos os compartilhamentos</option><option value="shared">Compartilhados</option><option value="not_shared">Não compartilhados</option></select>
    </div>


    {!loading && !error && filtered.length > 0 && (
      <div className={`rounded-xl border p-3 ${selectMode ? 'border-clinic-primary/30 bg-clinic-primary/5' : 'border-clinic-border bg-white'}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-clinic-text">Seleção múltipla</p>
            <p className="text-xs text-clinic-text-muted">Use para excluir várias mídias da galeria de uma vez. Outras ações em lote entram depois.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!selectMode ? (
              <button type="button" onClick={() => setSelectMode(true)} className="flex items-center gap-2 rounded-lg bg-clinic-bg px-3 py-2 text-[10px] font-black uppercase text-clinic-primary"><CheckSquare size={14} /> Selecionar mídias</button>
            ) : (
              <>
                <button type="button" onClick={toggleAllFiltered} className="rounded-lg bg-clinic-bg px-3 py-2 text-[10px] font-black uppercase text-clinic-primary">{allFilteredSelected ? 'Desmarcar todas' : 'Selecionar todas visíveis'}</button>
                <button type="button" onClick={() => setBulkDeleteOpen(true)} disabled={selectedRecords.length === 0 || busy} className="flex items-center gap-2 rounded-lg bg-status-red-bg px-3 py-2 text-[10px] font-black uppercase text-status-red-text disabled:opacity-45"><Trash2 size={14} /> Excluir {selectedRecords.length > 0 ? `(${selectedRecords.length})` : ''}</button>
                <button type="button" onClick={clearSelection} disabled={busy} className="flex items-center gap-2 rounded-lg bg-clinic-bg px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted"><X size={14} /> Cancelar seleção</button>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {loading && <div className="flex min-h-48 items-center justify-center"><Loader2 className="animate-spin text-clinic-primary" /></div>}
    {error && <div className="rounded-xl bg-status-red-bg p-4 text-center font-bold text-status-red-text">{error}</div>}
    {!loading && !error && filtered.length === 0 && <div className="rounded-2xl border border-dashed border-clinic-border bg-clinic-bg/40 p-10 text-center"><Image className="mx-auto mb-3 text-clinic-text-faint" /><p className="font-bold text-clinic-text">Nenhuma mídia registrada</p><p className="text-xs text-clinic-text-muted">Fotos e vídeos aparecerão aqui em galeria visual após o envio concluído.</p></div>}
    <div className="space-y-7">
      {groupedRecords.map(dateRecords => {
        const firstRecord = dateRecords[0];
        return (
          <section key={getSessionGroupKey(firstRecord)} className="space-y-3 rounded-2xl border border-clinic-border bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-clinic-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-clinic-bg text-clinic-primary"><CalendarDays size={16} /></span>
                <div>
                  <h5 className="text-xs font-black uppercase tracking-wide text-clinic-text">{getSessionGroupTitle(dateRecords)}</h5>
                  <p className="text-[10px] font-bold text-clinic-text-faint">{getSessionGroupSubtitle(dateRecords)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">
                <span className="flex items-center gap-1 rounded-full bg-clinic-bg px-2 py-1"><Camera size={11} /> Galeria visual</span>
                <span className="flex items-center gap-1 rounded-full bg-clinic-bg px-2 py-1"><Film size={11} /> Pronta para vídeos</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {dateRecords.map(record => <ActivityRecordCard key={record.id} record={record} selectMode={selectMode} selected={selectedIds.has(record.id)} onToggleSelect={() => toggleRecordSelection(record.id)} onView={() => setViewRecord(record)} onEdit={() => openEdit(record)} onDelete={() => setDeleteRecord(record)} />)}
            </div>
          </section>
        );
      })}
    </div>

    <ActivityRecordModal isOpen={newOpen} onClose={() => setNewOpen(false)} onViewGallery={returnToGallery} patient={patient} sessions={sessions} currentUserName={currentUserName} />
    <ActivityRecordViewer record={viewRecord} onClose={returnToGallery} />


    <Modal isOpen={authorizationHelpOpen} onClose={() => setAuthorizationHelpOpen(false)} title="Registro de atividade bloqueado" width="max-w-md">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-status-orange-text/25 bg-status-orange-bg p-4 text-status-orange-text">
          <LockKeyhole className="mt-0.5 shrink-0" size={20} />
          <p className="text-sm font-bold">{authorizationMessage}</p>
        </div>
        <p className="text-sm text-clinic-text-muted">A câmera e a galeria permanecem bloqueadas até que a autorização seja definida em Dados Cadastrais.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setAuthorizationHelpOpen(false)} className="rounded-lg bg-clinic-bg px-4 py-2.5 text-xs font-bold text-clinic-text-muted">Fechar</button>
          {onOpenAuthorization && <button type="button" onClick={() => { setAuthorizationHelpOpen(false); onOpenAuthorization(); }} className="rounded-lg bg-clinic-primary px-4 py-2.5 text-xs font-bold text-white">Ver autorização no cadastro</button>}
        </div>
      </div>
    </Modal>

    <Modal isOpen={!!editRecord} onClose={() => !busy && setEditRecord(null)} title="Editar informações" width="max-w-lg"><div className="space-y-4"><select value={editCategory} onChange={e => setEditCategory(e.target.value as ActivityRecordCategory)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm">{ACTIVITY_RECORD_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select><textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} className="min-h-28 w-full rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm" /><select value={editVisibility} onChange={e => setEditVisibility(e.target.value as ActivityRecordVisibility)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm"><option value="internal_only">Somente interno</option>{authorization.guardianSharingStatus === 'authorized' && <option value="share_allowed">Pode ser compartilhado</option>}</select><div className="flex justify-end gap-2"><button disabled={busy} onClick={() => setEditRecord(null)} className="rounded-lg bg-clinic-bg px-4 py-2 text-xs font-bold">Cancelar</button><button disabled={busy} onClick={() => void saveEdit()} className="rounded-lg bg-clinic-primary px-4 py-2 text-xs font-bold text-white">{busy ? 'Salvando...' : 'Salvar'}</button></div></div></Modal>
    <Modal isOpen={!!deleteRecord} onClose={() => !busy && setDeleteRecord(null)} title="Excluir registro" width="max-w-md"><div className="space-y-5"><p className="text-sm text-clinic-text">A mídia será removida do Google Drive e o registro será excluído. Esta ação não altera a sessão, presença ou pagamentos.</p><div className="flex justify-end gap-2"><button disabled={busy} onClick={() => setDeleteRecord(null)} className="rounded-lg bg-clinic-bg px-4 py-2 text-xs font-bold">Cancelar</button><button disabled={busy} onClick={() => void confirmDelete()} className="rounded-lg bg-status-red-text px-4 py-2 text-xs font-bold text-white">{busy ? 'Excluindo...' : 'Excluir'}</button></div></div></Modal>
    <Modal isOpen={bulkDeleteOpen} onClose={() => !busy && setBulkDeleteOpen(false)} title="Excluir mídias selecionadas" width="max-w-md"><div className="space-y-5"><p className="text-sm text-clinic-text">Você selecionou <strong>{selectedRecords.length}</strong> {selectedRecords.length === 1 ? 'mídia' : 'mídias'}. Elas serão removidas do Google Drive e os registros serão excluídos. Esta ação não altera sessão, presença ou pagamentos.</p><div className="flex justify-end gap-2"><button disabled={busy} onClick={() => setBulkDeleteOpen(false)} className="rounded-lg bg-clinic-bg px-4 py-2 text-xs font-bold">Cancelar</button><button disabled={busy || selectedRecords.length === 0} onClick={() => void confirmBulkDelete()} className="rounded-lg bg-status-red-text px-4 py-2 text-xs font-bold text-white">{busy ? 'Excluindo...' : `Excluir ${selectedRecords.length}`}</button></div></div></Modal>
  </div>;
}
