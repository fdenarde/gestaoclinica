import React, { useMemo, useState } from 'react';
import { AppState, SessionStatus } from '../types';
import { FileDown, FileUp, Trash2, Printer, Download, Calendar, DollarSign, User, Database, Clock, Plus, Copy } from 'lucide-react';
import { showToast } from './Common/Toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import { formatCurrency, cn, safeFormatDate } from '../lib/utils';
import { copyTextToClipboard } from '../lib/clipboard';
import { getCompletedSessions, getSessionCycleNumber, isCountedAbsenceSession } from '../lib/sessionSequence';
import { isSessionRemovedFromAgenda } from '../../shared/sessionRemoval.js';
import type { WhatsappOperationalReportState } from '../lib/whatsappOperationalReport';
import WhatsappOperationalReportPanel from './WhatsApp/WhatsappOperationalReportPanel';
import {
  buildCurrentPackageSessionSummaries,
  formatCurrentPackageSessionSummaries,
  formatCurrentPackageSessionSummary,
} from '../../shared/sessionPackageSummary.js';

interface ReportsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
  isAdmin?: boolean;
  whatsappReportState: WhatsappOperationalReportState;
}

export default function Reports({ state, isAdmin = false, whatsappReportState }: ReportsProps) {
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [activeReportTab, setActiveReportTab] = useState<'clinical' | 'whatsapp'>('clinical');
  const [whatsappExpanded, setWhatsappExpanded] = useState(false);
  const visibleReportTab = activeReportTab === 'whatsapp' && isAdmin ? 'whatsapp' : 'clinical';

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `backup_clinica_${format(new Date(), 'yyyy-MM-dd')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    showToast('Backup exportado com sucesso!');
  };

  const generateHeader = (doc: jsPDF, title: string) => {
    if (state.settings.customHeader) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor('#6B4C3B');
      
      const lines = doc.splitTextToSize(state.settings.customHeader, 180);
      doc.text(lines, 105, 15, { align: 'center' });
      
      doc.setDrawColor('#E8D5C8');
      doc.line(15, 30 + (lines.length * 4), 195, 30 + (lines.length * 4));
      
      doc.setFontSize(16);
      doc.setFont('playfair', 'bold');
      doc.setTextColor('#2C1810');
      doc.text(title, 105, 40 + (lines.length * 4), { align: 'center' });
      return;
    }

    doc.setFont('playfair', 'bold');
    doc.setFontSize(22);
    doc.setTextColor('#5C3D2E');
    doc.text(state.settings.name, 105, 20, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#6B4C3B');
    doc.text(state.settings.title, 105, 28, { align: 'center' });
    
    doc.setDrawColor('#E8D5C8');
    doc.line(15, 35, 195, 35);
    
    doc.setFontSize(16);
    doc.setFont('playfair', 'bold');
    doc.setTextColor('#2C1810');
    doc.text(title, 105, 45, { align: 'center' });
  };

  const generateFooter = (doc: jsPDF) => {
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor('#A07060');
      doc.setDrawColor('#E8D5C8');
      doc.line(15, 280, 195, 280);
      
      if (state.settings.customFooter) {
        const lines = doc.splitTextToSize(state.settings.customFooter, 180);
        doc.text(lines, 105, 283, { align: 'center' });
        doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')} - Página ${i} de ${pageCount}`, 105, 292, { align: 'center' });
      } else {
        const footerText = `${state.settings.email} | ${state.settings.whatsapp} | ${state.settings.address}`;
        doc.text(footerText, 105, 285, { align: 'center' });
        doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')} - Página ${i} de ${pageCount}`, 105, 290, { align: 'center' });
      }
    }
  };

  const generateIndividualReport = () => {
    const doc = new jsPDF();
    const patientsToReport = selectedPatientId === 'all' ? state.patients : state.patients.filter(p => p.id === selectedPatientId);

    patientsToReport.forEach((patient, index) => {
      if (index > 0) doc.addPage();
      generateHeader(doc, `Relatório de Progresso: ${patient.name}`);

      const patientSessions = state.sessions
        .filter(s => s.patientId === patient.id && !isSessionRemovedFromAgenda(s))
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const realized = getCompletedSessions(patientSessions, patient.id, format(new Date(), 'yyyy-MM-dd')).length;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Dados do Atendente:', 15, 60);
      doc.setFont('helvetica', 'normal');
      doc.text(`Responsável: ${patient.guardianName}`, 15, 65);
      doc.text(`Data de Início: ${safeFormatDate(patient.startDate, 'dd/MM/yyyy')}`, 15, 70);
      doc.text(`Progresso: ${realized} de 10 sessões do ciclo atual`, 15, 75);

      autoTable(doc, {
        startY: 85,
        head: [['S#', 'Data', 'Tipo', 'Status', 'Observação']],
        body: patientSessions.map(s => [
          `S.${getSessionCycleNumber(state.sessions, s) || '-'}`,
          safeFormatDate(s.date, 'dd/MM/yyyy'),
          s.type.split(' (')[0],
          s.status,
          s.notes || '-'
        ]),
        headStyles: { fillColor: [92, 61, 46], textColor: [255, 255, 255] },
        styles: { fontSize: 9, font: 'helvetica' },
        columnStyles: { 4: { cellWidth: 70 } }
      });
    });

    generateFooter(doc);
    doc.save(`progresso_${format(new Date(), 'yyyyMMdd')}.pdf`);
    showToast('Relatório de Progresso gerado!');
  };

  const generateFinanceReport = () => {
    const doc = new jsPDF();
    generateHeader(doc, 'Relatório de Situação Financeira');

    const body = state.patients.map(p => {
      const paid = state.payments.filter(pay => pay.patientId === p.id).reduce((s, pay) => s + pay.amount, 0);
      const remaining = 1000 - paid;
      return [
        p.name,
        p.paymentModal.split(': ')[0],
        formatCurrency(paid),
        formatCurrency(remaining),
        paid >= 1000 ? 'QUITADO' : (paid > 0 ? 'PARCIAL' : 'PENDENTE')
      ];
    });

    autoTable(doc, {
      startY: 60,
      head: [['Atendente', 'Modalidade', 'Total Pago', 'Saldo Devedor', 'Status']],
      body: body,
      headStyles: { fillColor: [196, 96, 58], textColor: [255, 255, 255] },
      styles: { fontSize: 9 }
    });

    const totalReceived = state.payments.reduce((s, p) => s + p.amount, 0);
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Geral Recebido: ${formatCurrency(totalReceived)}`, 195, finalY, { align: 'right' });

    generateFooter(doc);
    doc.save(`financeiro_${format(new Date(), 'yyyyMMdd')}.pdf`);
    showToast('Relatório Financeiro gerado!');
  };

  const generateMonthlyAgendaReport = () => {
    const doc = new jsPDF();
    const [year, month] = selectedMonth.split('-');
    const monthName = format(new Date(Number(year), Number(month) - 1), 'MMMM', { locale: ptBR });
    generateHeader(doc, `Agenda Mensal: ${monthName} / ${year}`);

    const monthlySessions = state.sessions
      .filter(s => {
        if (isSessionRemovedFromAgenda(s)) return false;
        const d = new Date(s.date);
        return d.getMonth() === Number(month) - 1 && d.getFullYear() === Number(year);
      })
      .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.time.localeCompare(b.time));

    autoTable(doc, {
      startY: 60,
      head: [['Data', 'Horário', 'Atendente', 'Tipo', 'Status']],
      body: monthlySessions.map(s => [
        safeFormatDate(s.date, 'dd/MM/yyyy'),
        s.time,
        state.patients.find(p => p.id === s.patientId)?.name || '-',
        s.type.split(' (')[0],
        s.status
      ]),
      headStyles: { fillColor: [92, 61, 46], textColor: [255, 255, 255] },
      styles: { fontSize: 9 }
    });

    generateFooter(doc);
    doc.save(`agenda_${selectedMonth}.pdf`);
    showToast('Agenda Mensal gerada!');
  };

  const exportPatientsCSV = () => {
    const csvData = state.patients.map(p => ({
      Nome: p.name,
      Nascimento: safeFormatDate(p.birthDate, 'dd/MM/yyyy'),
      Responsável: p.guardianName,
      WhatsApp: p.whatsapp,
      Status: p.status,
      Modalidade: p.paymentModal,
      'Dia Fixo': p.fixedDay,
      'Horário Fixo': p.fixedTime,
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pacientes_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    showToast('Planilha de Atendentes gerada!');
  };

  const exportFinanceCSV = () => {
    const csvData = state.patients.map(p => {
      const paid = state.payments.filter(pay => pay.patientId === p.id).reduce((s, pay) => s + pay.amount, 0);
      const remaining = 1000 - paid;
      return {
        Atendente: p.name,
        Modalidade: p.paymentModal.split(': ')[0],
        'Total Pago': paid,
        'Saldo Devedor': remaining,
        Status: paid >= 1000 ? 'QUITADO' : (paid > 0 ? 'PARCIAL' : 'PENDENTE')
      };
    });
    const csv = Papa.unparse(csvData);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    showToast('Planilha Financeira gerada!');
  };

  const currentPackageSummaries = useMemo(() => (
    buildCurrentPackageSessionSummaries(state.patients, state.sessions, {
      plannedSessions: 10,
      onlyActive: true,
    })
  ), [state.patients, state.sessions]);

  const copyPackageSummary = async (text: string, successMessage: string) => {
    try {
      await copyTextToClipboard(text);
      showToast(successMessage);
    } catch (copyError) {
      console.error('[Reports] Falha ao copiar resumo de sessões:', copyError);
      showToast('Não foi possível copiar o resumo de sessões.', 'error');
    }
  };

  const copyAllSessionsSummary = async () => {
    const finalReport = formatCurrentPackageSessionSummaries(currentPackageSummaries, {
      reportDate: format(new Date(), 'dd/MM/yyyy'),
    });
    await copyPackageSummary(finalReport, 'Resumo de todos os atendentes copiado!');
  };

  const reportTabHeader = (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-clinic-border bg-clinic-surface p-2 shadow-sm">
      <button
        type="button"
        onClick={() => setActiveReportTab('clinical')}
        className={cn(
          'rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide',
          visibleReportTab === 'clinical' ? 'bg-clinic-primary text-white' : 'bg-clinic-bg text-clinic-text-muted',
        )}
        aria-current={visibleReportTab === 'clinical' ? 'page' : undefined}
      >
        Clínicos e financeiros
      </button>
      {isAdmin && (
        <button
          type="button"
          onClick={() => setActiveReportTab('whatsapp')}
          className={cn(
            'rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide',
            visibleReportTab === 'whatsapp' ? 'bg-clinic-primary text-white' : 'bg-clinic-bg text-clinic-text-muted',
          )}
          aria-current={visibleReportTab === 'whatsapp' ? 'page' : undefined}
        >
          WhatsApp
        </button>
      )}
    </div>
  );

  if (visibleReportTab === 'whatsapp') {
    return (
      <div className="space-y-6 pb-10">
        {reportTabHeader}
        <WhatsappOperationalReportPanel
          state={whatsappReportState}
          expanded={whatsappExpanded}
          onToggle={() => setWhatsappExpanded(open => !open)}
          variant="reports"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      {reportTabHeader}
      {/* Visual Quick Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-sm">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold flex items-center gap-2">
              <Clock size={18} className="text-clinic-primary" />
              Sessões Restantes (Pacote atual)
             </h3>
             <button
               type="button"
               onClick={copyAllSessionsSummary}
               disabled={currentPackageSummaries.length === 0}
               className="flex items-center gap-1 px-2 py-1 bg-clinic-primary text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
               title="Copiar resumo de todos os atendentes"
               aria-label="Copiar resumo de todos os atendentes"
             >
               <Copy size={12} />
               Copiar todos
             </button>
           </div>
           <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
             {currentPackageSummaries.length === 0 && (
               <p className="rounded-lg border border-dashed border-clinic-border bg-clinic-bg p-4 text-center text-sm text-clinic-text-muted">
                 Nenhum atendente ativo disponível para o pacote atual.
               </p>
             )}
             {currentPackageSummaries.map(summary => {
               const patient = summary.patient;
               const summaryText = formatCurrentPackageSessionSummary(summary, {
                 includeReportHeader: true,
                 reportDate: format(new Date(), 'dd/MM/yyyy'),
               });

               return (
                 <div key={patient.id} className="flex justify-between items-center p-3 rounded-lg border border-clinic-border bg-white gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                         <span className="text-sm font-bold truncate">{patient.name}</span>
                         <button
                            type="button"
                            onClick={() => copyPackageSummary(summaryText, `Resumo de ${patient.name} copiado!`)}
                            className="p-1 hover:bg-clinic-bg/50 rounded flex-shrink-0 transition-colors"
                            title={`Copiar resumo de sessões de ${patient.name}`}
                            aria-label={`Copiar resumo de sessões de ${patient.name}`}
                         >
                           <Copy size={14} className="text-clinic-text-muted" />
                         </button>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {summary.sessions.slice(-summary.plannedSessions).map(session => {
                           const isReposicao = session.status === SessionStatus.REPOSICAO;
                           const isCountedAbsence = isCountedAbsenceSession(session);
                           return (
                             <div key={session.id} className="flex flex-col items-center gap-0.5">
                               <div className={cn(
                                 "w-3 h-3 rounded-full",
                                  isCountedAbsence ? "bg-[#A94444]" : isReposicao ? "bg-[#E67E22]" : "bg-clinic-primary"
                               )} />
                               <span className="text-[8px] text-clinic-text-muted font-medium">
                                 {safeFormatDate(session.date, 'dd/MM')}
                               </span>
                             </div>
                           );
                        })}
                        {Array.from({ length: summary.remaining }).map((_, index) => (
                           <div key={`rem-${patient.id}-${index}`} className="flex flex-col items-center gap-0.5">
                             <div className="w-3 h-3 rounded-full bg-clinic-bg border border-clinic-border" />
                             <span className="text-[8px] text-clinic-text-faint">&nbsp;</span>
                           </div>
                        ))}
                      </div>
                      <div className="flex gap-3 text-[9px] text-clinic-text-muted mt-1">
                        <span className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-clinic-primary" />
                          Normal
                        </span>
                         <span className="flex items-center gap-1">
                           <div className="w-2 h-2 rounded-full bg-[#E67E22]" />
                           Reposição
                         </span>
                         <span className="flex items-center gap-1">
                           <div className="w-2 h-2 rounded-full bg-[#A94444]" />
                           Falta contabilizada
                         </span>
                        <span className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-clinic-bg border border-clinic-border" />
                          Restante
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold text-clinic-primary">{summary.count}/{summary.plannedSessions}</span>
                      <span className="text-[10px] font-bold text-clinic-text-faint">{summary.remaining} rest.</span>
                    </div>
                 </div>
               );
             })}
           </div>
        </div>

        <div className="bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-sm">
           <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Plus size={18} className="text-clinic-primary" />
            Renovações Próximas
           </h3>
           <div className="space-y-3">
             {state.patients.filter(p => {
               const count = getCompletedSessions(state.sessions, p.id, format(new Date(), 'yyyy-MM-dd')).length % 10 || 0;
               return count >= 8;
             }).map(patient => (
               <div key={patient.id} className="p-4 rounded-xl bg-status-blue-bg border border-blue-100 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="font-bold text-status-blue-text">{patient.name}</span>
                    <span className="text-[10px] uppercase font-bold text-status-blue-text opacity-70">Atingiu sessão 8+</span>
                  </div>
                  <span className="text-xs font-bold px-3 py-1 bg-white rounded-full text-status-blue-text shadow-sm">Sugerir Renovação</span>
               </div>
             ))}
             {state.patients.filter(p => (getCompletedSessions(state.sessions, p.id, format(new Date(), 'yyyy-MM-dd')).length % 10) >= 8).length === 0 && (
               <p className="text-sm text-clinic-text-muted italic text-center py-6">Nenhum atendente próximo da renovação.</p>
             )}
           </div>
        </div>
      </div>

      {/* PDF Generators Section */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-clinic-border bg-clinic-bg/10 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Printer size={20} /> Relatórios em PDF
          </h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
           {/* Report 1 */}
           <div className="flex flex-col gap-4 p-5 rounded-2xl border border-clinic-border bg-white hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-clinic-bg rounded-xl text-clinic-primary"><User size={24} /></div>
                <h4 className="font-bold text-sm">Progresso Individual</h4>
              </div>
              <p className="text-[10px] text-clinic-text-muted mb-2">Histórico de sessões, presenças, faltas e anotações por atendente.</p>
              <select 
                value={selectedPatientId}
                onChange={e => setSelectedPatientId(e.target.value)}
                className="w-full px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs outline-none focus:ring-1 focus:ring-clinic-primary"
              >
                <option value="all">Todos os Atendentes</option>
                {state.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex gap-2">
                <button 
                  onClick={generateIndividualReport}
                  className="flex-1 py-3 bg-clinic-header text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> PDF
                </button>
                <button 
                  onClick={exportPatientsCSV}
                  className="flex-1 py-3 bg-[#107C41] text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> CSV
                </button>
              </div>
           </div>

           {/* Report 2 */}
           <div className="flex flex-col gap-4 p-5 rounded-2xl border border-clinic-border bg-white hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-status-green-bg text-status-green-text rounded-xl"><DollarSign size={24} /></div>
                <h4 className="font-bold text-sm">Situação Financeira</h4>
              </div>
              <p className="text-[10px] text-clinic-text-muted mb-2">Controle de pagamentos, saldos devedores e status por modalidade.</p>
              <div className="h-[32px]"></div> {/* Spacer to align buttons */}
              <div className="flex gap-2">
                <button 
                  onClick={generateFinanceReport}
                  className="flex-1 py-3 bg-clinic-primary text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> PDF
                </button>
                <button 
                  onClick={exportFinanceCSV}
                  className="flex-1 py-3 bg-[#107C41] text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> CSV
                </button>
              </div>
           </div>

           {/* Report 3 */}
           <div className="flex flex-col gap-4 p-5 rounded-2xl border border-clinic-border bg-white hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-status-blue-bg text-status-blue-text rounded-xl"><Calendar size={24} /></div>
                <h4 className="font-bold text-sm">Agenda Mensal</h4>
              </div>
              <p className="text-[10px] text-clinic-text-muted mb-2">Lista completa de agendamentos realizados em um período específico.</p>
              <input 
                type="month" 
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs outline-none focus:ring-1 focus:ring-clinic-primary"
              />
              <button 
                onClick={generateMonthlyAgendaReport}
                className="w-full py-3 bg-clinic-text text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
              >
                <Download size={16} /> Gerar PDF
              </button>
           </div>
        </div>
      </div>

      {/* Backup Section */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border overflow-hidden shadow-sm">
         <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2">
            <Database size={20} className="text-clinic-text-faint" />
            <h2 className="text-xl font-bold">Gerenciamento de Dados e Backup</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <button 
              onClick={handleExportJSON}
              className="flex items-center justify-center gap-3 p-6 bg-white border border-clinic-border rounded-2xl hover:bg-clinic-bg/50 transition-all group"
            >
              <div className="p-3 bg-status-green-bg text-status-green-text rounded-xl group-hover:scale-110 transition-transform"><FileDown size={28} /></div>
              <div className="text-left">
                <span className="block font-bold text-sm">Exportar Backup</span>
                <span className="block text-[10px] text-clinic-text-muted">Salvar arquivo JSON no computador</span>
              </div>
            </button>

            <button
              type="button"
              disabled
              title="Desativado para proteger os dados reais durante a fase de testes."
              className="flex items-center justify-center gap-3 p-6 bg-white border border-clinic-border rounded-2xl opacity-60 cursor-not-allowed"
            >
              <div className="p-3 bg-status-blue-bg text-status-blue-text rounded-xl"><FileUp size={28} /></div>
              <div className="text-left">
                <span className="block font-bold text-sm">Importar Backup</span>
                <span className="block text-[10px] text-clinic-text-muted">Desativado para proteger dados reais</span>
              </div>
            </button>

            <button 
              type="button"
              disabled
              title="Desativado para proteger os dados reais durante a fase de testes."
              className="flex items-center justify-center gap-3 p-6 bg-white border border-clinic-border rounded-2xl opacity-60 cursor-not-allowed"
            >
              <div className="p-3 bg-status-red-bg text-status-red-text rounded-xl"><Trash2 size={28} /></div>
              <div className="text-left">
                <span className="block font-bold text-sm text-status-red-text">Limpar Sistema</span>
                <span className="block text-[10px] text-clinic-text-muted">Desativado para proteger dados reais</span>
              </div>
            </button>
          </div>
      </div>

    </div>
  );
}
