import { CheckCircle2, CircleAlert, Flag, MessageCircle, UserRound } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { SimulationConversation, SimulationProfessional, SimulationTag } from '../../simulationTypes';

interface ConversationListProps {
  conversations: SimulationConversation[];
  selectedConversationId: string;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  onSelect: (conversationId: string) => void;
}

function stateLabel(state: SimulationConversation['state']): string {
  return {
    nova: 'Nova',
    aberta: 'Aberta',
    aguardando_equipe: 'Aguardando equipe',
    aguardando_contato: 'Aguardando contato',
    finalizada: 'Finalizada',
    reaberta: 'Reaberta',
  }[state];
}

export function ConversationList({ conversations, selectedConversationId, professionals, tags, onSelect }: ConversationListProps) {
  return (
    <div className="space-y-2">
      {conversations.length === 0 && <div className="rounded-xl border border-dashed border-clinic-border px-4 py-8 text-center text-xs text-clinic-text-muted">Nenhuma conversa sintética corresponde aos filtros.</div>}
      {conversations.map(conversation => {
        const professional = professionals.find(item => item.id === conversation.assignedProfessionalId);
        return (
          <button key={conversation.id} type="button" onClick={() => onSelect(conversation.id)} className={cn('w-full rounded-2xl border p-3 text-left transition hover:border-clinic-primary/40 hover:bg-clinic-bg', conversation.id === selectedConversationId ? 'border-clinic-primary/40 bg-clinic-primary/5 shadow-sm' : 'border-clinic-border bg-white')}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-clinic-primary/10 text-xs font-black text-clinic-primary">{conversation.title.slice(-3)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-clinic-text">{conversation.title}</strong><span className="shrink-0 text-[10px] font-bold text-clinic-text-faint">{conversation.lastActivity}</span></span>
                <span className="mt-1 block truncate text-xs text-clinic-text-muted">{conversation.preview}</span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-clinic-bg px-2 py-1 text-[10px] font-black text-clinic-text-muted"><MessageCircle size={11} /> {stateLabel(conversation.state)}</span>
                  {conversation.priority === 'alta' && <span className="inline-flex items-center gap-1 rounded-full bg-status-red-bg px-2 py-1 text-[10px] font-black text-status-red-text"><Flag size={11} /> Alta</span>}
                  {conversation.unreadCount > 0 && <span className="rounded-full bg-clinic-primary px-2 py-1 text-[10px] font-black text-white">{conversation.unreadCount} nova(s)</span>}
                  {conversation.messages.some(message => message.status === 'simulated_failed') && <span className="inline-flex items-center gap-1 rounded-full bg-status-red-bg px-2 py-1 text-[10px] font-black text-status-red-text"><CircleAlert size={11} /> Falha</span>}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-clinic-text-faint">
                  <span className="inline-flex items-center gap-1"><UserRound size={11} /> {professional?.displayName || 'Não atribuído'}</span>
                  {conversation.tagIds.map(tagId => { const tag = tags.find(item => item.id === tagId); return tag ? <span key={tag.id} className="rounded-full border border-clinic-border px-2 py-0.5">{tag.label}</span> : null; })}
                </span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
