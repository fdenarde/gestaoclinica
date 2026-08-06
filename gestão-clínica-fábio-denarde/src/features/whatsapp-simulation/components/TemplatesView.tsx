import { CheckCircle2, Copy, Eye, FilePlus2, FlaskConical, Pencil, Play, Power, Search, XCircle } from 'lucide-react';
import { useState } from 'react';
import { hasSimulationPermission } from '../domain/permissionPolicy';
import { SIMULATION_TEMPLATE_VARIABLES } from '../domain/templateValidation';
import type {
  SimulationPreview,
  SimulationProfileId,
  SimulationQuickReply,
  SimulationTemplate,
  SimulationTemplateCategory,
  SimulationTemplateDraft,
  SimulationTemplateFilters,
  SimulationTemplateStatus,
  SimulationTemplateVariable,
  SimulationTenant,
} from '../simulationTypes';

const categories: SimulationTemplateCategory[] = ['atendimento', 'confirmação', 'reagendamento', 'cancelamento', 'retorno', 'administrativo', 'pós-atendimento'];
const statuses: SimulationTemplateStatus[] = ['draft', 'active', 'inactive'];
const statusLabels: Record<SimulationTemplateStatus, string> = { draft: 'Draft', active: 'Ativo', inactive: 'Inativo' };

const emptyDraft: SimulationTemplateDraft = {
  name: '',
  description: '',
  category: 'atendimento',
  content: '',
  allowedVariables: [],
};

interface TemplatesViewProps {
  tenant: SimulationTenant;
  profileId: SimulationProfileId;
  templates: SimulationTemplate[];
  quickReplies: SimulationQuickReply[];
  filters: SimulationTemplateFilters;
  selectedTemplate: SimulationTemplate | null;
  draft: SimulationTemplateDraft | null;
  editingTemplateId: string;
  preview: SimulationPreview | null;
  onFiltersChange: (filters: Partial<SimulationTemplateFilters>) => void;
  onClearFilters: () => void;
  onSelectTemplate: (templateId: string) => void;
  onUseQuickReply: (quickReplyId: string) => void;
  onUseTemplate: (templateId: string) => void;
  onBeginDraft: (templateId?: string) => void;
  onDraftChange: (draft: SimulationTemplateDraft) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  onDuplicate: (templateId: string) => void;
  onActivate: (templateId: string) => void;
  onDeactivate: (templateId: string) => void;
  onTestTemplate: (templateId: string, values: Partial<Record<SimulationTemplateVariable, string>>) => void;
  onConfirmPreview: () => void;
  onCancelPreview: () => void;
}

function statusClass(status: SimulationTemplateStatus): string {
  if (status === 'active') return 'bg-status-green-bg text-status-green-text';
  if (status === 'inactive') return 'bg-clinic-bg text-clinic-text-muted';
  return 'bg-amber-100 text-amber-800';
}

function defaultValues(): Partial<Record<SimulationTemplateVariable, string>> {
  return {
    contato_nome: 'Contato Fictício 001',
    profissional_nome: 'Profissional Simulado A',
    tenant_nome: 'Tenant sintético',
    data_ficticia: '2026-03-20',
    horario_ficticio: '14:30',
  };
}

export function TemplatesView({ tenant, profileId, templates, quickReplies, filters, selectedTemplate, draft, editingTemplateId, preview, onFiltersChange, onClearFilters, onSelectTemplate, onUseQuickReply, onUseTemplate, onBeginDraft, onDraftChange, onSaveDraft, onCancelDraft, onDuplicate, onActivate, onDeactivate, onTestTemplate, onConfirmPreview, onCancelPreview }: TemplatesViewProps) {
  const canManage = hasSimulationPermission(profileId, 'manage_templates');
  const canUse = hasSimulationPermission(profileId, 'use_template');
  const canTest = hasSimulationPermission(profileId, 'test_template');
  const [testValues, setTestValues] = useState(defaultValues);
  const [testing, setTesting] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const updateDraft = (patch: Partial<SimulationTemplateDraft>) => onDraftChange({ ...(draft || emptyDraft), ...patch });
  const toggleVariable = (variable: SimulationTemplateVariable) => {
    const current = draft || emptyDraft;
    const allowedVariables = current.allowedVariables.includes(variable)
      ? current.allowedVariables.filter(item => item !== variable)
      : [...current.allowedVariables, variable];
    updateDraft({ allowedVariables });
  };

  return (
    <main className="space-y-4" data-testid="whatsapp-simulation-templates">
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Templates fictícios · somente memória</p>
            <h2 className="mt-1 text-2xl font-black text-clinic-text">Templates</h2>
            <p className="mt-1 text-sm text-clinic-text-muted">Tenant ativo: <strong>{tenant.label}</strong>. Status, versões e testes são exclusivamente simulados.</p>
          </div>
          {canManage && <button type="button" onClick={() => onBeginDraft()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase tracking-wide text-white"><FilePlus2 size={16} /> Criar template</button>}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(150px,0.6fr))_auto]">
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Pesquisar por nome</span><span className="flex items-center gap-2 rounded-xl border border-clinic-border bg-clinic-bg px-3"><Search size={15} className="text-clinic-text-faint" /><input value={filters.search} onChange={event => onFiltersChange({ search: event.target.value })} className="w-full bg-transparent py-2.5 text-sm text-clinic-text outline-none" placeholder="Nome ou descrição sintética" /></span></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Categoria</span><select value={filters.category} onChange={event => onFiltersChange({ category: event.target.value as SimulationTemplateCategory | '' })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm"><option value="">Todas</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Status</span><select value={filters.status} onChange={event => onFiltersChange({ status: event.target.value as SimulationTemplateStatus | '' })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm"><option value="">Todos</option>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          <button type="button" onClick={onClearFilters} className="self-end rounded-xl border border-clinic-border px-3 py-2.5 text-xs font-black text-clinic-text-muted">Limpar filtros</button>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 shadow-clinic">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Respostas rápidas fictícias</p><h3 className="mt-1 text-lg font-black text-clinic-text">Atalhos de composição</h3></div><span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase text-violet-700">Não são templates</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{quickReplies.map(reply => <article key={reply.id} className="rounded-xl border border-violet-200 bg-white p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-black text-clinic-text">{reply.title}</p><span className={reply.status === 'active' ? 'rounded-full bg-status-green-bg px-2 py-1 text-[9px] font-black uppercase text-status-green-text' : 'rounded-full bg-clinic-bg px-2 py-1 text-[9px] font-black uppercase text-clinic-text-muted'}>{reply.status === 'active' ? 'Ativa' : 'Inativa'}</span></div><p className="mt-2 text-xs leading-relaxed text-clinic-text-muted">{reply.content}</p>{reply.status === 'active' && <button type="button" disabled={!canUse} onClick={() => onUseQuickReply(reply.id)} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-violet-300 px-2.5 py-2 text-[10px] font-black uppercase text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"><Play size={12} /> Usar resposta rápida</button>}</article>)}</div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <div className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Biblioteca do tenant</p><h3 className="mt-1 text-lg font-black text-clinic-text">Templates fictícios</h3></div><span className="text-xs font-bold text-clinic-text-muted">{templates.length} resultado(s)</span></div><div className="mt-4 space-y-2">{templates.map(template => <button key={template.id} type="button" onClick={() => onSelectTemplate(template.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedTemplate?.id === template.id ? 'border-clinic-primary bg-clinic-primary/5' : 'border-clinic-border bg-white hover:bg-clinic-bg'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-black text-clinic-text">{template.name}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusClass(template.status)}`}>{statusLabels[template.status]}</span></div><div className="mt-2 flex flex-wrap gap-2 text-[10px] text-clinic-text-muted"><span>{template.category}</span><span>v{template.version}</span><span>Atualização: {template.updatedAt}</span></div><p className="mt-2 line-clamp-2 text-xs text-clinic-text-muted">{template.description}</p></button>)}{templates.length === 0 && <p className="rounded-xl bg-clinic-bg p-4 text-sm text-clinic-text-muted">Nenhum template corresponde aos filtros.</p>}</div></div>

        <div className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
          {selectedTemplate ? <><div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-text-faint">Detalhes do template</p><h3 className="mt-1 text-lg font-black text-clinic-text">{selectedTemplate.name}</h3></div><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusClass(selectedTemplate.status)}`}>{statusLabels[selectedTemplate.status]}</span></div><p className="mt-3 text-sm leading-relaxed text-clinic-text-muted">{selectedTemplate.description}</p><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-clinic-bg p-3 text-xs leading-relaxed text-clinic-text">{selectedTemplate.content}</pre><div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-clinic-text-muted"><span>Categoria: {selectedTemplate.category}</span><span>Versão: {selectedTemplate.version}</span><span>Variáveis: {selectedTemplate.allowedVariables.length ? selectedTemplate.allowedVariables.join(', ') : 'nenhuma'}</span></div><div className="mt-4 flex flex-wrap gap-2">{selectedTemplate.status === 'active' && <button type="button" disabled={!canUse} onClick={() => onUseTemplate(selectedTemplate.id)} className="inline-flex items-center gap-1 rounded-lg bg-clinic-primary px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"><Play size={12} /> Usar no compositor</button>}{canTest && <button type="button" disabled={selectedTemplate.status !== 'active'} onClick={() => setTesting(true)} className="inline-flex items-center gap-1 rounded-lg border border-clinic-primary/30 px-3 py-2 text-[10px] font-black uppercase text-clinic-primary disabled:opacity-50"><FlaskConical size={12} /> Testar template</button>}{canManage && selectedTemplate.status === 'draft' && <button type="button" onClick={() => onBeginDraft(selectedTemplate.id)} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted"><Pencil size={12} /> Editar draft</button>}{canManage && <button type="button" onClick={() => onDuplicate(selectedTemplate.id)} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted"><Copy size={12} /> Duplicar</button>}{canManage && selectedTemplate.status === 'draft' && <button type="button" onClick={() => onActivate(selectedTemplate.id)} className="inline-flex items-center gap-1 rounded-lg border border-status-green-text/30 px-3 py-2 text-[10px] font-black uppercase text-status-green-text"><Power size={12} /> Ativar</button>}{canManage && selectedTemplate.status === 'active' && <button type="button" onClick={() => onDeactivate(selectedTemplate.id)} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-2 text-[10px] font-black uppercase text-amber-800"><Power size={12} /> Desativar</button>}<button type="button" onClick={() => setShowVersions(value => !value)} className="inline-flex items-center gap-1 rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted"><Eye size={12} /> Visualizar versões</button></div>{showVersions && <div className="mt-3 rounded-xl bg-clinic-bg p-3 text-xs text-clinic-text-muted">Versão atual: <strong>v{selectedTemplate.version}</strong>{selectedTemplate.sourceTemplateId && <> · origem: <strong>{selectedTemplate.sourceTemplateId}</strong></>}</div>}
            {testing && <div className="mt-4 rounded-xl border border-clinic-primary/20 bg-clinic-primary/5 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-clinic-primary">Valores fictícios para teste</p>{selectedTemplate.allowedVariables.map(variable => <label key={variable} className="mt-2 block"><span className="mb-1 block text-[10px] font-black text-clinic-text-muted">{'{{'}{variable}{'}}'}</span><input value={testValues[variable] || ''} onChange={event => setTestValues(values => ({ ...values, [variable]: event.target.value }))} className="w-full rounded-lg border border-clinic-border bg-white px-3 py-2 text-xs outline-none" /></label>)}<div className="mt-3 flex gap-2"><button type="button" onClick={() => onTestTemplate(selectedTemplate.id, testValues)} className="rounded-lg bg-clinic-primary px-3 py-2 text-[10px] font-black uppercase text-white">Pré-visualizar teste</button><button type="button" onClick={() => setTesting(false)} className="rounded-lg border border-clinic-border px-3 py-2 text-[10px] font-black uppercase text-clinic-text-muted">Cancelar</button></div></div>}
          </> : <div className="flex min-h-[260px] flex-col items-center justify-center text-center"><Eye size={28} className="text-clinic-text-faint" /><p className="mt-3 text-sm font-black text-clinic-text">Selecione um template fictício</p><p className="mt-1 text-xs text-clinic-text-muted">O painel mostra conteúdo, versão, variáveis e ações autorizadas.</p></div>}
        </div>
      </section>

      {preview && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-clinic"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-800">Pré-visualização do teste</p><h3 className="mt-1 text-lg font-black text-amber-950">Nada será enviado</h3><div className="mt-3 grid gap-2 text-xs text-amber-900 sm:grid-cols-2"><p>Tenant: <strong>{preview.tenantName}</strong></p><p>Contato: <strong>{preview.contactName}</strong></p><p>Profissional: <strong>{preview.professionalName}</strong></p><p>Origem: <strong>{preview.sourceLabel}{preview.templateVersion ? ` · v${preview.templateVersion}` : ''}</strong></p></div><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-relaxed text-clinic-text">{preview.content}</pre><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onConfirmPreview} className="inline-flex items-center gap-2 rounded-lg bg-clinic-primary px-3 py-2 text-xs font-black uppercase text-white"><CheckCircle2 size={14} /> Confirmar registro simulado</button><button type="button" onClick={onCancelPreview} className="inline-flex items-center gap-2 rounded-lg border border-clinic-border px-3 py-2 text-xs font-black uppercase text-clinic-text-muted"><XCircle size={14} /> Cancelar</button></div></section>}

      {draft && canManage && <section className="rounded-2xl border border-clinic-primary/30 bg-white p-5 shadow-clinic"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">{editingTemplateId ? 'Editar template draft' : 'Novo template draft'}</p><h3 className="mt-1 text-lg font-black text-clinic-text">Composição administrativa fictícia</h3></div><button type="button" onClick={onCancelDraft} className="rounded-lg border border-clinic-border p-2 text-clinic-text-muted"><XCircle size={16} /></button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Nome</span><input value={draft.name} onChange={event => updateDraft({ name: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm" /></label><label><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Categoria</span><select value={draft.category} onChange={event => updateDraft({ category: event.target.value as SimulationTemplateCategory })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm">{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label><label className="md:col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Descrição</span><input value={draft.description} onChange={event => updateDraft({ description: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm" /></label><label className="md:col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Conteúdo textual</span><textarea value={draft.content} onChange={event => updateDraft({ content: event.target.value })} rows={4} className="w-full resize-y rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm" placeholder="Use somente variáveis sintéticas permitidas." /></label></div><div className="mt-3"><p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Variáveis permitidas</p><div className="mt-2 flex flex-wrap gap-2">{SIMULATION_TEMPLATE_VARIABLES.map(variable => <label key={variable} className="inline-flex items-center gap-2 rounded-lg bg-clinic-bg px-2.5 py-2 text-xs text-clinic-text-muted"><input type="checkbox" checked={draft.allowedVariables.includes(variable)} onChange={() => toggleVariable(variable)} /> {'{{'}{variable}{'}}'}</label>)}</div></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onSaveDraft} className="rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase text-white">Salvar draft na memória</button><button type="button" onClick={onCancelDraft} className="rounded-xl border border-clinic-border px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">Cancelar</button></div></section>}
    </main>
  );
}
