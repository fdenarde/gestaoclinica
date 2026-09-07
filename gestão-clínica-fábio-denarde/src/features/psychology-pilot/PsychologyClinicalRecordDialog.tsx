import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FilePlus2, FileText, LockKeyhole, Pencil, X } from 'lucide-react';
import type { PsychologyPatient, PsychologySession, PsychologySessionRecord } from './psychologyDomain';
import type { PsychologyClinicalRecordType, PsychologyParentRecordType, PsychologySettings, PsychologySoapRecord } from './psychologyR2a';
import { EMPTY_PSYCHOLOGY_SOAP, isPsychologyMinorOrAdolescent, psychologyClinicalRecordLabel, type PsychologyClinicalRecordDraft } from './psychologyClinicalRecords';

type ClinicalTab = 'THERAPEUTIC_FOLLOW_UP' | 'SOAP' | 'PARENT_ANAMNESIS_FEEDBACK';
type DraftByTab = Record<ClinicalTab, PsychologyClinicalRecordDraft>;
type FingerprintByTab = Record<ClinicalTab, string>;

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100';
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const FOLLOW_UP_MARKERS = ['Objetivo da sessão', 'Atividades realizadas', 'Resposta do paciente', 'Observações', 'Encaminhamentos'] as const;
const SOAP_PLACEHOLDERS: Record<keyof PsychologySoapRecord, string> = {
  subjective: 'Relato do paciente, percepções, queixas e experiências relevantes.',
  objective: 'Observações objetivas e aspectos observáveis durante a sessão.',
  assessment: 'Análise clínica/profissional baseada nas informações da sessão.',
  plan: 'Condutas, objetivos, encaminhamentos e próximos passos.',
};

function civilToday(): string {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateLabel(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function timeLabel(value?: string): string {
  if (!value) return '—';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function initialDraft(patientId: string, recordType: PsychologyClinicalRecordType): PsychologyClinicalRecordDraft {
  return { patientId, recordType, date: civilToday(), content: '', soap: { ...EMPTY_PSYCHOLOGY_SOAP } };
}

function createDrafts(patientId: string): DraftByTab {
  return {
    THERAPEUTIC_FOLLOW_UP: initialDraft(patientId, 'THERAPEUTIC_FOLLOW_UP'),
    SOAP: initialDraft(patientId, 'SOAP'),
    PARENT_ANAMNESIS_FEEDBACK: initialDraft(patientId, 'PARENT_ANAMNESIS_FEEDBACK'),
  };
}

function draftFingerprint(draft: PsychologyClinicalRecordDraft, tab: ClinicalTab): string {
  return JSON.stringify({
    tab,
    id: draft.id || '',
    patientId: draft.patientId,
    recordType: tab,
    date: draft.date,
    sessionId: draft.sessionId || '',
    content: draft.content,
    soap: { ...EMPTY_PSYCHOLOGY_SOAP, ...(draft.soap || {}) },
    parentRecordType: draft.parentRecordType || '',
  });
}

function createFingerprints(drafts: DraftByTab): FingerprintByTab {
  return {
    THERAPEUTIC_FOLLOW_UP: draftFingerprint(drafts.THERAPEUTIC_FOLLOW_UP, 'THERAPEUTIC_FOLLOW_UP'),
    SOAP: draftFingerprint(drafts.SOAP, 'SOAP'),
    PARENT_ANAMNESIS_FEEDBACK: draftFingerprint(drafts.PARENT_ANAMNESIS_FEEDBACK, 'PARENT_ANAMNESIS_FEEDBACK'),
  };
}

function recordContent(record: PsychologySessionRecord): string {
  if ((record.recordType || 'THERAPEUTIC_FOLLOW_UP') !== 'SOAP') return record.content;
  const soap = record.soap || EMPTY_PSYCHOLOGY_SOAP;
  return `S — Sujeito\n${soap.subjective || '—'}\n\nO — Objetivo\n${soap.objective || '—'}\n\nA — Avaliação\n${soap.assessment || '—'}\n\nP — Plano\n${soap.plan || '—'}`;
}

function AutoGrowTextarea({ value, onChange, disabled, placeholder, inputRef, testId }: { value: string; onChange: (value: string) => void; disabled: boolean; placeholder: string; inputRef?: RefObject<HTMLTextAreaElement | null>; testId?: string }) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef || ownRef;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 116), 360)}px`;
  }, [ref, value]);
  return <textarea ref={ref} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} rows={4} placeholder={placeholder} data-testid={testId} className={`${inputClass} mt-2 min-h-[116px] resize-none leading-relaxed`} />;
}

export default function PsychologyClinicalRecordDialog({ patient, sessions, records, authorName, settings, readOnly = false, onClose, onSave }: { patient: PsychologyPatient; sessions: PsychologySession[]; records: PsychologySessionRecord[]; authorName: string; settings?: PsychologySettings; readOnly?: boolean; onClose: () => void; onSave: (draft: PsychologyClinicalRecordDraft) => Promise<boolean | PsychologySessionRecord> }) {
  const minor = isPsychologyMinorOrAdolescent(patient);
  const [tab, setTab] = useState<ClinicalTab>('THERAPEUTIC_FOLLOW_UP');
  const [drafts, setDrafts] = useState<DraftByTab>(() => createDrafts(patient.id));
  const [cleanFingerprints, setCleanFingerprints] = useState<FingerprintByTab>(() => createFingerprints(createDrafts(patient.id)));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const draft = drafts[tab];
  const isDirty = draftFingerprint(draft, tab) !== cleanFingerprints[tab];
  const patientSessions = useMemo(() => sessions.filter(item => item.patientId === patient.id).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)), [patient.id, sessions]);
  const history = useMemo(() => records.filter(item => item.patientId === patient.id).sort((a, b) => `${b.date || b.sessionDate}T${b.sessionTime}`.localeCompare(`${a.date || a.sessionDate}T${a.sessionTime}`)), [patient.id, records]);
  const selectedSession = patientSessions.find(session => session.id === draft.sessionId);
  const selectedRecord = draft.id ? records.find(record => record.id === draft.id) : undefined;
  const contextSessionTime = selectedSession?.time || selectedRecord?.sessionTime;
  const contextModality = selectedSession ? selectedSession.modality === 'online' ? 'Online' : selectedSession.locationType === 'EXTERNAL_OFFICE' ? 'Consultório externo' : 'Presencial' : undefined;
  const contextLocation = selectedSession?.locationId ? settings?.locations.find(location => location.id === selectedSession.locationId)?.displayName : undefined;
  const tabs: Array<{ id: ClinicalTab; label: string }> = [{ id: 'THERAPEUTIC_FOLLOW_UP', label: 'Acompanhamento Terapêutico' }, { id: 'SOAP', label: 'Modelo SOAP' }, ...(minor ? [{ id: 'PARENT_ANAMNESIS_FEEDBACK' as const, label: 'Anamnese / Devolutiva' }] : [])];

  const updateCurrentDraft = (update: (current: PsychologyClinicalRecordDraft) => PsychologyClinicalRecordDraft) => {
    setDrafts(current => ({ ...current, [tab]: update(current[tab]) }));
    setLastSavedAt(null);
  };

  const canDiscard = () => !isDirty || typeof window === 'undefined' || window.confirm('Existem alterações não salvas. Deseja sair sem salvar?');
  const requestClose = () => { if (canDiscard()) onClose(); };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty]);

  const selectTab = (next: ClinicalTab) => {
    if (next === tab || !canDiscard()) return;
    setTab(next);
    setFeedback('');
  };

  const beginNew = () => {
    if (!canDiscard()) return;
    const next = initialDraft(patient.id, tab);
    setDrafts(current => ({ ...current, [tab]: next }));
    setCleanFingerprints(current => ({ ...current, [tab]: draftFingerprint(next, tab) }));
    setOpenRecordId(null);
    setLastSavedAt(null);
    setFeedback('');
  };

  const editRecord = (record: PsychologySessionRecord) => {
    if (!canDiscard()) return;
    const recordType = record.recordType || 'THERAPEUTIC_FOLLOW_UP';
    const next: PsychologyClinicalRecordDraft = { id: record.id, patientId: record.patientId, recordType, date: record.date || record.sessionDate || civilToday(), sessionId: record.sessionId, content: record.content || '', soap: { ...EMPTY_PSYCHOLOGY_SOAP, ...(record.soap || {}) }, parentRecordType: record.parentRecordType };
    setTab(recordType);
    setDrafts(current => ({ ...current, [recordType]: next }));
    setCleanFingerprints(current => ({ ...current, [recordType]: draftFingerprint(next, recordType) }));
    setOpenRecordId(record.id);
    setLastSavedAt(record.updatedAt || null);
    setFeedback('');
  };

  const persist = async (): Promise<boolean> => {
    if (saving || readOnly) return false;
    setSaving(true);
    setFeedback('');
    try {
      const saved = await onSave({ ...draft, recordType: tab, patientId: patient.id });
      if (!saved) {
        setFeedback('O prontuário não foi salvo. Revise a mensagem exibida pela aplicação.');
        return false;
      }
      const savedRecord = typeof saved === 'object' ? saved : undefined;
      const next: PsychologyClinicalRecordDraft = { ...draft, id: savedRecord?.id || draft.id, recordType: tab, patientId: patient.id };
      setDrafts(current => ({ ...current, [tab]: next }));
      setCleanFingerprints(current => ({ ...current, [tab]: draftFingerprint(next, tab) }));
      setLastSavedAt(savedRecord?.updatedAt || new Date().toISOString());
      setFeedback('Prontuário salvo com sucesso.');
      return true;
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'Não foi possível salvar o prontuário.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => { if (await persist()) onClose(); };
  const updateSoap = (field: keyof PsychologySoapRecord, value: string) => updateCurrentDraft(current => ({ ...current, soap: { ...EMPTY_PSYCHOLOGY_SOAP, ...(current.soap || {}), [field]: value } }));
  const insertMarker = (marker: string) => {
    if (readOnly || saving) return;
    const current = draft.content || '';
    const start = followUpRef.current?.selectionStart ?? current.length;
    const end = followUpRef.current?.selectionEnd ?? start;
    const prefix = start > 0 && !/\s$/.test(current.slice(0, start)) ? '\n\n' : '';
    const insertion = `${prefix}${marker}: `;
    const next = `${current.slice(0, start)}${insertion}${current.slice(end)}`;
    updateCurrentDraft(value => ({ ...value, content: next }));
    requestAnimationFrame(() => { const element = followUpRef.current; if (!element) return; const cursor = start + insertion.length; element.focus(); element.setSelectionRange(cursor, cursor); });
  };
  const insertStructure = () => {
    const current = draft.content || '';
    const missing = FOLLOW_UP_MARKERS.filter(marker => !new RegExp(`(^|\\n)\\s*${marker.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*:`, 'im').test(current));
    if (!missing.length) { setFeedback('A estrutura já está presente neste registro.'); return; }
    const block = missing.map(marker => `${marker}: `).join('\n');
    updateCurrentDraft(value => ({ ...value, content: value.content.trimEnd() ? `${value.content.trimEnd()}\n\n${block}` : block }));
  };

  const statusLabel = isDirty ? 'Alterações não salvas' : lastSavedAt ? 'Salvo' : draft.id ? 'Salvo' : 'Novo registro';
  const statusClass = isDirty ? 'border-amber-200 bg-amber-50 text-amber-800' : statusLabel === 'Salvo' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-600';

  return <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/60 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Prontuário clínico" data-testid="psychology-clinical-record-dialog"><section className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl"><header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Prontuário clínico · Psicologia</p><h2 className="mt-1 truncate text-xl font-black text-slate-900 sm:text-2xl">{patient.name}</h2><div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600 sm:grid-cols-5" data-testid="psychology-clinical-record-context"><span><strong className="block text-[10px] uppercase tracking-wide text-slate-400">Data</strong>{dateLabel(draft.date)}</span><span><strong className="block text-[10px] uppercase tracking-wide text-slate-400">Horário</strong>{timeLabel(contextSessionTime)}</span><span><strong className="block text-[10px] uppercase tracking-wide text-slate-400">Modalidade</strong>{contextModality || '—'}</span><span><strong className="block text-[10px] uppercase tracking-wide text-slate-400">Local</strong>{contextLocation || '—'}</span><span><strong className="block text-[10px] uppercase tracking-wide text-slate-400">Profissional</strong>{authorName || '—'}</span></div></div><button type="button" onClick={requestClose} aria-label="Fechar prontuário" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><X size={20} /></button></div><div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Modalidades do prontuário">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => selectTab(item.id)} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-black ${tab === item.id ? 'bg-violet-700 text-white' : 'bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>{item.label}</button>)}</div></header><main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><section className="rounded-2xl border border-violet-100 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black text-slate-900">{draft.id ? `Editar ${psychologyClinicalRecordLabel(tab)}` : `Novo ${psychologyClinicalRecordLabel(tab)}`}</h3><div className="mt-2 flex flex-wrap items-center gap-2"><span data-testid="psychology-clinical-record-state" className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusClass}`}>{statusLabel}</span>{lastSavedAt && <span className="text-xs font-bold text-slate-500">Última atualização {timeLabel(lastSavedAt)}</span>}</div><p className="mt-2 text-sm font-bold text-slate-500">Salvamento explícito. Nenhum conteúdo é sugerido ou preenchido automaticamente.</p></div><button type="button" onClick={beginNew} disabled={readOnly || saving} className={secondaryButton}><FilePlus2 size={16} /> Novo registro</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black text-slate-700">Data do registro<input type="date" value={draft.date} onChange={event => updateCurrentDraft(current => ({ ...current, date: event.target.value }))} disabled={readOnly || saving} className={`${inputClass} mt-1`} /></label><label className="text-sm font-black text-slate-700">Sessão relacionada <span className="font-bold text-slate-400">(opcional)</span><select value={draft.sessionId || ''} onChange={event => updateCurrentDraft(current => ({ ...current, sessionId: event.target.value || undefined }))} disabled={readOnly || saving} className={`${inputClass} mt-1`}><option value="">Sem sessão vinculada</option>{patientSessions.map(session => <option key={session.id} value={session.id}>{dateLabel(session.date)} · {session.time} · {session.status}</option>)}</select></label></div>{tab === 'SOAP' ? <div className="mt-5 grid gap-4" data-testid="psychology-soap-fields"><SoapField label="S — Sujeito" description="Relato, percepção, queixas e experiências do paciente." placeholder={SOAP_PLACEHOLDERS.subjective} value={draft.soap?.subjective || ''} onChange={value => updateSoap('subjective', value)} disabled={readOnly || saving} testId="psychology-soap-subjective" /><SoapField label="O — Objetivo" description="Observações objetivas e relevantes da sessão." placeholder={SOAP_PLACEHOLDERS.objective} value={draft.soap?.objective || ''} onChange={value => updateSoap('objective', value)} disabled={readOnly || saving} testId="psychology-soap-objective" /><SoapField label="A — Avaliação" description="Análise clínica/profissional decorrente das informações." placeholder={SOAP_PLACEHOLDERS.assessment} value={draft.soap?.assessment || ''} onChange={value => updateSoap('assessment', value)} disabled={readOnly || saving} testId="psychology-soap-assessment" /><SoapField label="P — Plano" description="Condutas, objetivos, encaminhamentos e próximos passos." placeholder={SOAP_PLACEHOLDERS.plan} value={draft.soap?.plan || ''} onChange={value => updateSoap('plan', value)} disabled={readOnly || saving} testId="psychology-soap-plan" /></div> : <div className="mt-5">{tab === 'PARENT_ANAMNESIS_FEEDBACK' && <label className="block text-sm font-black text-slate-700">Tipo do registro<select value={draft.parentRecordType || ''} onChange={event => updateCurrentDraft(current => ({ ...current, parentRecordType: event.target.value ? event.target.value as PsychologyParentRecordType : undefined }))} disabled={readOnly || saving} className={`${inputClass} mt-1`}><option value="">Selecione</option><option value="ANAMNESIS">Anamnese</option><option value="FEEDBACK">Devolutiva</option><option value="ANAMNESIS_AND_FEEDBACK">Anamnese e Devolutiva</option></select></label>}<div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-black text-slate-700">Conteúdo clínico</span>{tab === 'THERAPEUTIC_FOLLOW_UP' && <div className="flex flex-wrap gap-2" data-testid="psychology-follow-up-shortcuts">{FOLLOW_UP_MARKERS.map(marker => <button key={marker} type="button" onClick={() => insertMarker(marker)} disabled={readOnly || saving} className="min-h-10 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-xs font-black text-violet-800 hover:bg-violet-100">{marker}</button>)}<button type="button" onClick={insertStructure} disabled={readOnly || saving} className="min-h-10 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Inserir estrutura</button></div>}</div><AutoGrowTextarea inputRef={tab === 'THERAPEUTIC_FOLLOW_UP' ? followUpRef : undefined} value={draft.content} onChange={value => updateCurrentDraft(current => ({ ...current, content: value }))} disabled={readOnly || saving} placeholder="Registre somente as informações clínicas necessárias." testId={tab === 'THERAPEUTIC_FOLLOW_UP' ? 'psychology-follow-up-content' : undefined} /></div>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5"><p className="text-xs font-bold text-slate-500">{draft.id ? 'A edição preserva a criação original e atualiza a data de modificação.' : 'O registro pertence somente a este paciente.'}</p><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={requestClose} disabled={saving} className={secondaryButton}>Cancelar</button><button type="button" onClick={() => void persist()} disabled={readOnly || saving || !isDirty} className={secondaryButton}><Check size={16} /> {saving ? 'Salvando…' : 'Salvar'}</button><button type="button" onClick={() => void saveAndClose()} disabled={readOnly || saving || !isDirty} className={primaryButton}><Check size={16} /> {saving ? 'Salvando…' : 'Salvar e fechar'}</button></div></div>{feedback && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${feedback.includes('sucesso') ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{feedback}</p>}</section><section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-black text-slate-900">Histórico do prontuário</h3><p className="mt-1 text-sm font-bold text-slate-500">Mais recente primeiro · somente registros deste paciente.</p></div><FileText className="text-violet-700" size={20} /></div>{history.length ? <div className="mt-4 space-y-3">{history.map(record => <article key={record.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-black text-slate-900">{psychologyClinicalRecordLabel(record.recordType)} · {dateLabel(record.date || record.sessionDate)}</p><p className="mt-1 text-xs font-bold text-slate-500">Autor: {record.authorProfessionalId}{record.sessionId ? ` · Sessão vinculada: ${record.sessionDate || record.date} ${record.sessionTime || ''}` : ' · Sem sessão vinculada'}</p></div><div className="flex gap-2"><button type="button" onClick={() => setOpenRecordId(current => current === record.id ? null : record.id)} className="min-h-10 rounded-lg px-2 py-1 text-xs font-black text-violet-700 hover:bg-violet-50">{openRecordId === record.id ? 'Ocultar' : 'Visualizar'}</button>{!readOnly && <button type="button" onClick={() => editRecord(record)} className="min-h-10 rounded-lg px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-100"><Pencil size={13} className="mr-1 inline" /> Editar</button>}</div></div>{openRecordId === record.id && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">{recordContent(record)}</pre>}</article>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm font-bold text-slate-500">Nenhum registro clínico para este paciente.</p>}</section></main><footer className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-500 sm:px-6"><LockKeyhole size={14} /> Conteúdo clínico interno · acesso profissional autorizado da Psicologia.</footer></section></div>;
}

function SoapField({ label, description, placeholder, value, onChange, disabled, testId }: { label: string; description: string; placeholder: string; value: string; onChange: (value: string) => void; disabled: boolean; testId: string }) {
  return <label className="block text-sm font-black text-slate-700">{label}<span className="mt-1 block text-xs font-bold text-slate-500">{description}</span><AutoGrowTextarea value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} testId={testId} /></label>;
}
