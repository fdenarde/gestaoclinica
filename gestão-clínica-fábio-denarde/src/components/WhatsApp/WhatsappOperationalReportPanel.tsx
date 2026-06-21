import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, MessageCircle } from 'lucide-react';
import {
  formatSaoPauloTime,
  getWhatsappReportStatusLabel,
  type WhatsappOperationalReportState,
} from '../../lib/whatsappOperationalReport';

interface Props {
  state: WhatsappOperationalReportState;
  expanded: boolean;
  onToggle: () => void;
  variant?: 'dashboard' | 'reports';
}

function StatusIcon({ state }: { state: WhatsappOperationalReportState }) {
  if (state.loading) return <Loader2 size={18} className="animate-spin text-clinic-primary" />;
  if (state.error || state.report?.status === 'failed') return <AlertTriangle size={18} className="text-status-red-text" />;
  if (state.report?.status === 'partial') return <AlertTriangle size={18} className="text-status-orange-text" />;
  if (state.report) return <CheckCircle2 size={18} className="text-status-green-text" />;
  return <Clock3 size={18} className="text-clinic-text-faint" />;
}

function EmptyOrError({ state }: { state: WhatsappOperationalReportState }) {
  if (state.loading) return <p>Carregando relatório operacional de hoje...</p>;
  if (state.error) return <p className="font-bold text-status-red-text">{state.error}</p>;
  return <p>Nenhum relatório disponível hoje.</p>;
}

export default function WhatsappOperationalReportPanel({
  state,
  expanded,
  onToggle,
  variant = 'dashboard',
}: Props) {
  const report = state.report;
  const counts = report?.counts || {
    today: 0,
    morning: 0,
    afternoon: 0,
    tomorrow: 0,
    blocked: 0,
    planned: 0,
    confirmed: 0,
    ruleSkipped: 0,
    incomplete: 0,
    pending: 0,
    failures: 0,
  };
  const statusText = state.error || getWhatsappReportStatusLabel(report);

  if (variant === 'reports') {
    return (
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-clinic-primary">Relatório operacional real</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-clinic-text">
              <MessageCircle size={20} className="text-status-green-text" /> WhatsApp
            </h2>
            <p className="mt-1 text-sm text-clinic-text-muted">
              Cópia sanitizada do relatório diário gerado pelo sender. Nenhum envio é iniciado por esta tela.
            </p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-xl border border-clinic-border bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-clinic-primary"
            aria-expanded={expanded}
          >
            {expanded ? 'Recolher' : 'Expandir'}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-clinic-bg p-4">
            <p className="text-[10px] font-black uppercase text-clinic-text-faint">Data</p>
            <p className="mt-1 font-bold text-clinic-text">{report?.reportDate || state.dateKey}</p>
          </div>
          <div className="rounded-xl bg-clinic-bg p-4">
            <p className="text-[10px] font-black uppercase text-clinic-text-faint">Conclusão</p>
            <p className="mt-1 font-bold text-clinic-text">{report ? formatSaoPauloTime(report.completedAt || report.updatedAt) : '--:--'}</p>
          </div>
          <div className="rounded-xl bg-clinic-bg p-4">
            <p className="text-[10px] font-black uppercase text-clinic-text-faint">Destinatário</p>
            <p className="mt-1 font-bold text-clinic-text">{report?.recipientMasked || '*******2659'}</p>
          </div>
          <div className="rounded-xl bg-clinic-bg p-4">
            <p className="text-[10px] font-black uppercase text-clinic-text-faint">Estado</p>
            <p className="mt-1 flex items-center gap-2 font-bold text-clinic-text"><StatusIcon state={state} /> {statusText}</p>
          </div>
        </div>

        {expanded && (
          <div className="mt-5 rounded-xl border border-clinic-border bg-clinic-bg p-4 text-sm text-clinic-text-muted">
            {report ? (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <span>Planejadas: <strong>{counts.planned}</strong></span>
                  <span>Confirmadas: <strong>{counts.confirmed}</strong></span>
                  <span>Bloqueios: <strong>{counts.blocked}</strong></span>
                  <span>Pendentes: <strong>{counts.pending}</strong></span>
                  <span>Falhas: <strong>{counts.failures}</strong></span>
                  <span>Rotina: <strong>{report.latestRoutine || '-'}</strong></span>
                </div>
                <ul className="space-y-1">
                  {report.summary.map(line => <li key={line}>{line}</li>)}
                </ul>
                {report.alerts.length > 0 && (
                  <div className="rounded-lg border border-status-orange-text/20 bg-status-orange-bg p-3 text-status-orange-text">
                    {report.alerts.map(alert => <p key={alert}>{alert}</p>)}
                  </div>
                )}
              </div>
            ) : <EmptyOrError state={state} />}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="bg-clinic-surface border border-clinic-border rounded-xl p-5 shadow-clinic" aria-label="Relatório operacional do WhatsApp">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-clinic-text">WhatsApp</h3>
        <StatusIcon state={state} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-status-green-text/20 bg-status-green-bg p-3 text-center" title={`Manhã: ${counts.morning}; tarde: ${counts.afternoon}`}>
          <p className="text-2xl font-bold text-status-green-text">{counts.today}</p>
          <p className="text-[10px] font-black uppercase text-status-green-text">Hoje</p>
        </div>
        <div className="rounded-lg border border-status-blue-text/20 bg-status-blue-bg p-3 text-center">
          <p className="text-2xl font-bold text-status-blue-text">{counts.tomorrow}</p>
          <p className="text-[10px] font-black uppercase text-status-blue-text">Véspera</p>
        </div>
        <div className="rounded-lg border border-clinic-border/60 bg-clinic-bg p-3 text-center">
          <p className="text-2xl font-bold text-clinic-text">{counts.blocked}</p>
          <p className="text-[10px] font-black uppercase text-clinic-text-faint">Bloqueios</p>
        </div>
      </div>

      <div className="mt-3 border-t border-clinic-border pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold text-clinic-text-muted">{state.loading ? 'Carregando relatório...' : statusText}</p>
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-lg border border-clinic-border bg-white px-3 py-1.5 text-[10px] font-black uppercase text-clinic-primary"
            aria-expanded={expanded}
          >
            {expanded ? 'Recolher' : 'Ver resumo'}
          </button>
        </div>
        {expanded && (
          <div className="mt-3 rounded-lg border border-clinic-border bg-clinic-bg p-3 text-xs text-clinic-text-muted">
            {report ? (
              <div className="space-y-2">
                <p className="font-black text-clinic-text">Relatório de {report.reportDate}</p>
                <p>Destinatário administrativo: {report.recipientMasked}</p>
                <p>{statusText}</p>
                <ul className="space-y-1">
                  {report.summary.map(line => <li key={line}>{line}</li>)}
                </ul>
                {report.alerts.map(alert => <p key={alert} className="font-bold text-status-orange-text">{alert}</p>)}
              </div>
            ) : <EmptyOrError state={state} />}
          </div>
        )}
      </div>
    </div>
  );
}
