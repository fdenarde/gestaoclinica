import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleCheck, Clock3, Edit3, FileText, Link2, MessageCircle, Pencil, Plus, RefreshCw, Send, Smartphone, Trash2, X } from 'lucide-react';
import { composeTemplateContent, createDefaultTemplatePresentation } from '../domain/templatePresentation';
import type { SimulationComposerState, SimulationConversation, SimulationPreview, SimulationState, SimulationTemplate, SimulationTemplateDraft, SimulationTemplatePresentation, SimulationTenantData, SimulationView } from '../simulationTypes';
import type { SimulationSchedule, SimulationScheduleEdit, SimulationSchedulePreview } from '../scheduleTypes';

type SimpleWhen = 'now' | 'scheduled';
type WizardStep = 1 | 2 | 3 | 4;

interface SimpleSimulationViewProps {
  state: SimulationState;
  tenant: SimulationTenantData;
  conversations: SimulationConversation[];
  templates: SimulationTemplate[];
  schedules: SimulationSchedule[];
  resolveTemplatePreview: (content: string) => string;
  connected: boolean;
  resetVersion: number;
  onNavigate: (view: SimulationView) => void;
  onSelectConversation: (conversationId: string) => void;
  onCompositionChange: (composition: SimulationComposerState) => void;
  onDraftChange: (value: string) => void;
  onUseTemplate: (templateId: string) => void;
  onPreviewMessage: (when: SimpleWhen, scheduledAt?: string) => void;
  onConfirmMessage: () => void;
  onConfirmSchedule: () => void;
  onCancelPreview: () => void;
  onCancelSchedule: (scheduleId: string) => void;
  onEditSchedule: (scheduleId: string, edit: SimulationScheduleEdit) => void;
  onRetrySchedule: (scheduleId: string) => void;
  templateDraft: SimulationTemplateDraft | null;
  templateEditingId: string;
  onBeginTemplate: (templateId?: string) => void;
  onEditTemplate: (templateId: string) => void;
  onTemplateDraftChange: (draft: SimulationTemplateDraft) => void;
  onSaveTemplate: () => void;
  onCancelTemplate: () => void;
  onActivateTemplate: (templateId: string) => void;
  onDeactivateTemplate: (templateId: string) => void;
}

function inputDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function inputTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(value));
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', timeStyle: 'short' }).format(new Date(value));
}

function contactLabel(value: string): string {
  const cleaned = value.replace(/fictício/gi, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || 'Contato';
}

function maskedPhone(index: number): string {
  return `Telefone • final ${String(index + 1).padStart(4, '0')}`;
}

function statusLabel(status: SimulationSchedule['status']): string {
  if (status === 'completed') return 'Concluída';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'failed' || status === 'expired') return 'Falhou';
  return 'Agendada';
}

function templateStatusLabel(status: SimulationTemplate['status']): string {
  return status === 'active' ? 'Ativa' : 'Desativada';
}

function statusClasses(status: SimulationSchedule['status']): string {
  if (status === 'completed') return 'border-status-green-text/20 bg-status-green-bg text-status-green-text';
  if (status === 'failed' || status === 'expired') return 'border-status-red-text/20 bg-status-red-bg text-status-red-text';
  if (status === 'cancelled') return 'border-clinic-border bg-clinic-bg text-clinic-text-muted';
  return 'border-clinic-primary/20 bg-clinic-primary/5 text-clinic-primary';
}

function templateClasses(status: SimulationTemplate['status']): string {
  return status === 'active' ? 'border-status-green-text/20 bg-status-green-bg text-status-green-text' : 'border-clinic-border bg-clinic-bg text-clinic-text-muted';
}

function SectionHeading({ icon: Icon, eyebrow, title, description }: { icon: typeof Smartphone; eyebrow?: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-clinic-primary/10 text-clinic-primary" aria-hidden="true"><Icon size={20} /></span>
      <div className="min-w-0">
        {eyebrow && eyebrow.toLowerCase() !== title.toLowerCase() && <p className="text-xs font-black uppercase tracking-[0.14em] text-clinic-primary">{eyebrow}</p>}
        <h2 className="mt-0.5 text-lg font-black text-clinic-text sm:text-xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-clinic-text-muted">{description}</p>
      </div>
    </div>
  );
}

function PrimaryButton({ children, onClick, type = 'button', disabled = false }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return <button type={type} onClick={onClick} disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-clinic-primary-hover focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}

function SecondaryButton({ children, onClick, type = 'button', disabled = false }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return <button type={type} onClick={onClick} disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-clinic-border bg-clinic-surface px-4 py-3 text-sm font-bold text-clinic-text-muted transition hover:border-clinic-primary hover:bg-clinic-bg focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}

function ProgressIndicator({ step }: { step: WizardStep }) {
  const labels = ['Para quem?', 'Mensagem', 'Quando?', 'Conferir'];
  return (
    <div className="rounded-xl border border-clinic-border bg-clinic-bg/60 px-3 py-3 sm:px-4" data-testid="message-progress">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black text-clinic-text">
        <span>Etapa {step} de 4</span><span className="text-clinic-primary">{labels[step - 1]}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={`Etapa ${step} de 4`}>
        {labels.map((label, index) => <span key={label} className={`h-1.5 rounded-full ${index < step ? 'bg-clinic-primary' : 'bg-clinic-border'}`} title={label} />)}
      </div>
    </div>
  );
}

function MyWhatsApp({ connected, onNavigate }: Pick<SimpleSimulationViewProps, 'connected' | 'onNavigate'>) {
  return (
    <section className="space-y-5" data-testid="simple-my-whatsapp">
      <SectionHeading icon={Smartphone} title="Meu WhatsApp" description="Confira o estado da conexão usada nesta demonstração." />
      <div className="clinic-card p-4 sm:p-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Status</dt><dd className="mt-1 flex items-center gap-2 font-black text-clinic-text">{connected ? <CheckCircle2 size={17} className="text-status-green-text" /> : <Clock3 size={17} className="text-clinic-text-faint" />}{connected ? 'Conectado' : 'Não conectado'}</dd></div>
          <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Telefone</dt><dd className="mt-1 font-semibold text-clinic-text-muted">Telefone • final 0001</dd></div>
        </dl>
      </div>
      <div className="flex justify-end"><SecondaryButton onClick={() => onNavigate('new_message')}>Ir para Nova mensagem <ChevronRight size={16} aria-hidden="true" /></SecondaryButton></div>
    </section>
  );
}

function MessagePreview({ preview, scheduledPreview, phone, onBack, onConfirm, onCancel }: { preview: SimulationPreview | null; scheduledPreview: SimulationSchedulePreview | null; phone: string; onBack: () => void; onConfirm: () => void; onCancel: () => void }) {
  if (!preview && !scheduledPreview) return <p className="rounded-xl border border-clinic-border bg-clinic-bg p-4 text-sm text-clinic-text-muted">Preparando a conferência…</p>;
  const content = preview?.content || scheduledPreview?.contentSnapshot || '';
  const contact = preview?.contactName || scheduledPreview?.contactName || '';
  const scheduled = Boolean(scheduledPreview);
  return (
    <section className="clinic-card overflow-hidden" data-testid="simple-message-preview">
      <div className="flex items-start gap-3 border-b border-clinic-border bg-clinic-bg/50 p-4 sm:p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clinic-primary/10 text-clinic-primary" aria-hidden="true"><CircleCheck size={19} /></span><div><h3 className="text-lg font-black text-clinic-text">Conferir</h3><p className="mt-1 text-sm text-clinic-text-muted">Revise os dados antes de confirmar a simulação.</p></div></div>
      <dl className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Destinatário</dt><dd className="mt-1 font-bold text-clinic-text">{contactLabel(contact)}</dd></div>
        <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Telefone</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{phone}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Mensagem</dt><dd className="mt-1 rounded-xl border border-clinic-border bg-clinic-bg p-3 text-sm leading-6 text-clinic-text">{content}</dd></div>
        <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Envio</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{scheduled ? 'Agendar para outro momento' : 'Enviar agora'}</dd></div>
        {scheduled && <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Data e horário</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{displayDateTime(scheduledPreview!.scheduledAt)}</dd></div>}
      </dl>
      <footer className="flex flex-col-reverse gap-2 border-t border-clinic-border bg-clinic-bg/40 p-4 sm:flex-row sm:justify-between sm:p-5"><SecondaryButton onClick={onBack}><ChevronLeft size={16} aria-hidden="true" /> Voltar e editar</SecondaryButton><div className="flex flex-col gap-2 sm:flex-row"><SecondaryButton onClick={onCancel}><X size={16} aria-hidden="true" /> Cancelar</SecondaryButton><PrimaryButton onClick={onConfirm}><Check size={17} aria-hidden="true" /> {scheduled ? 'Confirmar agendamento' : 'Confirmar na simulação'}</PrimaryButton></div></footer>
    </section>
  );
}

function NewMessage({ props }: { props: SimpleSimulationViewProps }) {
  const { state, conversations, templates, onNavigate } = props;
  const [step, setStep] = useState<WizardStep>(state.preview || state.schedulePreview ? 4 : 1);
  const [messageMode, setMessageMode] = useState<SimulationComposerState['mode'] | null>(state.composer.draft ? state.composer.mode : null);
  const [when, setWhen] = useState<SimpleWhen>('now');
  const [scheduledDate, setScheduledDate] = useState(() => inputDate(new Date(new Date(state.clock.now).getTime() + 60 * 60 * 1000).toISOString()));
  const [scheduledTime, setScheduledTime] = useState(() => inputTime(new Date(new Date(state.clock.now).getTime() + 60 * 60 * 1000).toISOString()));
  const [selectedTemplateId, setSelectedTemplateId] = useState(state.composer.templateId);
  const selected = conversations.find(item => item.id === state.selectedConversationId) || conversations[0];
  const activeTemplates = templates.filter(template => template.status === 'active');
  const minimumDate = inputDate(state.clock.now);
  const selectedIndex = selected ? conversations.indexOf(selected) : 0;

  useEffect(() => {
    if (!state.selectedConversationId && conversations[0]) props.onSelectConversation(conversations[0].id);
  }, [conversations, props.onSelectConversation, state.selectedConversationId]);

  useEffect(() => {
    const next = new Date(new Date(state.clock.now).getTime() + 60 * 60 * 1000).toISOString();
    setStep(1);
    setMessageMode(null);
    setWhen('now');
    setScheduledDate(inputDate(next));
    setScheduledTime(inputTime(next));
    setSelectedTemplateId('');
  }, [props.resetVersion]);

  useEffect(() => {
    if (state.preview || state.schedulePreview) setStep(4);
  }, [state.preview, state.schedulePreview]);

  const chooseMode = (mode: SimulationComposerState['mode']) => {
    setMessageMode(mode);
    setSelectedTemplateId('');
    props.onCompositionChange({ mode, draft: '', quickReplyId: '', templateId: '' });
  };

  const chooseTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    props.onUseTemplate(templateId);
  };

  const canContinue = step === 1 ? Boolean(selected) : step === 2 ? Boolean(messageMode && state.composer.draft.trim()) : when === 'now' || (scheduledDate >= minimumDate && Boolean(scheduledTime));
  const continueStep = () => {
    if (step === 1 && selected) setStep(2);
    else if (step === 2 && canContinue) setStep(3);
    else if (step === 3 && canContinue) {
      props.onPreviewMessage(when, when === 'scheduled' ? `${scheduledDate}T${scheduledTime}:00-03:00` : undefined);
      setStep(4);
    }
  };

  return (
    <section className="space-y-5" data-testid="simple-new-message">
      <SectionHeading icon={MessageCircle} title="Nova mensagem" description="Siga as etapas para preparar uma mensagem na demonstração." />
      <ProgressIndicator step={step} />

      {step === 1 && <section className="rounded-xl border border-clinic-border bg-clinic-surface p-4 sm:p-5" data-testid="message-step-1"><h3 className="text-base font-black text-clinic-text">Para quem?</h3><p className="mt-1 text-sm text-clinic-text-muted">Selecione o responsável que receberá a mensagem.</p><label className="mt-5 block text-sm font-bold text-clinic-text-muted" htmlFor="simple-recipient">Selecionar responsável<select id="simple-recipient" value={selected?.id || ''} onChange={event => props.onSelectConversation(event.target.value)} className="clinic-input mt-2"><option value="">Selecione uma opção</option>{conversations.map((conversation, index) => <option key={conversation.id} value={conversation.id}>{contactLabel(conversation.contact.displayName)}</option>)}</select></label>{selected && <div className="mt-4 rounded-xl border border-clinic-border bg-clinic-bg p-3"><p className="font-bold text-clinic-text">{contactLabel(selected.contact.displayName)}</p><p className="mt-1 text-xs text-clinic-text-muted">{maskedPhone(selectedIndex)}</p></div>}</section>}

      {step === 2 && <section className="rounded-xl border border-clinic-border bg-clinic-surface p-4 sm:p-5" data-testid="message-step-2"><h3 className="text-base font-black text-clinic-text">Mensagem</h3><p className="mt-1 text-sm text-clinic-text-muted">Escolha como deseja preparar o conteúdo.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={messageMode === 'template'} onClick={() => chooseMode('template')} className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40 ${messageMode === 'template' ? 'border-2 border-clinic-primary bg-clinic-primary/5 text-clinic-primary' : 'border-clinic-border bg-clinic-surface text-clinic-text-muted hover:border-clinic-primary'}`}><FileText size={20} aria-hidden="true" /><span className="mt-3 block font-black">Usar uma mensagem pronta</span><span className="mt-1 block text-xs font-normal leading-5">Escolha um texto já preparado e personalize antes de conferir.</span></button><button type="button" aria-pressed={messageMode === 'manual'} onClick={() => chooseMode('manual')} className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus:ring-clinic-primary/40 ${messageMode === 'manual' ? 'border-2 border-clinic-primary bg-clinic-primary/5 text-clinic-primary' : 'border-clinic-border bg-clinic-surface text-clinic-text-muted hover:border-clinic-primary'}`}><Pencil size={20} aria-hidden="true" /><span className="mt-3 block font-black">Escrever uma nova mensagem</span><span className="mt-1 block text-xs font-normal leading-5">Escreva um texto personalizado para esta simulação.</span></button></div>{messageMode === 'template' && <div className="mt-5 space-y-3"><p className="text-sm font-black text-clinic-text">Mensagens prontas disponíveis</p>{activeTemplates.map(template => <button key={template.id} type="button" onClick={() => chooseTemplate(template.id)} className={`block w-full rounded-xl border p-3 text-left transition ${selectedTemplateId === template.id ? 'border-clinic-primary bg-clinic-primary/5' : 'border-clinic-border bg-clinic-bg hover:border-clinic-primary'}`}><span className="flex items-center justify-between gap-3"><span className="font-black text-clinic-text">{template.name}</span><span className="text-xs font-black text-clinic-primary">{selectedTemplateId === template.id ? 'Selecionada' : 'Selecionar'}</span></span><span className="mt-1 block text-xs text-clinic-text-muted">{template.description}</span><span className="mt-2 block whitespace-pre-wrap text-sm leading-5 text-clinic-text">{props.resolveTemplatePreview(template.content)}</span></button>)}</div>}{messageMode && (messageMode === 'manual' || Boolean(selectedTemplateId)) && <label className="mt-5 block text-sm font-bold text-clinic-text-muted" htmlFor="simple-message-content">Mensagem<textarea id="simple-message-content" value={state.composer.draft} onChange={event => props.onDraftChange(event.target.value)} rows={5} maxLength={1000} placeholder="Escreva a mensagem" className="clinic-input mt-2 resize-y leading-6" /><span className="mt-1 block text-right text-xs font-normal text-clinic-text-faint">{state.composer.draft.length}/1000</span></label>}</section>}

      {step === 3 && <section className="rounded-xl border border-clinic-border bg-clinic-surface p-4 sm:p-5" data-testid="message-step-3"><h3 className="text-base font-black text-clinic-text">Quando?</h3><p className="mt-1 text-sm text-clinic-text-muted">Escolha quando a mensagem será considerada na simulação.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={when === 'now'} onClick={() => setWhen('now')} className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40 ${when === 'now' ? 'border-2 border-clinic-primary bg-clinic-primary/5 text-clinic-primary' : 'border-clinic-border text-clinic-text-muted hover:border-clinic-primary'}`}><Send size={20} aria-hidden="true" /><span className="mt-3 block font-black">Enviar agora</span><span className="mt-1 block text-xs font-normal">A mensagem será apenas registrada na simulação.</span></button><button type="button" aria-pressed={when === 'scheduled'} onClick={() => setWhen('scheduled')} className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40 ${when === 'scheduled' ? 'border-2 border-clinic-primary bg-clinic-primary/5 text-clinic-primary' : 'border-clinic-border text-clinic-text-muted hover:border-clinic-primary'}`}><CalendarDays size={20} aria-hidden="true" /><span className="mt-3 block font-black">Agendar para outro momento</span><span className="mt-1 block text-xs font-normal">Escolha a data e o horário da simulação.</span></button></div>{when === 'scheduled' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-clinic-text-muted">Data<input type="date" min={minimumDate} value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} className="clinic-input mt-2 font-normal text-clinic-text" /></label><label className="text-sm font-bold text-clinic-text-muted">Horário<input type="time" value={scheduledTime} onChange={event => setScheduledTime(event.target.value)} className="clinic-input mt-2 font-normal text-clinic-text" /></label></div>}</section>}

      {step === 4 && <MessagePreview preview={state.preview} scheduledPreview={state.schedulePreview} phone={maskedPhone(selectedIndex)} onBack={() => setStep(3)} onConfirm={state.schedulePreview ? props.onConfirmSchedule : props.onConfirmMessage} onCancel={() => { props.onCancelPreview(); setStep(1); }} />}

      {step < 4 && <footer className="flex flex-col-reverse gap-2 border-t border-clinic-border pt-4 sm:flex-row sm:justify-between" data-testid="message-actions">{step > 1 ? <SecondaryButton onClick={() => setStep((step - 1) as WizardStep)}><ChevronLeft size={16} aria-hidden="true" /> Voltar</SecondaryButton> : <span />}{step === 3 && <span className="sr-only">A próxima etapa abrirá a conferência da mensagem.</span>}<PrimaryButton onClick={continueStep} disabled={!canContinue}>{step === 3 ? 'Conferir' : 'Continuar'} <ChevronRight size={16} aria-hidden="true" /></PrimaryButton></footer>}
    </section>
  );
}

function ScheduledMessages({ props }: { props: SimpleSimulationViewProps }) {
  const { tenant, schedules, conversations } = props;
  const [editingId, setEditingId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [editText, setEditText] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [confirmCancelId, setConfirmCancelId] = useState('');
  const visibleSchedules = schedules.filter(item => item.tenantId === tenant.tenant.id);
  const startEdit = (schedule: SimulationSchedule) => { setEditingId(schedule.id); setEditText(schedule.contentSnapshot); setEditDate(inputDate(schedule.scheduledAt)); setEditTime(inputTime(schedule.scheduledAt)); setExpandedId(''); };
  const saveEdit = (schedule: SimulationSchedule) => { props.onEditSchedule(schedule.id, { contentSnapshot: editText, scheduledAt: `${editDate}T${editTime}:00-03:00` }); setEditingId(''); };

  return (
    <section className="space-y-5" data-testid="simple-scheduled-messages">
      <SectionHeading icon={CalendarDays} title="Agendadas" description="Acompanhe cada mensagem em um cartão organizado." />
      {visibleSchedules.length === 0 ? <div className="rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-8 text-center text-sm text-clinic-text-muted">Não há mensagens agendadas.</div> : <div className="grid gap-4">{visibleSchedules.map(schedule => { const conversation = conversations.find(item => item.id === schedule.conversationId); const index = conversation ? conversations.indexOf(conversation) : 0; const isEditing = editingId === schedule.id; const isExpanded = expandedId === schedule.id; return <article key={schedule.id} className="clinic-card overflow-hidden" data-testid="simple-scheduled-card"><div className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-clinic-text">{contactLabel(conversation?.contact.displayName || 'Contato')}</h3><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClasses(schedule.status)}`}>{statusLabel(schedule.status)}</span></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Telefone</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{maskedPhone(index)}</dd></div><div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Data</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{displayDate(schedule.scheduledAt)}</dd></div><div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Horário</dt><dd className="mt-1 font-semibold text-clinic-text-muted">{displayTime(schedule.scheduledAt)}</dd></div></dl></div><div className="flex flex-wrap gap-2 sm:justify-end">{schedule.status === 'scheduled' && <><SecondaryButton onClick={() => startEdit(schedule)}><Edit3 size={15} aria-hidden="true" /> Editar</SecondaryButton><SecondaryButton onClick={() => setConfirmCancelId(schedule.id)}><Trash2 size={15} aria-hidden="true" /> Cancelar</SecondaryButton></>}{schedule.status === 'failed' && <><PrimaryButton onClick={() => props.onRetrySchedule(schedule.id)}><RefreshCw size={15} aria-hidden="true" /> Tentar novamente</PrimaryButton><SecondaryButton onClick={() => setConfirmCancelId(schedule.id)}><Trash2 size={15} aria-hidden="true" /> Cancelar</SecondaryButton></>}{['completed', 'cancelled', 'expired'].includes(schedule.status) && <SecondaryButton onClick={() => setExpandedId(isExpanded ? '' : schedule.id)}><Link2 size={15} aria-hidden="true" /> Visualizar</SecondaryButton>}</div></div><div className="mt-4 rounded-xl border border-clinic-border bg-clinic-bg/60 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Resumo da mensagem</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-clinic-text">{schedule.contentSnapshot}</p></div>{confirmCancelId === schedule.id && <div className="mt-4 rounded-xl border border-status-orange-text/25 bg-status-orange-bg p-4"><p className="text-sm font-bold text-clinic-text">Deseja cancelar esta mensagem?</p><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row"><SecondaryButton onClick={() => setConfirmCancelId('')}>Voltar</SecondaryButton><PrimaryButton onClick={() => { props.onCancelSchedule(schedule.id); setConfirmCancelId(''); }}>Confirmar cancelamento</PrimaryButton></div></div>}{isEditing && <form className="mt-4 space-y-4 rounded-xl border border-clinic-border bg-clinic-bg p-4" onSubmit={event => { event.preventDefault(); saveEdit(schedule); }}><p className="font-black text-clinic-text">Editar mensagem</p><label className="block text-sm font-bold text-clinic-text-muted">Mensagem<textarea value={editText} onChange={event => setEditText(event.target.value)} rows={4} className="clinic-input mt-2 resize-y font-normal leading-6" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-clinic-text-muted">Data<input type="date" min={inputDate(props.state.clock.now)} value={editDate} onChange={event => setEditDate(event.target.value)} className="clinic-input mt-2 font-normal text-clinic-text" /></label><label className="text-sm font-bold text-clinic-text-muted">Horário<input type="time" value={editTime} onChange={event => setEditTime(event.target.value)} className="clinic-input mt-2 font-normal text-clinic-text" /></label></div><div className="flex flex-col-reverse gap-2 sm:flex-row"><SecondaryButton onClick={() => setEditingId('')}>Cancelar edição</SecondaryButton><PrimaryButton type="submit"><Check size={16} aria-hidden="true" /> Salvar alteração</PrimaryButton></div></form>}{isExpanded && <div className="mt-4 rounded-xl border border-clinic-border bg-clinic-bg p-4 text-sm leading-6 text-clinic-text-muted"><p className="font-bold text-clinic-text">Mensagem completa</p><p className="mt-2 whitespace-pre-wrap">{schedule.contentSnapshot}</p></div>}</div></article>; })}</div>}
    </section>
  );
}

const purposeOptions: ReadonlyArray<{ label: string; category: SimulationTemplate['category'] }> = [
  { label: 'Lembrete', category: 'atendimento' },
  { label: 'Confirmação', category: 'confirmação' },
  { label: 'Reagendamento', category: 'reagendamento' },
  { label: 'Aviso', category: 'retorno' },
  { label: 'Outro', category: 'administrativo' },
];

function purposeLabel(category: SimulationTemplate['category']): string {
  return purposeOptions.find(option => option.category === category)?.label || 'Outro';
}

function updatePresentation(draft: SimulationTemplateDraft, changes: Partial<SimulationTemplatePresentation>): SimulationTemplateDraft {
  const presentation = { ...(draft.presentation || createDefaultTemplatePresentation()), ...changes, preserveLegacy: false, legacyContent: undefined };
  return { ...draft, presentation, content: composeTemplateContent(presentation) };
}

function ReadyMessages({ props }: { props: SimpleSimulationViewProps }) {
  const { templates, templateDraft, templateEditingId } = props;
  const [expandedId, setExpandedId] = useState('');
  if (templateDraft) {
    const presentation = templateDraft.presentation || createDefaultTemplatePresentation();
    const preview = props.resolveTemplatePreview(composeTemplateContent(presentation));
    return <section className="space-y-5" data-testid="simple-ready-messages"><SectionHeading icon={FileText} title={templateEditingId ? 'Editar mensagem pronta' : 'Criar mensagem pronta'} description="Monte uma mensagem clara para reutilizar no atendimento." /><form className="clinic-card max-w-5xl space-y-5 p-4 sm:p-5" onSubmit={event => { event.preventDefault(); props.onSaveTemplate(); }} data-testid="simple-ready-message-form"><div className="flex items-center justify-between gap-3"><h3 className="text-base font-black text-clinic-text">Dados da mensagem</h3><button type="button" onClick={props.onCancelTemplate} className="rounded-lg p-2 text-clinic-text-faint hover:bg-clinic-bg hover:text-clinic-text" aria-label="Fechar formulário"><X size={18} /></button></div><label className="block text-sm font-bold text-clinic-text-muted" htmlFor="simple-template-name">Nome da mensagem<input id="simple-template-name" value={templateDraft.name} onChange={event => props.onTemplateDraftChange({ ...templateDraft, name: event.target.value })} placeholder="Ex.: Lembrete de atendimento" className="clinic-input mt-2 font-normal text-clinic-text" /></label><fieldset><legend className="text-sm font-bold text-clinic-text-muted">Finalidade</legend><div className="mt-3 grid gap-2 sm:grid-cols-5">{purposeOptions.map(option => <label key={option.category} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${templateDraft.category === option.category ? 'border-clinic-primary bg-clinic-primary/5 text-clinic-primary' : 'border-clinic-border bg-clinic-surface text-clinic-text-muted hover:border-clinic-primary'}`}><input type="radio" name="simple-template-purpose" value={option.category} checked={templateDraft.category === option.category} onChange={() => props.onTemplateDraftChange({ ...templateDraft, category: option.category })} className="h-4 w-4 accent-clinic-primary" />{option.label}</label>)}</div></fieldset><label className="block text-sm font-bold text-clinic-text-muted" htmlFor="simple-template-body">Texto principal<textarea id="simple-template-body" value={presentation.body} onChange={event => props.onTemplateDraftChange(updatePresentation(templateDraft, { body: event.target.value }))} rows={5} maxLength={1000} placeholder="Escreva o conteúdo central da mensagem" className="clinic-input mt-2 resize-y font-normal leading-6 text-clinic-text" /></label><fieldset className="rounded-xl border border-clinic-border bg-clinic-bg p-4"><legend className="px-1 text-sm font-black text-clinic-text">Personalizar automaticamente</legend><div className="mt-2 space-y-2">{[['useContactName', 'Usar o nome do responsável na saudação'], ['includeDateTime', 'Incluir a data e o horário'], ['signProfessional', 'Assinar com o nome do profissional']].map(([key, label]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-sm font-semibold text-clinic-text-muted hover:bg-clinic-surface"><input type="checkbox" checked={Boolean(presentation[key as keyof SimulationTemplatePresentation])} onChange={event => props.onTemplateDraftChange(updatePresentation(templateDraft, { [key]: event.target.checked }))} className="mt-0.5 h-5 w-5 shrink-0 accent-clinic-primary" /> <span>{label}</span></label>)}</div></fieldset><aside className="rounded-xl border border-status-green-text/20 bg-status-green-bg p-4" aria-live="polite" data-testid="simple-template-preview"><p className="text-xs font-black uppercase tracking-[0.14em] text-status-green-text">Prévia</p><p className="mt-3 whitespace-pre-wrap text-base leading-7 text-clinic-text">{preview || 'A prévia aparecerá aqui enquanto você escreve.'}</p></aside><footer className="flex flex-col-reverse gap-2 border-t border-clinic-border pt-4 sm:flex-row sm:justify-end"><SecondaryButton onClick={props.onCancelTemplate}>Cancelar</SecondaryButton><PrimaryButton type="submit"><Check size={16} aria-hidden="true" /> Salvar mensagem pronta</PrimaryButton></footer></form></section>;
  }
  return <section className="space-y-5" data-testid="simple-ready-messages"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><SectionHeading icon={FileText} title="Mensagens prontas" description="Textos claros para escolher, adaptar e reutilizar." /><PrimaryButton onClick={() => props.onBeginTemplate()}><Plus size={17} aria-hidden="true" /> Criar</PrimaryButton></div><div className="grid max-w-6xl gap-4">{templates.map(item => { const expanded = expandedId === item.id; const preview = props.resolveTemplatePreview(item.content); return <article key={item.id} className="clinic-card p-4 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-clinic-text">{item.name}</h3><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${templateClasses(item.status)}`}>{templateStatusLabel(item.status)}</span></div><p className="mt-2 text-sm text-clinic-text-muted">Finalidade: {purposeLabel(item.category)}</p><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-clinic-text">{preview}</p></div><div className="flex flex-wrap gap-2">{item.status === 'active' && <SecondaryButton onClick={() => props.onUseTemplate(item.id)}><Send size={15} aria-hidden="true" /> Usar</SecondaryButton>}<SecondaryButton onClick={() => props.onEditTemplate(item.id)}><Edit3 size={15} aria-hidden="true" /> Editar</SecondaryButton><SecondaryButton onClick={() => item.status === 'active' ? props.onDeactivateTemplate(item.id) : props.onActivateTemplate(item.id)}>{item.status === 'active' ? 'Desativar' : 'Ativar'}</SecondaryButton><SecondaryButton onClick={() => setExpandedId(expanded ? '' : item.id)}>{expanded ? 'Esconder' : 'Visualizar'}</SecondaryButton></div></div>{expanded && <div className="mt-4 rounded-xl border border-clinic-border bg-clinic-bg p-4 text-sm leading-6 text-clinic-text"><p className="font-bold">Mensagem completa</p><p className="mt-2 whitespace-pre-wrap">{preview}</p></div>}</article>; })}</div></section>;
}

export function SimpleSimulationView(props: SimpleSimulationViewProps) {
  if (props.state.activeView === 'my_whatsapp') return <MyWhatsApp connected={props.connected} onNavigate={props.onNavigate} />;
  if (props.state.activeView === 'schedules') return <ScheduledMessages props={props} />;
  if (props.state.activeView === 'ready_messages') return <ReadyMessages props={props} />;
  return <NewMessage props={props} />;
}
