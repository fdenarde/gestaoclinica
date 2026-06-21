export const WHATSAPP_OPERATIONAL_REPORT_COLLECTION = 'whatsappOperationalReports';
export const WHATSAPP_OPERATIONAL_REPORT_TIME_ZONE = 'America/Sao_Paulo';
export const WHATSAPP_OPERATIONAL_REPORT_SCHEMA_VERSION = 1;

const ROUTINE_ORDER = ['HOJE_MANHA', 'HOJE_TARDE', 'AMANHA'];

export function getSaoPauloReportDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WHATSAPP_OPERATIONAL_REPORT_TIME_ZONE,
  }).format(now);
}

export function maskAdministrativeRecipient(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '*');
  return `*******${last4}`;
}

export function stableOperationalMessageHash(value = '') {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeDeliveryStatus(execution, deliveryStatus) {
  if (deliveryStatus !== 'sent') return 'failed';
  if (execution.noReport) return 'no-report';
  if (execution.counts.failures > 0 || execution.counts.pending > 0 || execution.counts.incomplete > 0) {
    return 'partial';
  }
  return 'sent';
}

function buildRunSummary(execution) {
  const { counts } = execution;
  return `${execution.routineLabel}: ${counts.planned} planejada(s), ${counts.confirmed} confirmada(s), ${counts.blocked} bloqueio(s) e ${counts.failures} falha(s).`;
}

function buildRunAlerts(execution, deliveryStatus) {
  const alerts = [];
  if (deliveryStatus !== 'sent') alerts.push('Falha no envio do relatório administrativo.');
  if (execution.counts.failures > 0) alerts.push(`${execution.counts.failures} lembrete(s) falharam.`);
  if (execution.counts.pending > 0) alerts.push(`${execution.counts.pending} confirmação(ões) permaneceram pendentes.`);
  if (execution.counts.incomplete > 0) alerts.push(`${execution.counts.incomplete} cadastro(s) precisam de conferência.`);
  return alerts;
}

export function sanitizeExecutionForDailyReport({
  execution,
  deliveryStatus,
  recipient,
  message,
  updatedAt = new Date(),
}) {
  const status = normalizeDeliveryStatus(execution, deliveryStatus);
  const reportDate = getSaoPauloReportDate(new Date(execution.finishedAt || updatedAt));

  return {
    schemaVersion: WHATSAPP_OPERATIONAL_REPORT_SCHEMA_VERSION,
    routine: execution.routine,
    routineLabel: execution.routineLabel,
    reportDate,
    timezone: WHATSAPP_OPERATIONAL_REPORT_TIME_ZONE,
    generatedAt: execution.startedAt,
    completedAt: execution.finishedAt,
    status,
    recipientMasked: maskAdministrativeRecipient(recipient),
    counts: {
      planned: Number(execution.counts.planned || 0),
      confirmed: Number(execution.counts.confirmed || 0),
      ruleSkipped: Number(execution.counts.ruleSkipped || 0),
      incomplete: Number(execution.counts.incomplete || 0),
      pending: Number(execution.counts.pending || 0),
      failures: Number(execution.counts.failures || 0),
      blocked: Number(execution.counts.blocked || 0),
    },
    summary: [buildRunSummary(execution)],
    alerts: buildRunAlerts(execution, deliveryStatus),
    source: 'whatsapp-sender',
    messageHash: stableOperationalMessageHash(message),
    updatedAt: updatedAt.toISOString(),
  };
}

function emptyAggregateCounts() {
  return {
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
}

function aggregateRoutines(routines) {
  const counts = emptyAggregateCounts();
  const values = ROUTINE_ORDER.map(key => routines[key]).filter(Boolean);

  for (const run of values) {
    counts.planned += run.counts.planned;
    counts.confirmed += run.counts.confirmed;
    counts.ruleSkipped += run.counts.ruleSkipped;
    counts.incomplete += run.counts.incomplete;
    counts.pending += run.counts.pending;
    counts.failures += run.counts.failures;
    counts.blocked += run.counts.blocked;
    if (run.routine === 'HOJE_MANHA') counts.morning = run.counts.planned;
    if (run.routine === 'HOJE_TARDE') counts.afternoon = run.counts.planned;
    if (run.routine === 'AMANHA') counts.tomorrow = run.counts.planned;
  }
  counts.today = counts.morning + counts.afternoon;
  return counts;
}

function combineDailyStatus(routines, latestStatus) {
  const statuses = Object.values(routines).map(run => run.status);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('partial')) return 'partial';
  if (statuses.length > 0 && statuses.every(status => status === 'no-report')) return 'no-report';
  return latestStatus || 'no-report';
}

export function buildDailyWhatsappOperationalReport(existing, sanitizedRun) {
  const routines = {
    ...(existing?.reportDate === sanitizedRun.reportDate ? existing.routines : {}),
    [sanitizedRun.routine]: sanitizedRun,
  };
  const counts = aggregateRoutines(routines);
  const orderedRuns = ROUTINE_ORDER.map(key => routines[key]).filter(Boolean);

  return {
    schemaVersion: WHATSAPP_OPERATIONAL_REPORT_SCHEMA_VERSION,
    reportDate: sanitizedRun.reportDate,
    timezone: WHATSAPP_OPERATIONAL_REPORT_TIME_ZONE,
    generatedAt: orderedRuns[0]?.generatedAt || sanitizedRun.generatedAt,
    completedAt: sanitizedRun.completedAt,
    status: combineDailyStatus(routines, sanitizedRun.status),
    recipientMasked: sanitizedRun.recipientMasked,
    counts,
    summary: orderedRuns.flatMap(run => run.summary),
    alerts: [...new Set(orderedRuns.flatMap(run => run.alerts))],
    source: 'whatsapp-sender',
    messageHash: sanitizedRun.messageHash,
    latestRoutine: sanitizedRun.routine,
    routines,
    updatedAt: sanitizedRun.updatedAt,
  };
}

export async function saveDailyWhatsappOperationalReport({
  db,
  execution,
  deliveryStatus,
  recipient,
  message,
  updatedAt = new Date(),
}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('Firestore Admin inválido para persistir relatório operacional.');
  }
  const sanitizedRun = sanitizeExecutionForDailyReport({
    execution,
    deliveryStatus,
    recipient,
    message,
    updatedAt,
  });
  const ref = db.collection(WHATSAPP_OPERATIONAL_REPORT_COLLECTION).doc(sanitizedRun.reportDate);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : null;
    const document = buildDailyWhatsappOperationalReport(existing, sanitizedRun);
    transaction.set(ref, document, { merge: false });
    return { path: `${WHATSAPP_OPERATIONAL_REPORT_COLLECTION}/${sanitizedRun.reportDate}`, document };
  });
}
