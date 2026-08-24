import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import type { PsychologyStore } from './psychologyDomain';
import {
  formatPsychologyReportDate,
  formatPsychologyReportDateTime,
  formatPsychologyReportMoney,
  psychologyReportChargeStatusLabels,
  psychologyReportPaymentMethodLabels,
  type PsychologyAgendaReport,
  type PsychologyFinanceReport,
  type PsychologyPatientsReport,
  type PsychologyReport,
  type PsychologyReportKind,
  type PsychologySessionReportRow,
  type PsychologySessionsReport,
} from './psychologyReports';
import { isPsychologyPaymentActive } from './psychologyFinancialLedger';
import { formatPhoneDisplay } from '../../../shared/phoneNormalization.js';

export type PsychologyFinanceExportView = 'summary' | 'charges' | 'payments' | 'expenses';

function reportPhoneLabel(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  try {
    return formatPhoneDisplay(raw);
  } catch {
    return raw;
  }
}

export interface PsychologyReportExportMeta {
  professionalName: string;
  specialty: string;
  professionalId: string;
  crp?: string;
  clinicName?: string;
  periodLabel: string;
  periodEndDate?: string;
  filtersLabel: string;
  generatedAt?: string;
}

export interface PsychologyReportExportPayload {
  kind: PsychologyReportKind;
  report: PsychologyReport;
  store: PsychologyStore;
  meta: PsychologyReportExportMeta;
  financeView?: PsychologyFinanceExportView;
}

const reportTitles: Record<PsychologyReportKind, string> = {
  sessions: 'Atendimentos e status',
  finance: 'Financeiro',
  agenda: 'Agenda e ocupação',
  patients: 'Pacientes e status',
};

function safeFilePart(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'RELATORIO';
}

export function psychologyReportFileName(kind: PsychologyReportKind, periodEndDate: string, extension: 'pdf' | 'csv'): string {
  const suffix = periodEndDate.slice(0, 7) || 'PERIODO';
  return `RELATORIO-PSICOLOGIA-${safeFilePart(reportTitles[kind])}-${suffix}.${extension}`;
}

function generatedLabel(meta: PsychologyReportExportMeta): string {
  return meta.generatedAt || new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
}

function patientName(store: PsychologyStore, patientId: string | null): string {
  return patientId ? store.patients.find(patient => patient.id === patientId)?.name || 'Paciente não encontrado' : 'Paciente excluído';
}

function methodLabel(method: string): string {
  return psychologyReportPaymentMethodLabels[method as keyof typeof psychologyReportPaymentMethodLabels] || method;
}

function addPdfHeader(doc: jsPDF, payload: PsychologyReportExportPayload): number {
  const { meta, kind } = payload;
  const reportTitle = `Relatório — ${reportTitles[kind]}`;
  doc.setProperties({ title: reportTitle, subject: 'Relatório administrativo da Psicologia', author: meta.professionalName || 'Psicologia' });
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Gestão Clínica · Psicologia', 14, 17);
  doc.setFontSize(12);
  doc.text(reportTitle, 14, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const identityLines = [meta.professionalName, meta.specialty, meta.crp ? `CRP: ${meta.crp}` : '', meta.clinicName || ''].filter(Boolean);
  const identityTextLines = (identityLines.length ? identityLines : ['Profissional da Psicologia']).flatMap(line => doc.splitTextToSize(line, 180));
  doc.text(identityTextLines, 14, 32);
  doc.setTextColor(71, 85, 105);
  const identityEndY = 32 + (identityTextLines.length - 1) * 5;
  const periodY = identityEndY + 8;
  doc.text(`Período: ${meta.periodLabel}`, 14, periodY);
  doc.text(`Filtros: ${meta.filtersLabel || 'Todos'}`, 14, periodY + 6);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, periodY + 11, 196, periodY + 11);
  return periodY + 19;
}

function addPdfFooter(doc: jsPDF, meta: PsychologyReportExportMeta): void {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.line(14, height - 15, 196, height - 15);
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Gerado em ${generatedLabel(meta)} · Documento administrativo local`, 14, height - 9);
    doc.text(`Página ${page} de ${pageCount}`, 196, height - 9, { align: 'right' });
  }
}

function addSummary(doc: jsPDF, startY: number, entries: Array<[string, string]>): number {
  const lines = entries.map(([label, value]) => `${label}: ${value}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(doc.splitTextToSize(lines.join('   ·   '), 180), 14, startY);
  return startY + (lines.length > 3 ? 14 : 8);
}

function table(doc: jsPDF, startY: number, head: string[], body: string[][]): void {
  autoTable(doc, {
    startY,
    head: [head],
    body: body.length ? body : [['Sem registros no período']],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, textColor: [51, 65, 85], overflow: 'linebreak' },
    headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 22 },
  });
}

function sessionBody(rows: PsychologySessionReportRow[]): string[][] {
  return rows.map(row => [
    formatPsychologyReportDate(row.session.date),
    row.session.time,
    row.patientName,
    row.modalityLabel,
    row.locationLabel,
    row.serviceLabel,
    `${row.session.durationMinutes} min`,
    row.statusLabel,
  ]);
}

function buildSessionsPdf(doc: jsPDF, startY: number, report: PsychologySessionsReport): void {
  const summaryY = addSummary(doc, startY, [
    ['Total', String(report.total)],
    ['Realizadas', String(report.realized)],
    ['Agendadas', String(report.scheduled)],
    ['Faltas', String(report.absences)],
    ['Canceladas', String(report.cancelled)],
    ['Taxa de comparecimento', report.attendanceRate === null ? '—' : `${report.attendanceRate.toFixed(1).replace('.', ',')}%`],
  ]);
  table(doc, summaryY + 4, ['Data', 'Horário', 'Paciente', 'Modalidade', 'Local', 'Serviço', 'Duração', 'Status'], sessionBody(report.rows));
}

function buildFinancePdf(doc: jsPDF, startY: number, report: PsychologyFinanceReport, store: PsychologyStore, view: PsychologyFinanceExportView): void {
  const summaryY = addSummary(doc, startY, [
    ['Recebido', formatPsychologyReportMoney(report.overview.received)],
    ['A receber', formatPsychologyReportMoney(report.overview.receivable)],
    ['Vencido', formatPsychologyReportMoney(report.overview.overdue)],
    ['Despesas realizadas', formatPsychologyReportMoney(report.overview.expenses)],
    ['Saldo realizado', formatPsychologyReportMoney(report.overview.balance)],
  ]);
  if (view === 'summary') {
    table(doc, summaryY + 4, ['Meio de pagamento', 'Recebido no período'], report.receivedByMethod.map(item => [item.label, formatPsychologyReportMoney(item.amount)]));
  } else if (view === 'charges') {
    table(doc, summaryY + 4, ['Paciente', 'Descrição', 'Valor', 'Recebido', 'Saldo', 'Vencimento', 'Status'], report.chargeRows.map(entry => [patientName(store, entry.charge.patientId), entry.charge.description, formatPsychologyReportMoney(entry.charge.amount), formatPsychologyReportMoney(entry.received), formatPsychologyReportMoney(entry.balance), formatPsychologyReportDate(entry.charge.dueDate), psychologyReportChargeStatusLabels[entry.status]]));
  } else if (view === 'payments') {
    table(doc, summaryY + 4, ['Data', 'Paciente', 'Cobrança', 'Valor', 'Meio', 'Status'], report.paymentRows.map(payment => [formatPsychologyReportDate(payment.date), patientName(store, payment.patientId), report.chargeRows.find(entry => entry.charge.id === payment.chargeId)?.charge.description || 'Cobrança vinculada', formatPsychologyReportMoney(payment.amount), methodLabel(payment.method), isPsychologyPaymentActive(payment) ? 'Ativo' : 'Estornado']));
  } else {
    table(doc, summaryY + 4, ['Data', 'Descrição', 'Categoria', 'Valor', 'Status'], report.expenseRows.map(expense => [formatPsychologyReportDate(expense.date), expense.description, expense.category, formatPsychologyReportMoney(expense.amount), expense.status === 'REALIZED' ? 'Realizada' : expense.status === 'PENDING' ? 'Pendente' : 'Estornada']));
  }
}

function buildAgendaPdf(doc: jsPDF, startY: number, report: PsychologyAgendaReport): void {
  const occupancy = report.occupancyRate === null ? 'Não disponível com a configuração atual' : `${report.occupancyRate.toFixed(1).replace('.', ',')}%`;
  const summaryY = addSummary(doc, startY, [
    ['Sessões agendadas', String(report.scheduledSessions)],
    ['Horas agendadas', `${(report.scheduledMinutes / 60).toFixed(2).replace('.', ',')} h`],
    ['Horas realizadas', `${(report.realizedMinutes / 60).toFixed(2).replace('.', ',')} h`],
    ['Horas disponíveis', report.availableMinutes === null ? '—' : `${(report.availableMinutes / 60).toFixed(2).replace('.', ',')} h`],
    ['Taxa de ocupação', occupancy],
  ]);
  const distributionRows = [
    ...report.byDay.map(item => ['Dia', item.label, String(item.count), `${(item.minutes / 60).toFixed(2).replace('.', ',')} h`]),
    ...report.byModality.map(item => ['Modalidade', item.label, String(item.count), `${(item.minutes / 60).toFixed(2).replace('.', ',')} h`]),
    ...report.byLocation.map(item => ['Local', item.label, String(item.count), `${(item.minutes / 60).toFixed(2).replace('.', ',')} h`]),
  ];
  table(doc, summaryY + 4, ['Dimensão', 'Item', 'Sessões', 'Duração'], distributionRows);
}

function buildPatientsPdf(doc: jsPDF, startY: number, report: PsychologyPatientsReport): void {
  const summaryY = addSummary(doc, startY, [
    ['Ativos', String(report.active)],
    ['Inativos', String(report.inactive)],
    ['Com próxima sessão', String(report.withNext)],
    ['Sem próxima sessão', String(report.withoutNext)],
    ['Com pacote ativo', String(report.withPackage)],
  ]);
  table(doc, summaryY + 4, ['Paciente', 'Telefone', 'E-mail', 'Status', 'Última sessão', 'Próxima sessão', 'Modalidade', 'Pacote ativo'], report.rows.map(row => [row.patient.name, reportPhoneLabel(row.patient.phone), row.patient.email || '—', row.patient.active ? 'Ativo' : 'Inativo', formatPsychologyReportDate(row.lastSessionDate), formatPsychologyReportDateTime(row.nextSession?.date, row.nextSession?.time), row.preferredModalityLabel, row.activePackageName || '—']));
}

export function buildPsychologyReportPdf(payload: PsychologyReportExportPayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = addPdfHeader(doc, payload);
  if (payload.kind === 'sessions') buildSessionsPdf(doc, startY, payload.report as PsychologySessionsReport);
  else if (payload.kind === 'finance') buildFinancePdf(doc, startY, payload.report as PsychologyFinanceReport, payload.store, payload.financeView || 'summary');
  else if (payload.kind === 'agenda') buildAgendaPdf(doc, startY, payload.report as PsychologyAgendaReport);
  else buildPatientsPdf(doc, startY, payload.report as PsychologyPatientsReport);
  addPdfFooter(doc, payload.meta);
  return doc;
}

function csvContent(fields: string[], data: Array<Record<string, string>>): string {
  return `\ufeff${Papa.unparse({ fields, data }, { delimiter: ';', newline: '\r\n' })}`;
}

export function buildPsychologyReportCsv(payload: PsychologyReportExportPayload): string {
  if (payload.kind === 'sessions') {
    const report = payload.report as PsychologySessionsReport;
    const fields = ['Data', 'Horário', 'Paciente', 'Modalidade', 'Local', 'Serviço', 'Duração', 'Status'];
    return csvContent(fields, report.rows.map(row => ({ Data: formatPsychologyReportDate(row.session.date), Horário: row.session.time, Paciente: row.patientName, Modalidade: row.modalityLabel, Local: row.locationLabel, Serviço: row.serviceLabel, Duração: `${row.session.durationMinutes} min`, Status: row.statusLabel })));
  }
  if (payload.kind === 'finance') {
    const report = payload.report as PsychologyFinanceReport;
    const view = payload.financeView || 'summary';
    if (view === 'summary') return csvContent(['Meio de pagamento', 'Recebido no período'], report.receivedByMethod.map(item => ({ 'Meio de pagamento': item.label, 'Recebido no período': formatPsychologyReportMoney(item.amount) })));
    if (view === 'charges') return csvContent(['Paciente', 'Descrição', 'Valor', 'Recebido', 'Saldo', 'Vencimento', 'Status'], report.chargeRows.map(entry => ({ Paciente: patientName(payload.store, entry.charge.patientId), Descrição: entry.charge.description, Valor: formatPsychologyReportMoney(entry.charge.amount), Recebido: formatPsychologyReportMoney(entry.received), Saldo: formatPsychologyReportMoney(entry.balance), Vencimento: formatPsychologyReportDate(entry.charge.dueDate), Status: psychologyReportChargeStatusLabels[entry.status] })));
    if (view === 'payments') return csvContent(['Data', 'Paciente', 'Cobrança', 'Valor', 'Meio', 'Status'], report.paymentRows.map(payment => ({ Data: formatPsychologyReportDate(payment.date), Paciente: patientName(payload.store, payment.patientId), Cobrança: report.chargeRows.find(entry => entry.charge.id === payment.chargeId)?.charge.description || 'Cobrança vinculada', Valor: formatPsychologyReportMoney(payment.amount), Meio: methodLabel(payment.method), Status: isPsychologyPaymentActive(payment) ? 'Ativo' : 'Estornado' })));
    return csvContent(['Data', 'Descrição', 'Categoria', 'Valor', 'Status'], report.expenseRows.map(expense => ({ Data: formatPsychologyReportDate(expense.date), Descrição: expense.description, Categoria: expense.category, Valor: formatPsychologyReportMoney(expense.amount), Status: expense.status === 'REALIZED' ? 'Realizada' : expense.status === 'PENDING' ? 'Pendente' : 'Estornada' })));
  }
  if (payload.kind === 'agenda') {
    const report = payload.report as PsychologyAgendaReport;
    const fields = ['Dimensão', 'Item', 'Sessões', 'Duração'];
    const data = [...report.byDay.map(item => ({ Dimensão: 'Dia', Item: item.label, Sessões: String(item.count), Duração: `${(item.minutes / 60).toFixed(2).replace('.', ',')} h` })), ...report.byModality.map(item => ({ Dimensão: 'Modalidade', Item: item.label, Sessões: String(item.count), Duração: `${(item.minutes / 60).toFixed(2).replace('.', ',')} h` })), ...report.byLocation.map(item => ({ Dimensão: 'Local', Item: item.label, Sessões: String(item.count), Duração: `${(item.minutes / 60).toFixed(2).replace('.', ',')} h` }))];
    return csvContent(fields, data);
  }
  const report = payload.report as PsychologyPatientsReport;
  const fields = ['Paciente', 'Telefone', 'E-mail', 'Status', 'Última sessão', 'Próxima sessão', 'Modalidade', 'Pacote ativo'];
  return csvContent(fields, report.rows.map(row => ({ Paciente: row.patient.name, Telefone: reportPhoneLabel(row.patient.phone), 'E-mail': row.patient.email || '—', Status: row.patient.active ? 'Ativo' : 'Inativo', 'Última sessão': formatPsychologyReportDate(row.lastSessionDate), 'Próxima sessão': formatPsychologyReportDateTime(row.nextSession?.date, row.nextSession?.time), Modalidade: row.preferredModalityLabel, 'Pacote ativo': row.activePackageName || '—' })));
}

function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPsychologyReportCsv(payload: PsychologyReportExportPayload): string {
  const filename = psychologyReportFileName(payload.kind, payload.meta.periodEndDate || payload.meta.periodLabel, 'csv');
  downloadText(buildPsychologyReportCsv(payload), filename, 'text/csv');
  return filename;
}

export function downloadPsychologyReportPdf(payload: PsychologyReportExportPayload): string {
  const filename = psychologyReportFileName(payload.kind, payload.meta.periodEndDate || payload.meta.periodLabel, 'pdf');
  buildPsychologyReportPdf(payload).save(filename);
  return filename;
}
