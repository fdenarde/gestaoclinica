import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildExecutionReportData,
  createExecutionAudit,
  finishExecutionAudit,
  formatExecutionReportMessage,
  registerPlanDiagnostics,
  registerSendFailure,
  registerSuccessfulSend,
} from '../src/lib/whatsappAdminMonitor.js';
import {
  buildDailyWhatsappOperationalReport,
  getSaoPauloReportDate,
  maskAdministrativeRecipient,
  sanitizeExecutionForDailyReport,
  saveDailyWhatsappOperationalReport,
  stableOperationalMessageHash,
} from '../src/lib/whatsappOperationalReportRepository.js';

function reminder(id, patientName, phone = '27999995476') {
  return {
    id,
    patientName,
    responsibleName: 'Responsável Sigiloso',
    responsibleRelationship: 'Mãe',
    whatsapp: phone,
    time: '10:00',
  };
}

function buildAudit({ tipo = 'HOJE_MANHA', failures = false, incomplete = false } = {}) {
  const startedAt = new Date('2026-06-20T12:00:00.000Z');
  const first = reminder('r-1', 'Paciente Confidencial');
  const second = reminder('r-2', 'Outro Paciente', '27988884321');
  const diagnostics = incomplete
    ? [{ ...second, blockedReason: 'responsável sem WhatsApp válido' }]
    : [];
  const planContexts = [{ plan: { reminders: [first, second], diagnostics } }];
  const audit = createExecutionAudit({ tipo, startedAt, planContexts });
  registerPlanDiagnostics(audit, planContexts[0].plan);
  registerSuccessfulSend(audit, first, { confirmedAt: '2026-06-20T12:00:10.000Z' });
  if (failures) registerSendFailure(audit, second, new Error('WhatsApp desconectado para Paciente Confidencial'));
  finishExecutionAudit(audit, new Date('2026-06-20T12:00:20.000Z'));
  return audit;
}

function createFakeDb() {
  const documents = new Map();
  const writes = [];
  const reads = [];
  const db = {
    documents,
    writes,
    reads,
    collection(collectionName) {
      return {
        doc(documentId) {
          return { key: `${collectionName}/${documentId}`, collectionName, documentId };
        },
      };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          reads.push(ref.key);
          return {
            exists: documents.has(ref.key),
            data: () => documents.get(ref.key),
          };
        },
        set(ref, value, options) {
          writes.push({ key: ref.key, value, options });
          documents.set(ref.key, structuredClone(value));
        },
      };
      return callback(transaction);
    },
  };
  return db;
}

test('mensagem real e documento sanitizado derivam do mesmo objeto normalizado', () => {
  const execution = buildExecutionReportData(buildAudit({ incomplete: true }));
  const message = formatExecutionReportMessage(execution);
  const sanitized = sanitizeExecutionForDailyReport({
    execution,
    deliveryStatus: 'sent',
    recipient: '27999072659',
    message,
    updatedAt: new Date('2026-06-20T12:00:21.000Z'),
  });

  assert.match(message, /Paciente/);
  assert.equal(sanitized.counts.planned, execution.counts.planned);
  assert.equal(sanitized.counts.confirmed, execution.counts.confirmed);
  assert.equal(sanitized.counts.incomplete, execution.counts.incomplete);
  assert.equal(sanitized.messageHash, stableOperationalMessageHash(message));
  assert.equal(sanitized.recipientMasked, '*******2659');
  assert.equal(sanitized.reportDate, '2026-06-20');
});

test('sanitização não persiste nomes, telefones, conteúdo clínico, links ou mensagem completa', () => {
  const execution = buildExecutionReportData(buildAudit({ failures: true }));
  const message = formatExecutionReportMessage(execution);
  const sanitized = sanitizeExecutionForDailyReport({
    execution,
    deliveryStatus: 'failed',
    recipient: '5527999072659',
    message,
    updatedAt: new Date('2026-06-20T12:00:21.000Z'),
  });
  const encoded = JSON.stringify(sanitized);

  assert.doesNotMatch(encoded, /Paciente Confidencial|Outro Paciente|Responsável Sigiloso/);
  assert.doesNotMatch(encoded, /27999995476|27988884321|5527999072659/);
  assert.doesNotMatch(encoded, /photos\.app\.goo\.gl|observa[cç][aã]o cl[ií]nica/i);
  assert.doesNotMatch(encoded, /RESULTADO DOS ENVIOS|ENVIOS CONFIRMADOS/);
  assert.equal(sanitized.status, 'failed');
});

test('documento diário agrega rotinas sem duplicar o mesmo dia ou a mesma rotina', () => {
  const morningExecution = buildExecutionReportData(buildAudit({ tipo: 'HOJE_MANHA' }));
  const afternoonExecution = buildExecutionReportData(buildAudit({ tipo: 'HOJE_TARDE' }));
  const morning = sanitizeExecutionForDailyReport({ execution: morningExecution, deliveryStatus: 'sent', recipient: '27999072659', message: 'morning' });
  const afternoon = sanitizeExecutionForDailyReport({ execution: afternoonExecution, deliveryStatus: 'sent', recipient: '27999072659', message: 'afternoon' });

  const first = buildDailyWhatsappOperationalReport(null, morning);
  const repeated = buildDailyWhatsappOperationalReport(first, morning);
  const combined = buildDailyWhatsappOperationalReport(repeated, afternoon);

  assert.equal(Object.keys(repeated.routines).length, 1);
  assert.equal(repeated.counts.today, morning.counts.planned);
  assert.equal(Object.keys(combined.routines).length, 2);
  assert.equal(combined.counts.morning, morning.counts.planned);
  assert.equal(combined.counts.afternoon, afternoon.counts.planned);
  assert.equal(combined.counts.today, morning.counts.planned + afternoon.counts.planned);
});

test('repositório usa um caminho determinístico e sobrescreve o documento do dia', async () => {
  const db = createFakeDb();
  const execution = buildExecutionReportData(buildAudit());
  const first = await saveDailyWhatsappOperationalReport({
    db,
    execution,
    deliveryStatus: 'sent',
    recipient: '27999072659',
    message: 'mensagem 1',
    updatedAt: new Date('2026-06-20T12:01:00.000Z'),
  });
  const second = await saveDailyWhatsappOperationalReport({
    db,
    execution,
    deliveryStatus: 'sent',
    recipient: '27999072659',
    message: 'mensagem 2',
    updatedAt: new Date('2026-06-20T12:02:00.000Z'),
  });

  assert.equal(first.path, 'whatsappOperationalReports/2026-06-20');
  assert.equal(second.path, first.path);
  assert.equal(db.documents.size, 1);
  assert.equal(db.reads.length, 2);
  assert.equal(db.writes.length, 2);
  assert.equal(db.writes.every(write => write.options.merge === false), true);
});

test('fuso, máscara e hash são estáveis', () => {
  assert.equal(getSaoPauloReportDate(new Date('2026-06-21T01:30:00.000Z')), '2026-06-20');
  assert.equal(maskAdministrativeRecipient('55 27 99907-2659'), '*******2659');
  assert.equal(stableOperationalMessageHash('conteúdo'), stableOperationalMessageHash('conteúdo'));
  assert.notEqual(stableOperationalMessageHash('conteúdo'), stableOperationalMessageHash('outro'));
});

test('integração mantém envio antes da persistência e não chama o sender a partir do frontend', () => {
  const serverSource = fs.readFileSync('server.js', 'utf8');
  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  const dashboardSource = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
  const reportsSource = fs.readFileSync('src/components/Reports.tsx', 'utf8');

  assert.ok(serverSource.indexOf('await sendAdminReport(') < serverSource.indexOf('await saveDailyWhatsappOperationalReport({'));
  assert.match(serverSource, /admin-execution-report-persistence-error/);
  assert.doesNotMatch(appSource + dashboardSource + reportsSource, /client\.sendMessage|whatsapp-web\.js|LocalAuth|Client\(/);
});

test('frontend abre um único listener apenas para admin e compartilha o estado', () => {
  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  const hookSource = fs.readFileSync('src/lib/useDailyWhatsappOperationalReport.ts', 'utf8');
  const dashboardSource = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
  const reportsSource = fs.readFileSync('src/components/Reports.tsx', 'utf8');

  assert.match(appSource, /useDailyWhatsappOperationalReport\([\s\S]*accessProfile\.role === 'admin'/);
  assert.match(appSource, /whatsappReportState=\{whatsappOperationalReportState\}/g);
  assert.equal((hookSource.match(/onSnapshot\(/g) || []).length, 1);
  assert.match(hookSource, /if \(!enabled\)/);
  assert.match(hookSource, /return onSnapshot\(/);
  assert.match(dashboardSource, /WhatsappOperationalReportPanel/);
  assert.match(reportsSource, /WhatsappOperationalReportPanel/);
  assert.doesNotMatch(dashboardSource + reportsSource, /onSnapshot\(|collection\(|doc\(db/);
});


test('regra local permite somente get de admin aprovado e bloqueia escrita frontend', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /function isApprovedAdmin\(\)/);
  assert.match(rules, /match \/whatsappOperationalReports\/\{reportDate\}/);
  assert.match(rules, /allow get: if isApprovedAdmin\(\)/);
  assert.match(rules, /allow list, create, update, delete: if false/);
});
