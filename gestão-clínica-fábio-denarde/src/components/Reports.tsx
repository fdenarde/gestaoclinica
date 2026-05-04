import React, { useState } from 'react';
import { AppState, SessionStatus, Patient } from '../types';
import { FileDown, FileUp, Trash2, Printer, Download, Calendar, DollarSign, User, Database, Clock, Plus, Copy } from 'lucide-react';
import { showToast } from './Common/Toast';
import { clearState, loadState, saveState } from '../lib/storage';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import { CLINIC_INFO } from '../constants';
import { formatCurrency, cn, safeFormatDate } from '../lib/utils';
import Modal from './Common/Modal';

interface ReportsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
}

export default function Reports({ state, onUpdate }: ReportsProps) {
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [isClearDataOpen, setIsClearDataOpen] = useState(false);

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

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        onUpdate(json);
        showToast('Dados restaurados com sucesso!');
      } catch (err) {
        showToast('Erro ao importar arquivo.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleClearData = () => {
    setIsClearDataOpen(true);
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
        .filter(s => s.patientId === patient.id)
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const realized = patientSessions.filter(s => s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO).length;

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
          `S.${s.packageNumber}`,
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

  const copyAllSessionsSummary = () => {
    const allSummaries = state.patients
      .filter(p => p.status === 'Ativo')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(patient => {
        const patientSessions = state.sessions
          .filter(s => s.patientId === patient.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const count = patientSessions.length % 10 || (patientSessions.length > 0 ? 10 : 0);
        const remaining = 10 - count;

        const lines = [
          `Atendente: ${patient.name}`,
          `Responsável: ${patient.guardianName}`,
          'Sessões realizadas:'
        ];
        patientSessions.slice(-10).forEach((s, index) => {
          const isReposicao = s.status === SessionStatus.REPOSICAO;
          const tipoLabel = isReposicao ? 'reposição' : 'sessão normal';
          lines.push(`${index + 1}. ${safeFormatDate(s.date, 'dd/MM')} - ${tipoLabel}`);
        });
        lines.push(`Sessões restantes no pacote atual: ${remaining}`);
        lines.push('---');
        return lines.join('\n');
      })
      .join('\n');

    navigator.clipboard.writeText(allSummaries);
    showToast('Resumo de todos os atendentes copiado!');
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Visual Quick Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-sm">
           <div className="flex items-center justify-between mb-4">
             <h3 className="font-serif text-lg font-bold flex items-center gap-2">
              <Clock size={18} className="text-clinic-primary" />
              Sessões Restantes (Pacote atual)
             </h3>
             <button
               onClick={copyAllSessionsSummary}
               className="flex items-center gap-1 px-2 py-1 bg-clinic-primary text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
               title="Copiar resumo de todos os atendentes"
             >
               <Copy size={12} />
               Copiar todos
             </button>
           </div>
           <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
             {state.patients.filter(p => p.status === 'Ativo').sort((a,b) => a.name.localeCompare(b.name)).map(patient => {
               const patientSessions = state.sessions.filter(s => s.patientId === patient.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
               const count = patientSessions.length % 10 || (patientSessions.length > 0 ? 10 : 0);
               const remaining = 10 - count;

               // Copy summary to clipboard
               const summaryLines = [
                 `Atendente: ${patient.name}`,
                 `Responsável: ${patient.guardianName}`,
                 'Sessões realizadas:'
               ];
               patientSessions.slice(-10).forEach((s, index) => {
                 const isReposicao = s.status === SessionStatus.REPOSICAO;
                 const tipoLabel = isReposicao ? 'reposição' : 'sessão normal';
                 summaryLines.push(`${index + 1}. ${safeFormatDate(s.date, 'dd/MM')} - ${tipoLabel}`);
               });
               summaryLines.push(`Sessões restantes no pacote atual: ${remaining}`);
               const summaryText = summaryLines.join('\n');

               return (
                 <div key={patient.id} className="flex justify-between items-center p-3 rounded-lg border border-clinic-border bg-white gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                         <span className="text-sm font-bold truncate">{patient.name}</span>
                         <button
                            onClick={() => {
                              navigator.clipboard.writeText(summaryText);
                              showToast('Resumo copiado!');
                            }}
                            className="p-1 hover:bg-clinic-bg/50 rounded flex-shrink-0 transition-colors"
                            title="Copiar resumo de sessões"
                         >
                           <Copy size={14} className="text-clinic-text-muted" />
                         </button>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {patientSessions.slice(-10).map(s => {
                           const isReposicao = s.status === SessionStatus.REPOSICAO;
                           return (
                             <div key={s.id} className="flex flex-col items-center gap-0.5">
                               <div className={cn(
                                 "w-3 h-3 rounded-full",
                                 isReposicao ? "bg-[#E67E22]" : "bg-clinic-primary"
                               )} />
                               <span className="text-[8px] text-clinic-text-muted font-medium">
                                 {safeFormatDate(s.date, 'dd/MM')}
                               </span>
                             </div>
                           );
                        })}
                        {Array.from({ length: remaining }).map((_, i) => (
                           <div key={`rem-${i}`} className="flex flex-col items-center gap-0.5">
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
                          <div className="w-2 h-2 rounded-full bg-clinic-bg border border-clinic-border" />
                          Restante
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold text-clinic-primary">{count}/10</span>
                      <span className="text-[10px] font-bold text-clinic-text-faint">{remaining} rest.</span>
                    </div>
                 </div>
               );
             })}
           </div>
        </div>

        <div className="bg-clinic-surface p-6 rounded-2xl border border-clinic-border shadow-sm">
           <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
            <Plus size={18} className="text-clinic-primary" />
            Renovações Próximas
           </h3>
           <div className="space-y-3">
             {state.patients.filter(p => {
               const count = state.sessions.filter(s => s.patientId === p.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).length % 10 || 0;
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
             {state.patients.filter(p => (state.sessions.filter(s => s.patientId === p.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).length % 10) >= 8).length === 0 && (
               <p className="text-sm text-clinic-text-muted italic text-center py-6">Nenhum atendente próximo da renovação.</p>
             )}
           </div>
        </div>
      </div>

      {/* PDF Generators Section */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-clinic-border bg-clinic-bg/10 flex items-center justify-between">
          <h2 className="font-serif text-xl font-bold flex items-center gap-2">
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
            <h2 className="font-serif text-xl font-bold">Gerenciamento de Dados e Backup</h2>
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

            <label className="flex items-center justify-center gap-3 p-6 bg-white border border-clinic-border rounded-2xl hover:bg-clinic-bg/50 transition-all group cursor-pointer">
              <input type="file" className="hidden" accept=".json" onChange={handleImportJSON} />
              <div className="p-3 bg-status-blue-bg text-status-blue-text rounded-xl group-hover:scale-110 transition-transform"><FileUp size={28} /></div>
              <div className="text-left">
                <span className="block font-bold text-sm">Importar Backup</span>
                <span className="block text-[10px] text-clinic-text-muted">Restaurar dados de um arquivo</span>
              </div>
            </label>

            <button 
              onClick={handleClearData}
              className="flex items-center justify-center gap-3 p-6 bg-white border border-clinic-border rounded-2xl hover:bg-status-red-bg/20 transition-all group"
            >
              <div className="p-3 bg-status-red-bg text-status-red-text rounded-xl group-hover:scale-110 transition-transform"><Trash2 size={28} /></div>
              <div className="text-left">
                <span className="block font-bold text-sm text-status-red-text">Limpar Sistema</span>
                <span className="block text-[10px] text-clinic-text-muted">Excluir permanentemente todos os dados</span>
              </div>
            </button>
          </div>
      </div>

      <Modal
        isOpen={isClearDataOpen}
        onClose={() => setIsClearDataOpen(false)}
        title="LIMPEZA PERMANENTE"
        width="max-w-md"
      >
        <div className="space-y-6">
          <p className="text-status-red-text font-bold">
            ATENÇÃO: Isso excluirá TODOS os atendentes, sessões e pagamentos permanentemente.
            Você tem certeza?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setIsClearDataOpen(false)}
              className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                clearState();
                setIsClearDataOpen(false);
              }}
              className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all uppercase tracking-wide text-xs"
            >
              Sim, LIMPAR TUDO!
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
