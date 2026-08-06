import { Check, CircleUserRound, Flag, LockKeyhole, Tag, UserRound } from 'lucide-react';
import { hasSimulationPermission } from '../../domain/permissionPolicy';
import type { SimulationConversation, SimulationProfessional, SimulationProfileId, SimulationTag } from '../../simulationTypes';

interface ContactPanelProps {
  conversation: SimulationConversation;
  profileId: SimulationProfileId;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  onAssign: (professionalId: string | null) => void;
  onPriorityChange: (priority: 'normal' | 'alta') => void;
  onToggleTag: (tagId: string) => void;
}

export function ContactPanel({ conversation, profileId, professionals, tags, onAssign, onPriorityChange, onToggleTag }: ContactPanelProps) {
  const canAssign = hasSimulationPermission(profileId, 'assign_professional');
  const canChangePriority = hasSimulationPermission(profileId, 'change_priority');
  const canManageTags = hasSimulationPermission(profileId, 'manage_tags');
  return (
    <aside className="space-y-4 rounded-2xl border border-clinic-border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2"><CircleUserRound className="text-clinic-primary" size={18} /><h3 className="text-sm font-black text-clinic-text">Contato sintético</h3></div>
      <div>
        <p className="text-base font-black text-clinic-text">{conversation.contact.displayName}</p>
        <p className="mt-1 text-xs text-clinic-text-muted">{conversation.contact.id} · {conversation.contact.reference}</p>
      </div>
      <dl className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3"><dt className="text-clinic-text-faint">Vínculo</dt><dd className="text-right font-bold text-clinic-text-muted">{conversation.contact.relationship}</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-clinic-text-faint">Preferência</dt><dd className="text-right font-bold text-clinic-text-muted">{conversation.contact.contactPreference}</dd></div>
        <div className="flex items-start justify-between gap-3"><dt className="text-clinic-text-faint">Consentimento</dt><dd className="text-right font-bold text-clinic-text-muted">{conversation.contact.consentStatus}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-clinic-text-faint">Opt-out</dt><dd className={conversation.contact.optOut ? 'font-black text-status-red-text' : 'font-black text-status-green-text'}>{conversation.contact.optOut ? 'Simulado ativo' : 'Não solicitado'}</dd></div>
      </dl>

      <div className="border-t border-clinic-border pt-4">
        <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-clinic-text-faint"><UserRound size={12} /> Profissional responsável</label>
        <select value={conversation.assignedProfessionalId || ''} disabled={!canAssign} onChange={event => onAssign(event.target.value || null)} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-bold text-clinic-text-muted outline-none focus:border-clinic-primary disabled:cursor-not-allowed disabled:opacity-60">
          <option value="">Não atribuído</option>
          {professionals.map(professional => <option key={professional.id} value={professional.id}>{professional.displayName}</option>)}
        </select>
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-clinic-text-faint"><Flag size={12} /> Prioridade</label>
        <div className="grid grid-cols-2 gap-2">
          {(['normal', 'alta'] as const).map(priority => <button key={priority} type="button" disabled={!canChangePriority} onClick={() => onPriorityChange(priority)} className={conversation.priority === priority ? 'rounded-xl bg-clinic-primary px-2 py-2 text-[10px] font-black uppercase text-white' : 'rounded-xl border border-clinic-border px-2 py-2 text-[10px] font-black uppercase text-clinic-text-muted disabled:cursor-not-allowed disabled:opacity-60'}>{priority}</button>)}
        </div>
      </div>

      <div>
        <label className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-clinic-text-faint"><Tag size={12} /> Etiquetas fictícias</label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => {
            const active = conversation.tagIds.includes(tag.id);
            return <button key={tag.id} type="button" disabled={!canManageTags} onClick={() => onToggleTag(tag.id)} className={active ? 'rounded-full bg-clinic-primary px-2.5 py-1.5 text-[10px] font-black text-white' : 'rounded-full border border-clinic-border px-2.5 py-1.5 text-[10px] font-bold text-clinic-text-muted disabled:cursor-not-allowed disabled:opacity-60'}>{active && <Check size={10} className="mr-1 inline" />}{tag.label}</button>;
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-clinic-bg px-3 py-2 text-[10px] leading-relaxed text-clinic-text-muted"><LockKeyhole size={13} className="mt-0.5 shrink-0 text-clinic-primary" /> Este contato é exclusivamente fictício. Não há dados reais neste painel.</div>
    </aside>
  );
}
