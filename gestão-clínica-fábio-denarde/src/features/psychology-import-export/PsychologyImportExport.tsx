import { useState } from 'react';
import { Archive, Download, ShieldCheck } from 'lucide-react';
import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { REAL_IMPORT_DISABLED_MESSAGE } from './types';
import type { PsychologyBackupJsonResult } from './backup';

export type PsychologyBackupGenerator = () => Promise<PsychologyBackupJsonResult>;

/** Preserved for the development-only import infrastructure; it is not rendered in the professional UX. */
export function getPsychologyImportSafetyMessageForDevelopment(): string {
  return REAL_IMPORT_DISABLED_MESSAGE;
}

function downloadBackup(result: PsychologyBackupJsonResult): void {
  const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PsychologyImportExport({ onGenerateBackup }: { store?: PsychologyStore; onGenerateBackup?: PsychologyBackupGenerator }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleBackup = async () => {
    if (!onGenerateBackup) {
      setError('O backup autenticado da Psicologia ainda não está disponível nesta sessão.');
      return;
    }
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const result = await onGenerateBackup();
      downloadBackup(result);
      setStatus('Backup dos meus dados gerado e baixado. Nenhum dado foi alterado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o backup.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm" data-testid="psychology-backup-my-data">
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-700 text-white"><Archive size={21} /></div>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Segurança dos seus dados</p>
        <h3 className="mt-1 text-xl font-black text-slate-950">Backup dos meus dados</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">Gere uma cópia dos seus dados da Psicologia usando a conta autenticada e o escopo autorizado. A restauração não está disponível nesta etapa.</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {onGenerateBackup
        ? <button type="button" onClick={() => { void handleBackup(); }} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"><Download size={16} /> {busy ? 'Gerando…' : 'Gerar backup'}</button>
        : <p className="text-sm font-bold text-slate-500">Backup remoto disponível no modo autenticado.</p>}
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500"><ShieldCheck size={15} /> Somente leitura</span>
    </div>
    {status && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-bold text-emerald-800" role="status">{status}</p>}
    {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p>}
  </section>;
}
