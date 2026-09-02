import { useState } from 'react';
import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import {
  classifyDoctoraliaPreview,
  doctoraliaPreviewPatientMatchLabels,
  doctoraliaPreviewSessionLabels,
  doctoraliaPreviewStatusLabels,
  parseDoctoraliaPreviewInput,
  type DoctoraliaPreviewResult,
} from './doctoraliaFirstPartyPreview';

type Props = {
  remoteMode: boolean;
  snapshotReady: boolean;
  store: PsychologyStore;
};

const inputHint = '2026-09-02|15:30-16:20|Nome fictício|Acompanhamento terapêutico (at)\n2026-09-02|16:40-17:50|Outro Nome Fictício|Teste de eneagrama presencial - tgp|PRESENCIAL';

const resultClass: Record<string, string> = {
  READY_TO_IMPORT: 'bg-emerald-50 text-emerald-800',
  ALREADY_EXISTS: 'bg-sky-50 text-sky-800',
  PATIENT_REVIEW: 'bg-amber-50 text-amber-800',
  PATIENT_NOT_FOUND: 'bg-amber-50 text-amber-800',
  SERVICE_REVIEW: 'bg-amber-50 text-amber-800',
  MODALITY_REVIEW: 'bg-amber-50 text-amber-800',
  SCHEDULE_CONFLICT: 'bg-rose-50 text-rose-800',
  CANCELLED_DO_NOT_IMPORT: 'bg-slate-100 text-slate-700',
  BLOCKED: 'bg-rose-50 text-rose-800',
};

function statusPill(value: string, className = '') {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${className || 'bg-slate-100 text-slate-700'}`}>{value}</span>;
}

export default function DoctoraliaFirstPartyPreviewPanel({ remoteMode, snapshotReady, store }: Props) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DoctoraliaPreviewResult | null>(null);
  const [error, setError] = useState('');

  if (!remoteMode) return null;

  const runPreview = () => {
    setError('');
    setResult(null);
    const parsed = parseDoctoraliaPreviewInput(input);
    if (parsed.error) { setError(parsed.error); return; }
    if (parsed.events.length !== 10) { setError(`A prévia operacional exige os 10 eventos prioritários; foram recebidos ${parsed.events.length}.`); return; }
    setResult(classifyDoctoraliaPreview(parsed.events, { patients: store.patients, sessions: store.sessions }));
  };

  return <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm sm:p-5" data-testid="doctoralia-first-party-preview">
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-700 text-white"><ClipboardCheck size={21} /></div>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Doctoralia · first-party</p>
        <h3 className="mt-1 text-xl font-black text-slate-950">Prévia Doctoralia — somente leitura</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">Compara os 10 eventos colados com o snapshot autenticado já carregado pela Psicologia. A entrada fica apenas nesta tela enquanto ela estiver aberta.</p>
      </div>
    </div>

    <div className="mt-4 rounded-xl border border-sky-200 bg-white/80 p-3 text-sm text-sky-950" role="note">
      <p className="font-black">Nenhuma alteração será realizada.</p>
      <p className="mt-1 text-xs font-semibold leading-relaxed">Não cria pacientes, não cria sessões, não importa, não sincroniza e não grava dados. O token permanece encapsulado no mecanismo autenticado da aplicação.</p>
    </div>

    {!snapshotReady
      ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-900" role="status">Aguardando o provider remoto autenticado carregar o snapshot de pacientes e sessões.</p>
      : <>
        <label className="mt-4 block text-sm font-black text-slate-800" htmlFor="doctoralia-first-party-events">Eventos transcritos, um por linha</label>
        <p className="mt-1 text-xs font-semibold text-slate-500">Formato: data|horário|paciente|serviço|modalidade opcional. A modalidade só é confirmada quando informada explicitamente.</p>
        <textarea id="doctoralia-first-party-events" data-testid="doctoralia-first-party-events-input" value={input} onChange={event => setInput(event.target.value)} placeholder={inputHint} className="mt-2 min-h-32 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none ring-sky-200 focus:ring-2" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="doctoralia-first-party-run" onClick={runPreview} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-sky-800">Executar prévia</button>
          <button type="button" onClick={() => { setInput(''); setResult(null); setError(''); }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">Limpar</button>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500"><ShieldCheck size={15} /> Sem importação</span>
        </div>
        {error && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p>}
        {result && <PreviewResults result={result} />}
      </>}
  </section>;
}

function PreviewResults({ result }: { result: DoctoraliaPreviewResult }) {
  const readyCount = result.importableRows.length;
  return <div className="mt-5" data-testid="doctoralia-first-party-preview-results">
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Eventos analisados</p><p className="mt-1 text-2xl font-black text-slate-900">{result.rows.length}</p></div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Prontos para etapa futura</p><p className="mt-1 text-2xl font-black text-emerald-900">{readyCount}</p></div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-sky-700">Importação nesta etapa</p><p className="mt-1 text-sm font-black text-sky-950">Desabilitada</p></div>
    </div>
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-[920px] w-full text-left text-xs" data-testid="doctoralia-first-party-preview-table">
        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Data</th><th className="px-3 py-3">Horário</th><th className="px-3 py-3">Paciente</th><th className="px-3 py-3">Correspondência</th><th className="px-3 py-3">Sessão</th><th className="px-3 py-3">Serviço</th><th className="px-3 py-3">Modalidade</th><th className="px-3 py-3">Resultado</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{result.rows.map(row => <tr key={row.event.id} className="align-top"><td className="whitespace-nowrap px-3 py-3 font-bold text-slate-700">{row.event.date}</td><td className="whitespace-nowrap px-3 py-3 font-bold text-slate-700">{row.event.startTime}{row.event.endTime ? `–${row.event.endTime}` : ''}</td><td className="max-w-56 px-3 py-3 font-black text-slate-900">{row.event.patientName}</td><td className="px-3 py-3">{statusPill(doctoraliaPreviewPatientMatchLabels[row.patientMatch], row.patientMatch === 'MATCH_EXACT' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}</td><td className="px-3 py-3">{statusPill(doctoraliaPreviewSessionLabels[row.sessionState], row.sessionState === 'ALREADY_EXISTS' ? 'bg-sky-50 text-sky-800' : row.sessionState === 'SCHEDULE_CONFLICT' ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700')}</td><td className="px-3 py-3 font-semibold text-slate-700">{row.serviceId || row.event.serviceName}</td><td className="px-3 py-3">{statusPill(row.modalityState === 'MODALITY_CONFIRMED' ? row.event.modality || 'Confirmada' : 'Revisar modalidade', row.modalityState === 'MODALITY_CONFIRMED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}</td><td className="px-3 py-3">{statusPill(doctoraliaPreviewStatusLabels[row.finalState], resultClass[row.finalState])}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs font-semibold text-slate-500">Blocos e eventos pessoais não foram carregados por este bootstrap; essa dimensão permanece <span className="font-black">NOT_VERIFIED</span> e não é tratada como ausência de conflito.</p>
    <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer font-black text-slate-700">Diagnóstico técnico</summary><p className="mt-2">Classificação em memória sobre o snapshot remoto. Nenhum endpoint adicional, listener, polling ou estágio de persistência é executado.</p></details>
  </div>;
}
