import { LockKeyhole, Plus, StickyNote } from 'lucide-react';
import { hasSimulationPermission } from '../../domain/permissionPolicy';
import type { SimulationNote, SimulationProfileId } from '../../simulationTypes';

interface InternalNotesProps {
  notes: SimulationNote[];
  profileId: SimulationProfileId;
  draft: string;
  onDraftChange: (value: string) => void;
  onCreate: () => void;
}

export function InternalNotes({ notes, profileId, draft, onDraftChange, onCreate }: InternalNotesProps) {
  const canCreate = hasSimulationPermission(profileId, 'create_note');
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-black text-violet-950"><StickyNote size={17} /> Notas internas</h3><p className="mt-1 flex items-center gap-1 text-[10px] text-violet-800"><LockKeyhole size={11} /> Não visíveis ao contato e guardadas somente na memória.</p></div>
        <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-800">{notes.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {notes.length === 0 && <p className="rounded-xl border border-dashed border-violet-200 bg-white/60 px-3 py-3 text-xs text-violet-800">Nenhuma nota interna nesta conversa.</p>}
        {notes.map(note => <article key={note.id} className="rounded-xl border border-violet-200 bg-white px-3 py-2.5"><p className="text-xs leading-relaxed text-violet-950">{note.content}</p><p className="mt-2 text-[10px] font-bold text-violet-700">{note.author} · {note.time} · {note.id}</p></article>)}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1"><span className="sr-only">Nova nota interna simulada</span><textarea value={draft} disabled={!canCreate} onChange={event => onDraftChange(event.target.value)} rows={2} placeholder="Registrar uma observação interna fictícia..." className="w-full resize-none rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-xs text-violet-950 outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60" /></label>
        <button type="button" disabled={!canCreate || !draft.trim()} onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2.5 text-[10px] font-black uppercase text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={14} /> Criar nota</button>
      </div>
    </section>
  );
}
