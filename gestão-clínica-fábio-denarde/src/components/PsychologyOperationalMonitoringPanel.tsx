import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  getPsychologyOperationalMonitoring,
  type PsychologyOperationalMonitoringData,
} from '../lib/psychologyOperationalMonitoringApi';

const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';

function formatTechnicalDate(value: string | null): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>;
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0"><span className="text-sm font-bold text-slate-600">{label}</span><span className="text-sm font-black text-slate-900">{value}</span></div>;
}

export default function PsychologyOperationalMonitoringPanel() {
  const [data, setData] = useState<PsychologyOperationalMonitoringData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const firstAccessRef = useRef(false);
  const configuredProfessionalId = String(import.meta.env.VITE_PSYCHOLOGY_PROFESSIONAL_ID || '');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getPsychologyOperationalMonitoring(configuredProfessionalId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o monitoramento.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (firstAccessRef.current) return;
    firstAccessRef.current = true;
    void load();
  }, []);

  return <section className="mx-auto w-full max-w-[96rem] space-y-5" data-testid="psychology-operational-monitoring">
    <header className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-end">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Administrador · Psicologia</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Monitoramento operacional da Psicologia</h1><p className="mt-1 max-w-3xl text-sm font-semibold leading-relaxed text-slate-500">Visão somente leitura para suporte técnico. O painel não consulta prontuários, registros clínicos ou conteúdo de pacientes.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-50"><RefreshCw size={16} /> {loading ? 'Atualizando…' : 'Atualizar'}</button>
    </header>

    {loading && !data && <div className={`${cardClass} text-sm font-bold text-slate-600`}>Consultando o estado operacional do escopo autorizado…</div>}
    {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800" role="alert">{error}</div>}
    {data && <>
      <section className={cardClass}><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 text-emerald-600" size={21} /><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Ambiente operacional</p><h2 className="mt-1 text-xl font-black text-slate-950">{data.environment.professionalName}</h2><p className="mt-1 text-sm font-semibold text-slate-600">Contexto {data.scope.context} · telefone técnico {data.environment.professionalPhone}</p></div><span className="ml-auto rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{data.environment.status}</span></div></section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Pacientes cadastrados" value={data.counts.patients} /><Metric label="Sessões" value={data.counts.sessions} /><Metric label="Itens em revisão" value={data.counts.patientsInReview} /><Metric label="Serviços ativos" value={data.counts.activeServices} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cardClass}><div className="flex items-center gap-2"><Database size={18} className="text-violet-700" /><h2 className="font-black text-slate-950">Persistência</h2></div><div className="mt-3"><StatusRow label="Provider" value={data.environment.provider} /><StatusRow label="Estado" value={data.persistence.status} /><StatusRow label="Modo" value={data.persistence.mode} /><StatusRow label="Última atualização técnica" value={formatTechnicalDate(data.persistence.lastSyncAt)} /></div></section>
        <section className={cardClass}><div className="flex items-center gap-2"><Clock3 size={18} className="text-violet-700" /><h2 className="font-black text-slate-950">Serviços operacionais</h2></div><div className="mt-3"><StatusRow label="Agendamento Online" value={data.onlineBooking.status} /><StatusRow label="Locais ativos" value={String(data.counts.activeLocations)} /><StatusRow label="Agenda Pessoal" value={String(data.counts.personalAppointments)} /><StatusRow label="Integrações externas" value={data.integrations.status} /></div></section>
        <section className={cardClass}><h2 className="font-black text-slate-950">Backup</h2><div className="mt-3"><StatusRow label="Estado" value={data.backup.status} /><StatusRow label="Escopo" value={data.backup.scope} /><StatusRow label="Última consulta" value={formatTechnicalDate(data.generatedAt)} /></div></section>
        <section className={cardClass}><h2 className="font-black text-slate-950">Dados agregados</h2><div className="mt-3"><StatusRow label="Pacotes" value={String(data.counts.packages)} /><StatusRow label="Manifests de documentos" value={String(data.counts.documentManifests)} /><StatusRow label="Manifests de anexos" value={String(data.counts.attachmentManifests)} /><StatusRow label="Conteúdo clínico" value={data.clinicalContent.status} /></div></section>
      </div>
      {data.alerts.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-700" /><h2 className="font-black text-amber-950">Alertas técnicos</h2></div><ul className="mt-2 space-y-1 text-sm font-semibold text-amber-900">{data.alerts.map(alert => <li key={alert}>• {alert}</li>)}</ul></section>}
      <footer className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs font-semibold text-slate-600"><ShieldCheck size={18} className="shrink-0 text-emerald-700" /><p>Acesso administrativo auditável e somente leitura. Este painel não exibe prontuário, anamnese, evolução, notas clínicas, conteúdo de documentos ou mensagens.</p></footer>
    </>}
  </section>;
}
