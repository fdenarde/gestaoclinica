import { useRef, useState } from 'react';
import { Archive, CheckCircle2, Download, FileCheck2, FileInput, FileOutput, LockKeyhole, ShieldAlert, Upload, XCircle } from 'lucide-react';
import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { analyzeImportInput } from './adapters';
import { createPsychologyBackupZip, createSyntheticPsychologyStore, verifyPsychologyBackupFiles, verifyPsychologyBackupZip } from './backup';
import { analysisToDryRun } from './pipeline';
import { REAL_IMPORT_DISABLED_MESSAGE, SOURCE_LABELS, type DoctoraliaImportAnalysis, type ImportAnalysis, type ImportFileInput, type ImportSource, type BackupFile, type BackupVerification, type DryRunResult } from './types';

type PanelMode = 'import' | 'verify' | null;

const buttonPrimary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const buttonSecondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBytes(bytes: Uint8Array, name: string, mimeType: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function localBackupName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `GESTAO-CLINICA-PSICOLOGIA-BACKUP-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: number | string; tone?: 'slate' | 'emerald' | 'amber' | 'rose' }) {
  const styles = { slate: 'bg-slate-50 text-slate-800', emerald: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-800' };
  return <div className={`rounded-xl px-3 py-3 ${styles[tone]}`}><p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>;
}

function BackupVerificationCard({ result }: { result: BackupVerification }) {
  return <div className={`mt-4 rounded-2xl border p-4 ${result.intact ? 'border-emerald-200 bg-emerald-50/70' : 'border-rose-200 bg-rose-50/70'}`} data-testid="psychology-backup-verification">
    <div className="flex items-start gap-3">{result.intact ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={21} /> : <ShieldAlert className="mt-0.5 text-rose-600" size={21} />}<div><p className="font-black">{result.intact ? 'Backup íntegro' : 'Backup com problemas'}</p><p className="mt-1 text-sm text-slate-700">{result.files} arquivo(s) verificado(s) localmente.</p></div></div>
    {result.problems.length > 0 && <ul className="mt-3 space-y-1 text-sm text-rose-800">{result.problems.slice(0, 5).map(problem => <li key={problem}>• {problem}</li>)}</ul>}
    {result.warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-800">{result.warnings.slice(0, 5).map(warning => <li key={warning}>• {warning}</li>)}</ul>}
    {result.manifest && <p className="mt-3 text-xs font-bold text-slate-600">Formato {result.manifest.format} v{result.manifest.version} · contexto {result.manifest.context} · SHA-256</p>}
  </div>;
}

function DoctoraliaReviewCard({ analysis, selectedRecoveryIds, onToggleRecovery }: { analysis: DoctoraliaImportAnalysis; selectedRecoveryIds: string[]; onToggleRecovery: (externalPatientId: string) => void }) {
  const { patientCounts, appointmentCounts } = analysis.dryRun;
  const modalities = Array.from(new Set(analysis.dryRun.appointments.map(item => item.modality))).join(' · ') || 'nenhuma';
  const locationNames = analysis.dryRun.locations.map(item => item.name).join(', ') || 'nenhum';
  const serviceNames = analysis.dryRun.services.map(item => item.name).join(', ') || 'nenhum';
  return <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4" data-testid="doctoralia-dry-run-review">
    <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 text-amber-700" size={21} /><div><p className="font-black text-amber-950">Doctoralia · classificação conservadora</p><p className="mt-1 text-sm text-amber-900">Somente análise local. Nenhum paciente, consulta ou catálogo foi gravado.</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Total pacientes" value={patientCounts.total} /><Stat label="Grupo A" value={patientCounts.groupA} tone="emerald" /><Stat label="Grupo B" value={patientCounts.groupB} tone="amber" /><Stat label="Grupo C" value={patientCounts.groupC} tone="rose" /></div>
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Ativos por futuro" value={patientCounts.activeByFutureEvidence} tone="emerald" /><Stat label="Inativos/revisão" value={patientCounts.inactiveReview} tone="amber" /><Stat label="Não migrados" value={patientCounts.notImportedInitially} tone="rose" /><Stat label="Consultas elegíveis" value={appointmentCounts.importable} /></div>
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Consultas lidas" value={appointmentCounts.totalOriginal} /><Stat label="Antes do corte" value={appointmentCounts.beforeCutoff} /><Stat label="No corte/em diante" value={appointmentCounts.atOrAfterCutoff} /><Stat label="Canceladas" value={appointmentCounts.cancelled} tone="amber" /></div>
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Futuras" value={appointmentCounts.future} tone="emerald" /><Stat label="Histórico desconhecido" value={appointmentCounts.historicalAttendanceUnknown} tone="amber" /><Stat label="Locais físicos" value={analysis.dryRun.locations.length} /><Stat label="Serviços" value={analysis.dryRun.services.length} /></div>
    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div className="rounded-xl border border-amber-200 bg-white/70 p-3"><p className="font-black">Locais</p><p className="mt-1 text-slate-700">{locationNames}</p></div><div className="rounded-xl border border-amber-200 bg-white/70 p-3"><p className="font-black">Modalidades</p><p className="mt-1 text-slate-700">{modalities}</p></div><div className="rounded-xl border border-amber-200 bg-white/70 p-3"><p className="font-black">Serviços</p><p className="mt-1 text-slate-700">{serviceNames}</p></div></div>
    <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-3 text-sm text-amber-950"><p><strong>Grupo A:</strong> histórico não cancelado; ACTIVE somente com appointment futuro não cancelado.</p><p className="mt-1"><strong>Grupo B:</strong> somente cancelamentos; INACTIVE — revisar cadastro.</p><p className="mt-1"><strong>Grupo C:</strong> Não migrados — nenhum agendamento encontrado.</p></div>
    {analysis.dryRun.notImportedPatients.length > 0 && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3"><p className="text-sm font-black text-slate-800">Recuperação manual futura · somente estado local</p><div className="mt-2 space-y-2">{analysis.dryRun.notImportedPatients.slice(0, 20).map(patient => <div key={patient.externalPatientId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-slate-700">{patient.name}</span><button type="button" onClick={() => onToggleRecovery(patient.externalPatientId)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-black ${selectedRecoveryIds.includes(patient.externalPatientId) ? 'border-violet-300 bg-violet-100 text-violet-800' : 'border-slate-200 bg-white text-slate-600'}`}>{selectedRecoveryIds.includes(patient.externalPatientId) ? 'Selecionado para revisão' : 'Incluir mesmo assim'}</button></div>)}</div><p className="mt-2 text-xs font-bold text-slate-500">A seleção não persiste e não habilita importação nesta etapa.</p></div>}
    <p className="mt-4 text-xs font-bold text-slate-600">Corte de consultas: {analysis.cutoff} · timezone: {analysis.timezone} · comparecimento passado não é inferido.</p>
  </div>;
}

export default function PsychologyImportExport({ store }: { store: PsychologyStore }) {
  const [mode, setMode] = useState<PanelMode>(null);
  const [source, setSource] = useState<ImportSource>('csv');
  const [selectedFile, setSelectedFile] = useState<ImportFileInput | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [verification, setVerification] = useState<BackupVerification | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedRecoveryIds, setSelectedRecoveryIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetAnalysis = () => { setSelectedFile(null); setAnalysis(null); setDryRun(null); setVerification(null); setSelectedRecoveryIds([]); setError(''); setStatus(''); };
  const selectMode = (nextMode: PanelMode) => { setMode(nextMode); resetAnalysis(); };

  const readFile = async (file: File): Promise<ImportFileInput> => {
    if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo excede o limite local de 10 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isText = /\.(csv|json)$/i.test(file.name);
    return { fileName: file.name, mimeType: file.type, bytes, text: isText ? new TextDecoder().decode(bytes) : undefined, source };
  };

  const analyzeFile = async (fileInput: ImportFileInput) => {
    setBusy(true); setError(''); setStatus(''); setDryRun(null);
    try {
      const nextAnalysis = analyzeImportInput(fileInput);
      setSelectedFile(fileInput); setAnalysis(nextAnalysis); setStatus(nextAnalysis.recognition.message);
    } catch (cause) {
      setAnalysis(null); setError(cause instanceof Error ? cause.message : 'Não foi possível analisar o arquivo.');
    } finally { setBusy(false); }
  };

  const handleFile = async (file: File) => {
    try {
      const fileInput = await readFile(file);
      if (mode === 'verify') {
        setBusy(true); setError(''); setStatus(''); setSelectedFile(fileInput);
        const result = /\.zip$/i.test(file.name) ? await verifyPsychologyBackupZip(fileInput.bytes || new Uint8Array()) : await verifyJsonBackup(fileInput);
        setVerification(result); setStatus(result.intact ? 'Verificação local concluída.' : 'A verificação encontrou problemas.');
      } else await analyzeFile(fileInput);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler o arquivo.');
    } finally { setBusy(false); }
  };

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    try {
      const inputs = await Promise.all(files.map(readFile));
      if (source !== 'doctoralia') return void handleFile(files[0]);
      const previous = selectedFile;
      const combined = inputs.length > 1
        ? { ...inputs[0], relatedFiles: inputs.slice(1) }
        : previous && previous.source === 'doctoralia' && previous.fileName !== inputs[0].fileName
          ? { ...previous, relatedFiles: [...(previous.relatedFiles || []), inputs[0]] }
          : inputs[0];
      await analyzeFile(combined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível ler os arquivos.');
    }
  };

  const handleSyntheticCsv = async () => {
    const text = 'entity,id,nome,data_nascimento,telefone,data,hora,paciente_id\npatient,syn-001,Paciente CSV Sintético,10/05/1990,(27) 99999-1111,,,\nappointment,syn-a-001,,,,2026-01-16,09:00,syn-001';
    await analyzeFile({ fileName: 'psicologia-sintetico.csv', mimeType: 'text/csv', text, bytes: new TextEncoder().encode(text), source: 'csv' });
  };

  const handleBackup = async () => {
    setBusy(true); setError('');
    try {
      const bytes = await createPsychologyBackupZip(createSyntheticPsychologyStore());
      downloadBytes(bytes, localBackupName(), 'application/zip');
      setStatus('Backup ZIP sintético criado e baixado localmente. Nenhum dado real foi exportado.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o backup.'); }
    finally { setBusy(false); }
  };

  const handleDryRun = () => {
    if (!analysis) return;
    setDryRun(analysisToDryRun(analysis, store));
    setStatus('Simulação concluída. Nenhum dado foi persistido.');
  };

  return <section className="space-y-5" data-testid="psychology-import-export">
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm"><div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-700 text-white"><Archive size={21} /></div><div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Ajustes · segurança local</p><h3 className="mt-1 text-xl font-black">Importar e exportar dados</h3><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">Analise arquivos, crie um backup local versionado e simule a importação com dados sintéticos. Esta fundação não grava registros reais nem envia dados para serviços externos.</p></div></div></div>

    <div className="grid gap-4 lg:grid-cols-3">
      <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><FileInput className="text-violet-700" size={22} /><div><h4 className="font-black">Importar dados</h4><p className="mt-1 text-sm text-slate-500">Escolha a fonte e analise sem persistir.</p></div></div><button type="button" onClick={() => selectMode('import')} className={`${buttonPrimary} mt-5 w-full`}><Upload size={16} /> Iniciar importação</button></section>
      <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><FileOutput className="text-emerald-700" size={22} /><div><h4 className="font-black">Exportar / Fazer backup</h4><p className="mt-1 text-sm text-slate-500">Gera ZIP sintético local com manifesto e SHA-256.</p></div></div><button type="button" onClick={handleBackup} disabled={busy} className={`${buttonSecondary} mt-5 w-full`}><Download size={16} /> Criar backup</button></section>
      <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><FileCheck2 className="text-sky-700" size={22} /><div><h4 className="font-black">Verificar backup</h4><p className="mt-1 text-sm text-slate-500">Confere manifesto, caminhos, tamanho e checksum.</p></div></div><button type="button" onClick={() => selectMode('verify')} className={`${buttonSecondary} mt-5 w-full`}><LockKeyhole size={16} /> Verificar arquivo</button></section>
    </div>

    {mode && <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm" data-testid="psychology-import-export-flow"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">Fluxo local · {mode === 'import' ? 'Importação' : 'Verificação'}</p><h4 className="mt-1 text-lg font-black">{mode === 'import' ? 'Analisar arquivo antes de qualquer decisão' : 'Verificar backup sem importar'}</h4></div><button type="button" onClick={() => setMode(null)} aria-label="Fechar fluxo" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><XCircle size={19} /></button></div>
       {mode === 'import' && <>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">{['1. Fonte', '2. Arquivo', '3. Analisar', '4. Revisar', '5. Simular'].map((label, index) => <div key={label} className={`rounded-xl px-3 py-2 text-center text-xs font-black ${index <= (analysis ? 3 : selectedFile ? 2 : 1) ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-500'}`}>{label}</div>)}</div>
        <div className="mt-5"><p className="text-sm font-black text-slate-800">1. Fonte do arquivo</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(SOURCE_LABELS) as ImportSource[]).map(item => <button type="button" key={item} onClick={() => { setSource(item); resetAnalysis(); }} className={`rounded-xl border px-3 py-3 text-left text-sm font-black ${source === item ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{SOURCE_LABELS[item]}</button>)}</div></div>
         <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="block"><span className="text-sm font-black text-slate-800">2. Arquivo{source === 'doctoralia' ? 's · selecione os dois CSVs' : ''}</span><input ref={inputRef} multiple={source === 'doctoralia'} type="file" accept=".csv,.json,.zip,.xls,.xlsx" onChange={event => { void handleFiles(event.target.files); }} className={`${inputClass} mt-2`} /></label><button type="button" onClick={() => void handleSyntheticCsv()} disabled={busy || source !== 'csv'} className={buttonSecondary}>Usar CSV sintético</button></div>
      </>}
      {mode === 'verify' && <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="block"><span className="text-sm font-black text-slate-800">Selecione um backup ZIP local</span><input ref={inputRef} type="file" accept=".zip,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} className={`${inputClass} mt-2`} /></label><span className="rounded-xl bg-sky-50 px-3 py-3 text-xs font-bold text-sky-800">Sem importação</span></div>}
       {selectedFile && <p className="mt-3 text-xs font-bold text-slate-500">Arquivo(s) selecionado(s): {selectedFile.fileName}{selectedFile.relatedFiles?.length ? ` + ${selectedFile.relatedFiles.length}` : ''} · {formatBytes((selectedFile.bytes?.byteLength || new TextEncoder().encode(selectedFile.text || '').byteLength) + (selectedFile.relatedFiles || []).reduce((sum, file) => sum + (file.bytes?.byteLength || new TextEncoder().encode(file.text || '').byteLength), 0))}</p>}
      {status && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-800" role="status">{status}</p>}
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p>}
      {verification && <BackupVerificationCard result={verification} />}
       {analysis && <div className="mt-5" data-testid="psychology-import-preview"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-black text-slate-800">3–4. Análise e revisão</p><p className="mt-1 text-sm text-slate-500">{analysis.recognition.message}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-black ${analysis.recognition.recognized ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{analysis.recognition.recognized ? 'Reconhecido' : 'Revisão necessária'}</span></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Válidos" value={analysis.preview.valid} tone="emerald" /><Stat label="Avisos" value={analysis.preview.warnings} tone="amber" /><Stat label="Conflitos" value={analysis.preview.conflicts} tone="rose" /><Stat label="Ignorados" value={analysis.preview.ignored} /></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-black">Administrativos</p><p className="mt-1 text-slate-600">{analysis.preview.administrative} registro(s)</p></div><div className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-black">Clínicos</p><p className="mt-1 text-slate-600">{analysis.preview.clinical} registro(s) separados</p></div></div>{analysis.doctoralia && analysis.doctoralia.recognition.recognized && <DoctoraliaReviewCard analysis={analysis.doctoralia} selectedRecoveryIds={selectedRecoveryIds} onToggleRecovery={externalPatientId => setSelectedRecoveryIds(current => current.includes(externalPatientId) ? current.filter(item => item !== externalPatientId) : [...current, externalPatientId])} />}{analysis.bundle.conflicts.length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{analysis.bundle.conflicts.slice(0, 6).map(item => <li key={`${item.type}-${item.sourceRecordId}`}>• {item.message}</li>)}</ul>}<div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={handleDryRun} disabled={!analysis.recognition.recognized || busy} className={buttonPrimary}>Simular importação</button><button type="button" disabled title={REAL_IMPORT_DISABLED_MESSAGE} className={buttonSecondary}>Importar dados (desabilitado)</button></div><p className="mt-2 text-xs font-bold text-slate-500">O botão de importação real permanece desabilitado nesta etapa.</p></div>}
      {dryRun && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4" data-testid="psychology-import-dry-run"><div className="flex items-center gap-2"><CheckCircle2 size={19} className="text-emerald-700" /><p className="font-black text-emerald-900">5. Simulação concluída sem persistência</p></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><Stat label="Criar" value={dryRun.creates} tone="emerald" /><Stat label="Vincular" value={dryRun.links} /><Stat label="Ignorar" value={dryRun.ignores} /><Stat label="Conflitos" value={dryRun.conflicts} tone="rose" /><Stat label="Avisos" value={dryRun.warnings} tone="amber" /><Stat label="Sem vínculo" value={dryRun.unlinked} /></div><ul className="mt-4 space-y-1 text-sm text-slate-700">{dryRun.details.map(detail => <li key={detail}>• {detail}</li>)}</ul></div>}
    </section>}
    <p className="flex items-center gap-2 text-xs font-bold text-slate-500"><LockKeyhole size={14} /> Escopo protegido: dados locais da Psicologia, sem Firebase/Firestore, WhatsApp, envio externo ou produção.</p>
  </section>;
}

async function verifyJsonBackup(input: ImportFileInput): Promise<BackupVerification> {
  try {
    const parsed = JSON.parse(input.text || '{}') as { manifest?: unknown; files?: Record<string, unknown> };
    if (!parsed.manifest || !parsed.files) return { intact: false, status: 'problems', manifest: null, files: 0, problems: ['JSON de backup deve conter manifest e files.'], warnings: [] };
    const files: BackupFile[] = [{ path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(parsed.manifest, null, 2)) }, ...Object.entries(parsed.files).map(([path, value]) => ({ path, bytes: new TextEncoder().encode(JSON.stringify(value, null, 2)) }))];
    return verifyPsychologyBackupFiles(files);
  } catch {
    return { intact: false, status: 'problems', manifest: null, files: 0, problems: ['JSON de backup corrompido.'], warnings: [] };
  }
}
