export const WHATSAPP_ADMIN_REPORT_RECIPIENT = '27999072659';
export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
export const WHATSAPP_OPERATIONAL_REPORT_COLLECTION = 'whatsappOperationalReports';

export type WhatsappOperationalReportStatus = 'sent' | 'failed' | 'partial' | 'no-report';

export interface WhatsappOperationalRoutineReport {
  schemaVersion: number;
  routine: string;
  routineLabel: string;
  reportDate: string;
  timezone: string;
  generatedAt: string;
  completedAt: string;
  status: WhatsappOperationalReportStatus;
  recipientMasked: string;
  counts: {
    planned: number;
    confirmed: number;
    ruleSkipped: number;
    incomplete: number;
    pending: number;
    failures: number;
    blocked: number;
    agendaChanges: number;
  };
  summary: string[];
  alerts: string[];
  source: 'whatsapp-sender';
  messageHash: string;
  updatedAt: string;
}

export interface WhatsappOperationalReport {
  schemaVersion: number;
  reportDate: string;
  timezone: string;
  generatedAt: string;
  completedAt: string;
  status: WhatsappOperationalReportStatus;
  recipientMasked: string;
  counts: {
    today: number;
    morning: number;
    afternoon: number;
    tomorrow: number;
    blocked: number;
    planned: number;
    confirmed: number;
    ruleSkipped: number;
    incomplete: number;
    pending: number;
    failures: number;
    agendaChanges: number;
  };
  summary: string[];
  alerts: string[];
  source: 'whatsapp-sender';
  messageHash: string;
  latestRoutine: string;
  routines: Record<string, WhatsappOperationalRoutineReport>;
  updatedAt: string;
}

export interface WhatsappOperationalReportState {
  report: WhatsappOperationalReport | null;
  loading: boolean;
  error: string | null;
  dateKey: string;
}

export function getSaoPauloDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SAO_PAULO_TIME_ZONE }).format(now);
}

export function formatSaoPauloTime(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: SAO_PAULO_TIME_ZONE,
  }).format(date);
}

export function maskWhatsappAdminRecipient(phone = WHATSAPP_ADMIN_REPORT_RECIPIENT): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return `*******${digits.slice(-4).padStart(4, '*')}`;
}

export function getMsUntilNextSaoPauloMidnight(now = new Date()): number {
  const currentDay = getSaoPauloDateKey(now);
  let upper = new Date(now.getTime() + 60_000);
  for (let step = 0; step < 60 && getSaoPauloDateKey(upper) === currentDay; step += 1) {
    upper = new Date(upper.getTime() + 30 * 60_000);
  }
  let lowerMs = now.getTime();
  let upperMs = upper.getTime();
  for (let step = 0; step < 32; step += 1) {
    const midMs = Math.floor((lowerMs + upperMs) / 2);
    if (getSaoPauloDateKey(new Date(midMs)) === currentDay) lowerMs = midMs + 1;
    else upperMs = midMs;
  }
  return Math.max(1_000, upperMs - now.getTime());
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 50)
    : [];
}

export function normalizeWhatsappOperationalReport(
  value: unknown,
  expectedDate = getSaoPauloDateKey(),
): WhatsappOperationalReport | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (source.reportDate !== expectedDate || source.timezone !== SAO_PAULO_TIME_ZONE) return null;
  const status = source.status;
  if (!['sent', 'failed', 'partial', 'no-report'].includes(String(status))) return null;
  const countsSource = (source.counts && typeof source.counts === 'object')
    ? source.counts as Record<string, unknown>
    : {};
  const routinesSource = (source.routines && typeof source.routines === 'object')
    ? source.routines as Record<string, WhatsappOperationalRoutineReport>
    : {};

  return {
    schemaVersion: numberValue(source.schemaVersion) || 1,
    reportDate: String(source.reportDate),
    timezone: SAO_PAULO_TIME_ZONE,
    generatedAt: String(source.generatedAt || ''),
    completedAt: String(source.completedAt || ''),
    status: status as WhatsappOperationalReportStatus,
    recipientMasked: String(source.recipientMasked || maskWhatsappAdminRecipient()),
    counts: {
      today: numberValue(countsSource.today),
      morning: numberValue(countsSource.morning),
      afternoon: numberValue(countsSource.afternoon),
      tomorrow: numberValue(countsSource.tomorrow),
      blocked: numberValue(countsSource.blocked),
      planned: numberValue(countsSource.planned),
      confirmed: numberValue(countsSource.confirmed),
      ruleSkipped: numberValue(countsSource.ruleSkipped),
      incomplete: numberValue(countsSource.incomplete),
      pending: numberValue(countsSource.pending),
      failures: numberValue(countsSource.failures),
      agendaChanges: numberValue(countsSource.agendaChanges),
    },
    summary: stringList(source.summary),
    alerts: stringList(source.alerts),
    source: 'whatsapp-sender',
    messageHash: String(source.messageHash || ''),
    latestRoutine: String(source.latestRoutine || ''),
    routines: routinesSource,
    updatedAt: String(source.updatedAt || ''),
  };
}

export function getWhatsappReportStatusLabel(report: WhatsappOperationalReport | null): string {
  if (!report) return 'Nenhum relatório disponível hoje.';
  const time = formatSaoPauloTime(report.completedAt || report.updatedAt);
  if (report.status === 'sent') return `Relatório enviado hoje às ${time}.`;
  if (report.status === 'failed') return `Falha no envio do relatório às ${time}.`;
  if (report.status === 'partial') return `Relatório parcialmente concluído às ${time}.`;
  return `Nenhuma atividade operacional registrada hoje até ${time}.`;
}

export function buildSafePreviewWhatsappReport(
  status: WhatsappOperationalReportStatus = 'sent',
  now = new Date(),
): WhatsappOperationalReport {
  const reportDate = getSaoPauloDateKey(now);
  const iso = now.toISOString();
  return {
    schemaVersion: 1,
    reportDate,
    timezone: SAO_PAULO_TIME_ZONE,
    generatedAt: iso,
    completedAt: iso,
    status,
    recipientMasked: maskWhatsappAdminRecipient(),
    counts: {
      today: 5,
      morning: 3,
      afternoon: 2,
      tomorrow: 4,
      blocked: 1,
      planned: 9,
      confirmed: status === 'failed' ? 0 : 8,
      ruleSkipped: 1,
      incomplete: 0,
      pending: 0,
      failures: status === 'failed' ? 1 : 0,
      agendaChanges: status === 'partial' ? 1 : 0,
    },
    summary: [
      'Atendimentos da manhã: 3 planejadas, 3 enviadas e nenhum bloqueio.',
      'Atendimentos da tarde: 2 planejadas, 2 enviadas e 1 bloqueio.',
      'Véspera: 4 planejadas, 3 enviadas e nenhuma falha.',
    ],
    alerts: status === 'failed'
      ? ['Falha no envio do relatório administrativo.']
      : status === 'partial'
        ? ['Existe uma pendência operacional que requer conferência.']
        : [],
    source: 'whatsapp-sender',
    messageHash: 'preview-ficticio',
    latestRoutine: 'AMANHA',
    routines: {},
    updatedAt: iso,
  };
}
