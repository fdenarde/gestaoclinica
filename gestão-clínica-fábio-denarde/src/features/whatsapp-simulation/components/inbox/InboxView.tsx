import type { SimulationCategory, SimulationComposerState, SimulationConversation, SimulationFilters, SimulationPreview, SimulationProfessional, SimulationProfileId, SimulationQuickReply, SimulationTag, SimulationTemplate, SimulationTenantId } from '../../simulationTypes';
import { ConversationCategories } from './ConversationCategories';
import { ConversationFilters } from './ConversationFilters';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { ContactPanel } from './ContactPanel';

interface InboxViewProps {
  tenantId: SimulationTenantId;
  profileId: SimulationProfileId;
  filters: SimulationFilters;
  counts: Record<SimulationCategory, number>;
  visibleConversations: SimulationConversation[];
  selectedConversation: SimulationConversation | null;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  quickReplies: SimulationQuickReply[];
  templates: SimulationTemplate[];
  composition: SimulationComposerState;
  preview: SimulationPreview | null;
  shouldFail: boolean;
  noteDraft: string;
  onCategoryChange: (category: SimulationCategory) => void;
  onFiltersChange: (filters: Partial<SimulationFilters>) => void;
  onClearFilters: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDraftChange: (value: string) => void;
  onShouldFailChange: (value: boolean) => void;
  onNoteDraftChange: (value: string) => void;
  onModeChange: (mode: SimulationComposerState['mode']) => void;
  onQuickReplyChange: (quickReplyId: string) => void;
  onTemplateChange: (templateId: string) => void;
  onPreview: () => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
  onAdvance: () => void;
  onCancel: () => void;
  onFinalize: () => void;
  onReopen: () => void;
  onSyntheticInbound: () => void;
  onCreateNote: () => void;
  onAssign: (professionalId: string | null) => void;
  onPriorityChange: (priority: 'normal' | 'alta') => void;
  onToggleTag: (tagId: string) => void;
}

export function InboxView({ tenantId, profileId, filters, counts, visibleConversations, selectedConversation, professionals, tags, quickReplies, templates, composition, preview, shouldFail, noteDraft, onCategoryChange, onFiltersChange, onClearFilters, onSelectConversation, onDraftChange, onModeChange, onQuickReplyChange, onTemplateChange, onPreview, onConfirmPreview, onCancelPreview, onShouldFailChange, onNoteDraftChange, onAdvance, onCancel, onFinalize, onReopen, onSyntheticInbound, onCreateNote, onAssign, onPriorityChange, onToggleTag }: InboxViewProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <aside className="space-y-4 rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic">
        <div className="border-b border-clinic-border pb-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Caixa de entrada</p><h2 className="mt-1 text-lg font-black text-clinic-text">Conversas simuladas</h2><p className="mt-1 text-xs text-clinic-text-muted">{tenantId} · {visibleConversations.length} visíveis</p></div>
        <ConversationCategories activeCategory={filters.category} counts={counts} onChange={onCategoryChange} />
        <ConversationFilters filters={filters} professionals={professionals} tags={tags} onChange={onFiltersChange} onClear={onClearFilters} />
      </aside>

      <section className="min-w-0 rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Lista ordenada</p><h2 className="mt-1 text-lg font-black text-clinic-text">Prioridade, não lidas e atividade</h2></div><span className="rounded-full bg-clinic-bg px-3 py-1.5 text-[10px] font-black text-clinic-text-muted">{visibleConversations.length} conversa(s)</span></div><ConversationList conversations={visibleConversations} selectedConversationId={selectedConversation?.id || ''} professionals={professionals} tags={tags} onSelect={onSelectConversation} /></section>

      {selectedConversation ? <ConversationView conversation={selectedConversation} profileId={profileId} professionals={professionals} tags={tags} quickReplies={quickReplies} templates={templates} composition={composition} preview={preview} shouldFail={shouldFail} noteDraft={noteDraft} onDraftChange={onDraftChange} onModeChange={onModeChange} onQuickReplyChange={onQuickReplyChange} onTemplateChange={onTemplateChange} onShouldFailChange={onShouldFailChange} onNoteDraftChange={onNoteDraftChange} onPreview={onPreview} onConfirmPreview={onConfirmPreview} onCancelPreview={onCancelPreview} onAdvance={onAdvance} onCancel={onCancel} onFinalize={onFinalize} onReopen={onReopen} onSyntheticInbound={onSyntheticInbound} onCreateNote={onCreateNote} onAssign={onAssign} onPriorityChange={onPriorityChange} onToggleTag={onToggleTag} /> : <section className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-clinic-border bg-clinic-surface p-8 text-center text-sm text-clinic-text-muted">Selecione uma conversa sintética para abrir o atendimento.</section>}

      {selectedConversation && <ContactPanel conversation={selectedConversation} profileId={profileId} professionals={professionals} tags={tags} onAssign={onAssign} onPriorityChange={onPriorityChange} onToggleTag={onToggleTag} />}
    </div>
  );
}
