import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WHATSAPP_OPERATION_MODES,
  JsonReminderLedger,
  ROUTINE_DELIVERY_OUTCOMES,
  ROUTINE_DEFINITIONS,
  buildRoutineDeliveryAccounting,
  buildConsolidatedReminderMessage,
  buildTechnicalAlertMessage,
  buildTechnicalRecoveryMessage,
  buildWhatsappHealthSnapshot,
  createMemoryReminderLedger,
  createReminderGroupingKey,
  createReminderDeliveryService,
  classifyMissedRoutineForAlert,
  createRoutineCheckpointId,
  createRoutineWindow,
  detectMissedRoutineCheckpoints,
  detectRoutineDeliveryGaps,
  findRecoverableRoutineCheckpoints,
  isGlobalActivationLocked,
  isWatchdogStartupGraceActive,
  resolveWhatsappOperationMode,
} from '../src/lib/whatsappReminderOperations.js';
import { getWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';

const baseReminder = {
  id: 'session-a',
  patientId: 'patient-a',
  patientName: 'Paciente A',
  guardianName: 'Responsável A',
  whatsapp: '27 99999-0000',
  phone: '5527999990000@c.us',
  time: '14:00',
  message: 'Mensagem fixture offline',
};

function fixedClock() {
  const dates = [
    new Date('2026-06-19T12:30:00-03:00'),
    new Date('2026-06-19T12:30:01-03:00'),
    new Date('2026-06-19T12:30:02-03:00'),
    new Date('2026-06-19T12:30:03-03:00'),
  ];
  let index = 0;
  return () => dates[Math.min(index++, dates.length - 1)];
}

test('modo operacional padrão falha fechado fora de teste', () => {
  assert.equal(resolveWhatsappOperationMode({ NODE_ENV: 'production' }), WHATSAPP_OPERATION_MODES.DISABLED);
  assert.equal(
    resolveWhatsappOperationMode({ NODE_ENV: 'production', WHATSAPP_PROCESS_ROLE: 'sender', WHATSAPP_SENDER_MODE: 'live' }),
    WHATSAPP_OPERATION_MODES.LIVE
  );
  assert.equal(
    resolveWhatsappOperationMode({ NODE_ENV: 'production', WHATSAPP_PROCESS_ROLE: 'scheduler', WHATSAPP_SCHEDULER_MODE: 'dry-run' }),
    WHATSAPP_OPERATION_MODES.DRY_RUN
  );
});

test('contabilização ponta a ponta só conclui N itens com N confirmações', () => {
  const accounting = buildRoutineDeliveryAccounting({
    expectedCount: 3,
    createdCount: 3,
    enqueuedCount: 3,
    confirmedCount: 3,
  });
  assert.equal(accounting.deliveryComplete, true);
  assert.equal(accounting.deliveryOutcome, ROUTINE_DELIVERY_OUTCOMES.SENT_CONFIRMED);
  assert.equal(accounting.failedCount, 0);
});

test('contabilização detecta zero confirmações e entrega parcial', () => {
  const zero = buildRoutineDeliveryAccounting({ expectedCount: 3, createdCount: 3, enqueuedCount: 3 });
  const partial = buildRoutineDeliveryAccounting({ expectedCount: 3, createdCount: 3, enqueuedCount: 3, confirmedCount: 1 });
  assert.equal(zero.deliveryComplete, false);
  assert.equal(zero.failedCount, 3);
  assert.equal(partial.deliveryComplete, false);
  assert.equal(partial.failedCount, 2);
  assert.equal(partial.deliveryOutcome, ROUTINE_DELIVERY_OUTCOMES.FAILED_REQUIRES_ACTION);
});

test('tratamento manual é terminal, persiste após nova leitura e impede reenfileiramento', () => {
  const ledger = createMemoryReminderLedger();
  const id = createRoutineCheckpointId({ dateStr: '2026-07-22', routine: 'HOJE_MANHA' });
  ledger.upsertCheckpoint(id, {
    date: '2026-07-22',
    routine: 'HOJE_MANHA',
    status: 'manual',
    deliveryResolution: ROUTINE_DELIVERY_OUTCOMES.MANUAL_HANDLED_BY_ADMIN,
    skipAutomaticDelivery: true,
    sentByRobot: false,
  });
  const result = ledger.queueRoutine(id, { status: 'queued' });
  assert.equal(result.status, 'manual');
  assert.equal(ledger.read().checkpoints[id].skipAutomaticDelivery, true);
});

test('watchdog gera um gap descritivo quando N esperado tem zero confirmação', () => {
  const ledger = createMemoryReminderLedger();
  ledger.upsertCheckpoint('gap', {
    date: '2026-07-22',
    routine: 'AMANHA',
    scheduledTime: '09:00',
    deliveryAccountingVersion: 1,
    expectedWindowEnd: '2026-07-22T13:00:00.000Z',
    expectedCount: 3,
    confirmedCount: 0,
  });
  const incidents = detectRoutineDeliveryGaps({ ledger, now: new Date('2026-07-22T10:01:00-03:00') });
  assert.equal(incidents.length, 1);
  assert.match(incidents[0].message, /0 de 3/);
});

test('watchdog não alerta novamente uma rotina resolvida manualmente', () => {
  const ledger = createMemoryReminderLedger();
  ledger.upsertCheckpoint('manual-gap', {
    date: '2026-07-22',
    routine: 'HOJE_MANHA',
    deliveryAccountingVersion: 1,
    expectedWindowEnd: '2026-07-22T10:15:00.000Z',
    expectedCount: 2,
    manualCount: 2,
    deliveryResolution: ROUTINE_DELIVERY_OUTCOMES.MANUAL_HANDLED_BY_ADMIN,
  });
  assert.deepEqual(detectRoutineDeliveryGaps({ ledger, now: new Date('2026-07-22T08:00:00-03:00') }), []);
});

test('dry-run registra item como skipped e nunca chama sender', async () => {
  const ledger = createMemoryReminderLedger();
  let calls = 0;
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.DRY_RUN,
    ledger,
    sender: { sendMessage: async () => { calls += 1; } },
    now: fixedClock(),
  });

  const result = await service.processReminder({
    accountId: 'account-a',
    reminder: baseReminder,
    routine: 'HOJE_TARDE',
    routineDate: '2026-06-19',
    window: { start: '2026-06-19T15:30:00.000Z', end: '2026-06-19T16:15:00.000Z' },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, 'skipped');
  assert.match(result.blockedReason, /dry-run/);
});

test('live confirma somente depois de sendMessage resolver', async () => {
  const ledger = createMemoryReminderLedger();
  const events = [];
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: {
      sendMessage: async () => {
        events.push(ledger.read());
      },
    },
    now: fixedClock(),
    logger: { log: () => {}, error: () => {} },
  });

  const result = await service.processReminder({
    accountId: 'account-a',
    reminder: baseReminder,
    routine: 'HOJE_TARDE',
    routineDate: '2026-06-19',
    window: { start: '2026-06-19T15:30:00.000Z', end: '2026-06-19T16:15:00.000Z' },
  });

  const duringSend = Object.values(events[0].reminders)[0];
  assert.equal(duringSend.status, 'attempting');
  assert.equal(result.status, 'confirmed');
  assert.ok(result.confirmedAt);
});

test('falha transitória faz retry controlado sem repetir confirmado', async () => {
  const ledger = createMemoryReminderLedger();
  let calls = 0;
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: {
      sendMessage: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Page.navigate timed out');
      },
    },
    now: fixedClock(),
    maxAttempts: 2,
    logger: { log: () => {}, error: () => {} },
  });

  const input = {
    accountId: 'account-a',
    reminder: baseReminder,
    routine: 'AMANHA',
    routineDate: '2026-06-20',
    window: { start: '2026-06-19T12:00:00.000Z', end: '2026-06-19T13:00:00.000Z' },
  };

  const first = await service.processReminder(input);
  const second = await service.processReminder(input);

  assert.equal(first.status, 'confirmed');
  assert.equal(second.status, 'confirmed');
  assert.equal(calls, 2);
});

test('status manual e suprimido impedem repetição', async () => {
  const ledger = createMemoryReminderLedger();
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: { sendMessage: async () => assert.fail('não deveria enviar') },
    now: fixedClock(),
  });

  const common = {
    accountId: 'account-a',
    reminder: baseReminder,
    routine: 'AMANHA',
    routineDate: '2026-06-20',
    window: { start: '2026-06-19T12:00:00.000Z', end: '2026-06-19T13:00:00.000Z' },
  };

  const prepared = await createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.DRY_RUN,
    ledger,
    now: fixedClock(),
  }).processReminder(common);

  ledger.upsertReminder(prepared.id, { status: 'manual' });
  assert.equal((await service.processReminder(common)).status, 'manual');

  ledger.upsertReminder(prepared.id, { status: 'suppressed' });
  assert.equal((await service.processReminder(common)).status, 'suppressed');
});

test('erro permanente em um paciente não interrompe os demais', async () => {
  const ledger = createMemoryReminderLedger();
  let calls = 0;
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: {
      sendMessage: async () => {
        calls += 1;
        if (calls === 1) throw new Error('telefone inválido');
      },
    },
    now: fixedClock(),
    maxAttempts: 2,
    logger: { log: () => {}, error: () => {} },
  });

  const results = await service.processPlan({
    accountId: 'account-a',
    routine: 'HOJE_MANHA',
    routineDate: '2026-06-19',
    window: { start: '2026-06-19T09:30:00.000Z', end: '2026-06-19T10:15:00.000Z' },
    plan: {
      reminders: [
        baseReminder,
        {
          ...baseReminder,
          id: 'session-b',
          patientId: 'patient-b',
          patientName: 'Paciente B',
          guardianName: 'Responsável B',
          phone: '5527999990001@c.us',
          whatsapp: '27 99999-0001',
        },
      ],
    },
  });

  assert.deepEqual(results.map(item => item.status), ['failed', 'confirmed']);
});

test('detecta rotina perdida e checkpoint incompleto sem recuperar envio automaticamente', () => {
  const ledger = createMemoryReminderLedger();
  ledger.upsertCheckpoint(createRoutineCheckpointId({ dateStr: '2026-06-18', routine: 'AMANHA' }), {
    date: '2026-06-18',
    routine: 'AMANHA',
    status: 'started',
  });

  const incidents = detectMissedRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-19T14:00:00-03:00'),
    lookbackDays: 1,
  });

  assert.ok(incidents.some(item => item.type === 'incomplete-routine' && item.routine === 'AMANHA'));
  assert.ok(incidents.some(item => item.type === 'missed-routine' && item.routine === 'HOJE_MANHA'));
});

test('health snapshot não aceita online como prova suficiente', () => {
  const health = buildWhatsappHealthSnapshot({
    expectedScriptPath: 'D:/Projeto Gestão Clínica - Repositório/gestão-clínica-fábio-denarde/server.js',
    pm2Process: {
      pid: 123,
      pm2_env: { pm_exec_path: 'D:/Backup Projeto Clinica completo/gestão-clínica-fábio-denarde/server.js' },
    },
    whatsappReady: false,
    schedulerRegistered: true,
    lastHeartbeat: null,
  });

  assert.equal(health.status, 'attention');
  assert.equal(health.checks.scriptPathMatches, false);
  assert.equal(health.checks.whatsappReady, false);
});

test('dois consumidores concorrentes não reivindicam a mesma rotina', () => {
  const ledger = createMemoryReminderLedger();
  const window = createRoutineWindow({ dateStr: '2026-06-19', routine: 'HOJE_TARDE' });
  const id = createRoutineCheckpointId({ dateStr: '2026-06-19', routine: 'HOJE_TARDE' });

  ledger.queueRoutine(id, {
    date: '2026-06-19',
    routine: 'HOJE_TARDE',
    expectedWindowStart: window.start,
    expectedWindowEnd: window.end,
  });

  const first = ledger.claimNextQueuedRoutine({
    ownerId: 'sender-a',
    now: new Date('2026-06-19T12:31:00-03:00'),
  });
  const second = ledger.claimNextQueuedRoutine({
    ownerId: 'sender-b',
    now: new Date('2026-06-19T12:31:00-03:00'),
  });

  assert.equal(first?.claimedBy, 'sender-a');
  assert.equal(second, null);
});

test('rotina vencida expira sem envio retroativo', () => {
  const ledger = createMemoryReminderLedger();
  const window = createRoutineWindow({ dateStr: '2026-06-18', routine: 'AMANHA' });
  const id = createRoutineCheckpointId({ dateStr: '2026-06-18', routine: 'AMANHA' });

  ledger.queueRoutine(id, {
    date: '2026-06-18',
    routine: 'AMANHA',
    expectedWindowStart: window.start,
    expectedWindowEnd: window.end,
  });

  const expired = ledger.expireOverdueQueuedRoutines(new Date('2026-06-18T11:00:00-03:00'));
  assert.equal(expired.length, 1);
  assert.equal(ledger.getCheckpoint(id).status, 'expired');
  assert.match(ledger.getCheckpoint(id).blockedReason, /retroativo bloqueado/);
});

test('scheduler e watchdog podem registrar heartbeat mesmo com remetente travado', () => {
  const ledger = createMemoryReminderLedger();
  ledger.appendHeartbeat({
    process: 'RoboClinica',
    recordedAt: '2026-06-20T08:00:00-03:00',
    whatsappReady: false,
  });
  ledger.appendHeartbeat({
    process: 'RoboClinicaScheduler',
    recordedAt: '2026-06-20T08:35:00-03:00',
    schedulerRegistered: true,
  });
  ledger.appendHeartbeat({
    process: 'RoboClinicaWatchdog',
    recordedAt: '2026-06-20T08:35:01-03:00',
  });

  const data = ledger.read();
  assert.equal(data.heartbeats.filter(item => item.process === 'RoboClinicaScheduler').length, 1);
  assert.equal(data.heartbeats.filter(item => item.process === 'RoboClinicaWatchdog').length, 1);
  assert.equal(data.heartbeats.filter(item => item.process === 'RoboClinica').length, 1);
});

test('trava global é detectada por arquivo local', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-lock-'));
  const lockPath = path.join(tempDir, 'whatsapp-activation-global.lock');
  assert.equal(isGlobalActivationLocked(lockPath), false);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 123, stage: 'test' }));
  assert.equal(isGlobalActivationLocked(lockPath), true);
});

test('ledger tolera arquivo parcial sem apagar evidência', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  fs.writeFileSync(ledgerPath, '{ "version": 1,');
  const ledger = new JsonReminderLedger(ledgerPath);
  const data = ledger.read();
  assert.equal(data.reminders && Object.keys(data.reminders).length, 0);
  assert.equal(data.incidents[0]?.type, 'ledger-read-error');
  assert.equal(fs.existsSync(ledgerPath), true);
});

test('alerta técnico persistente é enfileirado uma vez enquanto o estado permanece igual', () => {
  const ledger = createMemoryReminderLedger();
  const incident = {
    type: 'pm2-process-missing',
    severity: 'critical',
    process: 'RoboClinicaWatchdog',
    message: 'RoboClinica não encontrado no PM2.',
  };

  const first = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [incident],
    now: new Date('2026-06-20T10:00:00.000Z'),
  });
  const repeated = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [incident],
    now: new Date('2026-06-20T10:01:00.000Z'),
  });

  assert.equal(first.queued.length, 1);
  assert.equal(repeated.queued.length, 0);
  assert.equal(repeated.suppressed.length, 1);
  assert.equal(Object.values(ledger.read().adminNotifications).length, 1);
});

test('mudança de estado e nova ocorrência após resolução geram novo alerta sem spam', () => {
  const ledger = createMemoryReminderLedger();
  const base = {
    type: 'sender-heartbeat-stale',
    severity: 'high',
    process: 'RoboClinicaWatchdog',
    message: 'Heartbeat do remetente vencido ou ausente.',
  };

  ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [base],
    now: new Date('2026-06-20T10:00:00.000Z'),
  });
  const changed = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [{ ...base, severity: 'critical', stateCode: 'multiple-heartbeats-missed' }],
    now: new Date('2026-06-20T10:05:00.000Z'),
  });
  const resolved = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [],
    now: new Date('2026-06-20T10:10:00.000Z'),
  });
  const recurrence = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [base],
    now: new Date('2026-06-20T10:15:00.000Z'),
  });

  assert.equal(changed.queued.length, 1);
  assert.equal(resolved.resolved.length, 1);
  assert.equal(recurrence.queued.length, 1);
  assert.equal(Object.values(ledger.read().adminNotifications).length, 3);
});

test('retorno técnico da conexão é enfileirado uma vez após normalização e não gera spam', () => {
  const ledger = createMemoryReminderLedger();
  const incident = {
    type: 'whatsapp-connectivity-failure',
    severity: 'critical',
    process: 'RoboClinica',
    stateCode: 'disconnected',
    message: 'Cliente WhatsApp desconectado.',
  };

  const opened = ledger.reconcileTechnicalAlerts({
    scope: 'sender-connectivity',
    incidents: [incident],
    now: new Date('2026-07-06T04:58:00.000Z'),
  });
  assert.equal(opened.queued.length, 1);

  const resolved = ledger.reconcileTechnicalAlerts({
    scope: 'sender-connectivity',
    incidents: [],
    now: new Date('2026-07-06T05:02:00.000Z'),
  });
  const repeatedResolution = ledger.reconcileTechnicalAlerts({
    scope: 'sender-connectivity',
    incidents: [],
    now: new Date('2026-07-06T05:03:00.000Z'),
  });

  assert.equal(resolved.resolved.length, 1);
  assert.ok(resolved.resolved[0].recoveryNotificationId);
  assert.equal(repeatedResolution.resolved.length, 0);

  const notifications = Object.values(ledger.read().adminNotifications);
  assert.equal(notifications.length, 2);
  assert.equal(notifications.filter(item => item.type === 'technical-alert').length, 1);
  assert.equal(notifications.filter(item => item.type === 'technical-recovery').length, 1);
  assert.match(notifications.find(item => item.type === 'technical-recovery')?.message || '', /RETORNO TÉCNICO/);
  assert.match(notifications.find(item => item.type === 'technical-recovery')?.message || '', /Conexão do WhatsApp restabelecida/);
  assert.match(notifications.find(item => item.type === 'technical-recovery')?.message || '', /NORMALIZADO/);
});

test('retorno técnico só é criado para recuperação de conectividade com alerta administrativo elegível', () => {
  const ledger = createMemoryReminderLedger();

  ledger.reconcileTechnicalAlerts({
    scope: 'sender-runtime',
    incidents: [{
      type: 'sender-runtime-error',
      severity: 'high',
      process: 'RoboClinica',
      message: 'Falha no processo remetente.',
    }],
    now: new Date('2026-07-06T05:00:00.000Z'),
  });
  ledger.reconcileTechnicalAlerts({
    scope: 'sender-runtime',
    incidents: [],
    now: new Date('2026-07-06T05:01:00.000Z'),
  });

  assert.equal(
    Object.values(ledger.read().adminNotifications).filter(item => item.type === 'technical-recovery').length,
    0,
  );
});

test('mensagem de retorno técnico é sanitizada e confirma disponibilidade do robô', () => {
  const message = buildTechnicalRecoveryMessage({
    type: 'whatsapp-connectivity-failure',
    process: 'RoboClinica',
    message: 'Sessão em D:\\Projeto\\segredo PID 12345',
  }, new Date('2026-07-06T05:02:00.000Z'));

  assert.match(message, /RETORNO TÉCNICO/);
  assert.match(message, /Conexão do WhatsApp restabelecida/);
  assert.match(message, /robô disponível/);
  assert.match(message, /NORMALIZADO/);
  assert.doesNotMatch(message, /D:\\Projeto|12345|RoboClinica/);
});

test('alerta técnico administrativo é sanitizado e não expõe caminho, PID ou identificador interno', () => {
  const message = buildTechnicalAlertMessage({
    type: 'script-path-mismatch',
    severity: 'critical',
    process: 'RoboClinicaWatchdog',
    message: 'Script path incorreto: D:\\Projeto\\segredo\\server.js PID 12345',
  }, new Date('2026-06-20T10:00:00.000Z'));

  assert.match(message, /ALERTA TÉCNICO/);
  assert.match(message, /Configuração do processo divergente/);
  assert.doesNotMatch(message, /D:\\Projeto|12345|server\.js|RoboClinicaWatchdog/);
});


test('ledger em arquivo preserva mutações concorrentes de processos distintos', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-concurrency-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const workerPath = path.join(tempDir, 'ledger-worker.mjs');
  const operationsModuleUrl = pathToFileURL(path.resolve('src/lib/whatsappReminderOperations.js')).href;
  const iterations = 8;
  const workers = ['RoboClinica', 'RoboClinicaScheduler', 'RoboClinicaWatchdog'];

  fs.writeFileSync(workerPath, `
    import { JsonReminderLedger } from ${JSON.stringify(operationsModuleUrl)};
    const [ledgerPath, workerName, iterationsRaw] = process.argv.slice(2);
    const ledger = new JsonReminderLedger(ledgerPath);
    const iterations = Number(iterationsRaw);
    for (let index = 0; index < iterations; index += 1) {
      const suffix = workerName + ':' + index;
      ledger.appendHeartbeat({ process: workerName, event: 'concurrency-test', sequence: index });
      ledger.appendIncident({ type: 'concurrency-test', process: workerName, sequence: index });
      ledger.upsertCheckpoint('checkpoint:' + suffix, { routine: 'TEST', status: 'healthy' });
      ledger.updateAdminNotification('notification:' + suffix, { status: 'skipped', source: workerName });
      ledger.upsertReminder('reminder:' + suffix, { status: 'skipped', source: workerName });
      await new Promise(resolve => setTimeout(resolve, index % 3));
    }
  `);

  const runWorker = workerName => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ledgerPath, workerName, String(iterations)], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: 'America/Sao_Paulo' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Worker ${workerName} falhou com código ${code}: ${stderr}`));
    });
  });

  await Promise.all(workers.map(runWorker));

  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const parsed = JSON.parse(raw);
  const expectedEntries = workers.length * iterations;

  assert.equal(parsed.heartbeats.length, expectedEntries);
  assert.equal(parsed.incidents.length, expectedEntries);
  assert.equal(Object.keys(parsed.checkpoints).length, expectedEntries);
  assert.equal(Object.keys(parsed.adminNotifications).length, expectedEntries);
  assert.equal(Object.keys(parsed.reminders).length, expectedEntries);
  for (const workerName of workers) {
    assert.equal(parsed.heartbeats.filter(item => item.process === workerName).length, iterations);
  }

  const temporaryFiles = fs.readdirSync(tempDir).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(temporaryFiles, []);
  const lockDir = path.join(tempDir, '.locks');
  const remainingLocks = fs.existsSync(lockDir)
    ? fs.readdirSync(lockDir).filter(name => name.endsWith('.lock'))
    : [];
  assert.deepEqual(remainingLocks, []);
});

test('histórico persistente de heartbeat continua limitado aos 288 registros mais recentes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-heartbeats-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const ledger = new JsonReminderLedger(ledgerPath);

  for (let index = 0; index < 300; index += 1) {
    ledger.appendHeartbeat({
      process: 'RoboClinica',
      sequence: index,
      recordedAt: new Date(Date.UTC(2026, 5, 22, 18, 0, index)).toISOString(),
    });
  }

  const heartbeats = ledger.read().heartbeats;
  assert.equal(heartbeats.length, 288);
  assert.equal(heartbeats[0].sequence, 12);
  assert.equal(heartbeats.at(-1).sequence, 299);
  assert.deepEqual(fs.readdirSync(tempDir).filter(name => name.endsWith('.tmp')), []);
});


test('ledger recupera imediatamente lock abandonado por processo inexistente', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-orphan-lock-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const lockDir = path.join(tempDir, '.locks');
  const lockPath = path.join(lockDir, 'whatsapp-ledger.lock');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    ownerToken: 'processo-inexistente',
    createdAt: new Date(Date.now() - 10_000).toISOString(),
  }));
  const oldDate = new Date(Date.now() - 10_000);
  fs.utimesSync(lockPath, oldDate, oldDate);

  const ledger = new JsonReminderLedger(ledgerPath);
  ledger.appendHeartbeat({ process: 'RoboClinicaScheduler', event: 'orphan-lock-recovery' });

  assert.equal(ledger.read().heartbeats.at(-1)?.event, 'orphan-lock-recovery');
  assert.equal(fs.existsSync(lockPath), false);
});

test('ledger não remove lock recente pertencente a processo vivo', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-live-lock-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const lockDir = path.join(tempDir, '.locks');
  const lockPath = path.join(lockDir, 'whatsapp-ledger.lock');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    ownerToken: 'processo-vivo',
    createdAt: new Date().toISOString(),
  }));

  const ledger = new JsonReminderLedger(ledgerPath);
  assert.throws(
    () => ledger.withExclusiveLock('whatsapp-ledger', () => null, {
      staleMs: 60_000,
      orphanGraceMs: 0,
      waitTimeoutMs: 40,
      retryDelayMs: 5,
    }),
    /Tempo limite ao aguardar lock do ledger/
  );
  assert.equal(fs.existsSync(lockPath), true);
});

test('gravação do ledger repete rename transitório no Windows e não deixa tmp', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-rename-retry-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const ledger = new JsonReminderLedger(ledgerPath);
  const originalRenameSync = fs.renameSync;
  let attempts = 0;

  fs.renameSync = (...args) => {
    attempts += 1;
    if (attempts <= 2) {
      const error = new Error('arquivo temporariamente ocupado');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(...args);
  };

  try {
    ledger.appendHeartbeat({ process: 'RoboClinica', event: 'rename-retry' });
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(attempts, 3);
  assert.equal(ledger.read().heartbeats.at(-1)?.event, 'rename-retry');
  assert.deepEqual(fs.readdirSync(tempDir).filter(name => name.endsWith('.tmp')), []);
});

test('ledger limita incidentes persistentes e reduz crescimento indefinido', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-incident-cap-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const incidents = Array.from({ length: 2005 }, (_, sequence) => ({
    type: 'historical-test',
    sequence,
    recordedAt: new Date(Date.UTC(2026, 5, 20, 0, 0, sequence % 60)).toISOString(),
  }));
  fs.writeFileSync(ledgerPath, JSON.stringify({
    version: 2,
    reminders: {},
    checkpoints: {},
    adminNotifications: {},
    adminAlertStates: {},
    incidents,
    heartbeats: [],
  }));

  const ledger = new JsonReminderLedger(ledgerPath);
  ledger.appendIncident({ type: 'new-incident', sequence: 2005 });

  const persisted = ledger.read().incidents;
  assert.equal(persisted.length, 2000);
  assert.equal(persisted[0].sequence, 6);
  assert.equal(persisted.at(-1).type, 'new-incident');
});

test('alerta técnico persistente suprimido não regrava o ledger a cada minuto', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpp-ledger-alert-throttle-'));
  const ledgerPath = path.join(tempDir, 'ledger.json');
  const ledger = new JsonReminderLedger(ledgerPath);
  const incident = {
    type: 'sender-heartbeat-stale',
    severity: 'high',
    process: 'RoboClinicaWatchdog',
    message: 'Heartbeat do remetente vencido ou ausente.',
  };

  ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [incident],
    now: new Date('2026-06-25T10:00:00.000Z'),
  });
  const before = fs.readFileSync(ledgerPath, 'utf8');

  const repeated = ledger.reconcileTechnicalAlerts({
    scope: 'watchdog-health',
    incidents: [incident],
    now: new Date('2026-06-25T10:01:00.000Z'),
  });
  const after = fs.readFileSync(ledgerPath, 'utf8');

  assert.equal(repeated.queued.length, 0);
  assert.equal(repeated.suppressed.length, 1);
  assert.equal(after, before);
});

test('prévias administrativas e alertas técnicos vencidos não são enviados retroativamente', () => {
  const ledger = createMemoryReminderLedger();
  ledger.queueAdminNotification('preview-old', {
    type: 'preventive-preview',
    queuedAt: '2026-06-25T09:15:00.000Z',
    expectedWindowEnd: '2026-06-25T10:15:00.000Z',
  });
  ledger.queueAdminNotification('technical-old', {
    type: 'technical-alert',
  });
  ledger.updateAdminNotification('technical-old', {
    queuedAt: '2026-06-25T09:00:00.000Z',
  });

  const expired = ledger.expireOverdueQueuedAdminNotifications(
    new Date('2026-06-25T12:00:00.000Z'),
    { technicalAlertMaxAgeMs: 30 * 60 * 1000 },
  );

  assert.equal(expired.length, 2);
  assert.equal(ledger.getAdminNotification('preview-old').status, 'expired');
  assert.equal(ledger.getAdminNotification('technical-old').status, 'expired');
  assert.equal(
    ledger.claimNextQueuedAdminNotification({
      ownerId: 'sender-test',
      now: new Date('2026-06-25T12:00:00.000Z'),
    }),
    null,
  );
});


test('runtime protege heartbeats contra falha de ledger e expira fila administrativa antiga', () => {
  const senderSource = fs.readFileSync(path.resolve('server.js'), 'utf8');
  const schedulerSource = fs.readFileSync(path.resolve('scripts/whatsapp-reminder-scheduler.js'), 'utf8');
  const watchdogSource = fs.readFileSync(path.resolve('scripts/whatsapp-reminder-watchdog.js'), 'utf8');

  assert.match(senderSource, /function safeLedgerCall/);
  assert.match(senderSource, /expireOverdueQueuedAdminNotifications\(\)/);
  assert.match(schedulerSource, /function safeLedgerCall/);
  assert.match(schedulerSource, /expectedWindowEnd:\s*window\.end/);
  assert.match(schedulerSource, /findRecoverableRoutineCheckpoints/);
  assert.match(schedulerSource, /recoverRoutinesWithinSafeWindow/);
  assert.match(watchdogSource, /function safeLedgerCall/);
  assert.match(watchdogSource, /reconcileTechnicalAlerts\(options\)/);
  assert.match(watchdogSource, /isWatchdogStartupGraceActive/);
  assert.match(watchdogSource, /classifyMissedRoutineForAlert/);
});


test('scheduler recupera rotina ausente somente dentro da janela segura', () => {
  const ledger = createMemoryReminderLedger();

  const recoverable = findRecoverableRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-27T12:32:00-03:00'),
    recoveryDelayMs: 60_000,
  });

  assert.ok(recoverable.some(item => item.routine === 'HOJE_TARDE'));
  assert.ok(recoverable.every(item => item.date === '2026-06-27'));
});

test('scheduler não duplica rotina que já possui checkpoint', () => {
  const ledger = createMemoryReminderLedger();
  const id = createRoutineCheckpointId({ dateStr: '2026-06-27', routine: 'HOJE_TARDE' });
  ledger.queueRoutine(id, {
    date: '2026-06-27',
    routine: 'HOJE_TARDE',
    expectedWindowEnd: '2026-06-27T16:15:00.000Z',
  });

  const recoverable = findRecoverableRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-27T12:32:00-03:00'),
    recoveryDelayMs: 60_000,
  });

  assert.equal(recoverable.some(item => item.routine === 'HOJE_TARDE'), false);
});

test('scheduler não recupera rotina depois do encerramento da janela', () => {
  const ledger = createMemoryReminderLedger();

  const recoverable = findRecoverableRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-27T13:16:00-03:00'),
    recoveryDelayMs: 60_000,
  });

  assert.equal(recoverable.some(item => item.routine === 'HOJE_TARDE'), false);
});

test('scheduler respeita regra semanal ao procurar recuperação', () => {
  const ledger = createMemoryReminderLedger();

  const saturday = findRecoverableRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-27T12:32:00-03:00'),
    recoveryDelayMs: 60_000,
  });
  const sunday = findRecoverableRoutineCheckpoints({
    ledger,
    now: new Date('2026-06-28T12:32:00-03:00'),
    recoveryDelayMs: 60_000,
  });

  assert.ok(saturday.some(item => item.routine === 'HOJE_TARDE'));
  assert.equal(saturday.some(item => item.routine === 'AMANHA'), false);
  assert.equal(sunday.some(item => item.routine === 'HOJE_TARDE'), false);
});

test('watchdog suprime alerta de rotina quando a prévia confirma ausência de demanda', () => {
  const ledger = createMemoryReminderLedger();
  ledger.updateAdminNotification('admin-preview:2026-06-27:HOJE_TARDE', {
    type: 'preventive-preview',
    date: '2026-06-27',
    routine: 'HOJE_TARDE',
    status: 'skipped',
    blockedReason: 'nenhuma mensagem elegível; prévia administrativa suprimida',
  });

  const result = classifyMissedRoutineForAlert({
    ledger,
    incident: {
      type: 'missed-routine',
      date: '2026-06-27',
      routine: 'HOJE_TARDE',
      message: 'Rotina sem checkpoint.',
    },
    now: new Date('2026-06-27T13:16:00-03:00'),
  });

  assert.equal(result.notifyAdmin, false);
  assert.equal(result.reason, 'no-eligible-demand');
});

test('watchdog mantém alerta quando a prévia confirma avisos elegíveis', () => {
  const ledger = createMemoryReminderLedger();
  ledger.updateAdminNotification('admin-preview:2026-06-30:AMANHA', {
    type: 'preventive-preview',
    date: '2026-06-30',
    routine: 'AMANHA',
    status: 'sent',
    previewSnapshot: {
      entries: [
        { state: 'eligible' },
        { state: 'blocked' },
      ],
    },
  });

  const result = classifyMissedRoutineForAlert({
    ledger,
    incident: {
      type: 'missed-routine',
      date: '2026-06-30',
      routine: 'AMANHA',
      message: 'Rotina sem checkpoint.',
    },
    now: new Date('2026-06-30T10:01:00-03:00'),
  });

  assert.equal(result.notifyAdmin, true);
  assert.equal(result.reason, 'eligible-demand-confirmed');
  assert.equal(result.incident.stateCode, 'eligible-demand-missed');
  assert.match(result.incident.message, /1 aviso/);
});

test('watchdog descreve demanda como não confirmada quando a prévia do dia está ausente', () => {
  const ledger = createMemoryReminderLedger();

  const result = classifyMissedRoutineForAlert({
    ledger,
    incident: {
      type: 'missed-routine',
      date: '2026-06-30',
      routine: 'AMANHA',
      message: 'Rotina sem checkpoint.',
    },
    now: new Date('2026-06-30T10:01:00-03:00'),
  });

  assert.equal(result.notifyAdmin, true);
  assert.equal(result.reason, 'demand-unverified');
  assert.equal(result.incident.type, 'routine-demand-unverified');
  assert.match(result.incident.message, /não permitiu confirmar/);
});

test('watchdog respeita tolerância de inicialização antes de alertar heartbeat', () => {
  const startedAt = new Date('2026-06-27T21:47:49-03:00');

  assert.equal(isWatchdogStartupGraceActive({
    startedAt,
    now: new Date('2026-06-27T21:52:00-03:00'),
    graceMs: 10 * 60 * 1000,
  }), true);

  assert.equal(isWatchdogStartupGraceActive({
    startedAt,
    now: new Date('2026-06-27T21:58:00-03:00'),
    graceMs: 10 * 60 * 1000,
  }), false);
});

const syntheticPatients = [
  { id: 'synthetic-patient-a', name: 'Paciente Sintético A', status: 'Ativo', guardianName: 'Responsável Sintético', responsibleId: 'synthetic-responsible-1', whatsapp: '27 98888-0001' },
  { id: 'synthetic-patient-b', name: 'Paciente Sintético B', status: 'Ativo', guardianName: 'Responsável Sintético', responsibleId: 'synthetic-responsible-1', whatsapp: '27 98888-0001' },
  { id: 'synthetic-patient-c', name: 'Paciente Sintético C', status: 'Ativo', guardianName: 'Responsável Sintético', responsibleId: 'synthetic-responsible-1', whatsapp: '27 98888-0001' },
];

function syntheticSession(id, patientId, date, time) {
  return { id, patientId, date, time, status: 'Agendada', type: 'Sessão simples (50 min)', isBlocked: false, isVirtual: false };
}

function syntheticPlan(tipo, sessions, patients = syntheticPatients) {
  return getWhatsappReminderPlan({
    runDateStr: '2026-08-10',
    tipo,
    patients,
    sessions,
    settings: { holidays: [] },
    referenceDateStr: '2026-08-01',
  });
}

function liveOfflineDelivery({ ledger = createMemoryReminderLedger(), messages, maxAttempts = 1 } = {}) {
  return createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: {
      sendMessage: async (phone, message) => {
        messages.push({ phone, message });
      },
    },
    maxAttempts,
    logger: { log: () => {}, error: () => {} },
    now: fixedClock(),
  });
}

test('fixture individual de véspera preserva exatamente o texto atual', () => {
  const plan = syntheticPlan('AMANHA', [syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-11', '17:00')]);
  assert.equal(plan.reminders.length, 1);
  assert.equal(
    plan.reminders[0].message,
    'Bom dia! Olá, Responsável Sintético, tudo bem?\n\nPassando para lembrar você da sessão de *Paciente Sintético A* amanhã, às *17:00*.\n\nAguardo sua confirmação,\nAté logo!',
  );
});

test('dois pacientes da véspera geram uma única mensagem consolidada', async () => {
  const plan = syntheticPlan('AMANHA', [
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-11', '18:00'),
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-11', '17:00'),
  ]);
  const messages = [];
  const service = liveOfflineDelivery({ messages });
  const results = await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'AMANHA', routineDate: plan.dateStr, window: {} });

  assert.equal(messages.length, 1);
  assert.equal(results.filter(item => item.status === 'confirmed').length, 2);
  assert.equal(messages[0].message, 'Bom dia! Olá, Responsável Sintético, tudo bem?\n\nPassando para lembrar você das sessões de *Paciente Sintético A* amanhã, às *17:00*, e de *Paciente Sintético B*, às *18:00*.\n\nAguardo sua confirmação,\nAté logo!');
});

test('três pacientes da véspera são consolidados em ordem cronológica', () => {
  const reminders = [
    { id: 'c', patientName: 'Paciente C', guardianName: 'Responsável', responsibleName: 'Responsável', time: '19:00' },
    { id: 'a', patientName: 'Paciente A', guardianName: 'Responsável', responsibleName: 'Responsável', time: '17:00' },
    { id: 'b', patientName: 'Paciente B', guardianName: 'Responsável', responsibleName: 'Responsável', time: '18:00' },
  ];
  assert.equal(buildConsolidatedReminderMessage({ reminders, routine: 'AMANHA' }), 'Bom dia! Olá, Responsável, tudo bem?\n\nPassando para lembrar você das sessões de *Paciente A* amanhã, às *17:00*, de *Paciente B*, às *18:00*, e de *Paciente C*, às *19:00*.\n\nAguardo sua confirmação,\nAté logo!');
});

test('um paciente da manhã preserva o texto atual e dois são consolidados', async () => {
  const one = syntheticPlan('HOJE_MANHA', [syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '09:00')]);
  assert.equal(one.reminders[0].message, 'Bom dia!\nAguardo vocês hoje às *09h*!\nAté logo! 🙏🏼');

  const two = syntheticPlan('HOJE_MANHA', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '09:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '10:30'),
  ]);
  const messages = [];
  const service = liveOfflineDelivery({ messages });
  await service.processPlan({ accountId: 'synthetic-account', plan: two, routine: 'HOJE_MANHA', routineDate: two.dateStr, window: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, 'Bom dia!\nAguardo vocês hoje: *Paciente Sintético A às 09h* e *Paciente Sintético B às 10:30h*!\nAté logo! 🙏🏼');
});

test('dois pacientes da tarde são consolidados com saudação da tarde', async () => {
  const plan = syntheticPlan('HOJE_TARDE', [
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '15:30'),
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '14:00'),
  ]);
  const messages = [];
  const service = liveOfflineDelivery({ messages });
  await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'HOJE_TARDE', routineDate: plan.dateStr, window: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, 'Boa tarde!\nAguardo vocês hoje: *Paciente Sintético A às 14h* e *Paciente Sintético B às 15:30h*!\nAté logo! 🙏🏼');
});

test('manhã e tarde permanecem grupos independentes nos horários atuais', async () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(ROUTINE_DEFINITIONS).map(([routine, definition]) => [routine, definition.scheduledTime])),
    { HOJE_MANHA: '06:30', AMANHA: '09:00', HOJE_TARDE: '12:30' },
  );
  const morning = syntheticPlan('HOJE_MANHA', [syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '09:00')]);
  const afternoon = syntheticPlan('HOJE_TARDE', [syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '15:00')]);
  const messages = [];
  const service = liveOfflineDelivery({ messages });
  await service.processPlan({ accountId: 'synthetic-account', plan: morning, routine: 'HOJE_MANHA', routineDate: morning.dateStr, window: {} });
  await service.processPlan({ accountId: 'synthetic-account', plan: afternoon, routine: 'HOJE_TARDE', routineDate: afternoon.dateStr, window: {} });
  assert.equal(messages.length, 2);
});

test('responsáveis diferentes no mesmo horário não são agrupados', async () => {
  const patients = [
    syntheticPatients[0],
    { ...syntheticPatients[1], guardianName: 'Outro Responsável Sintético', responsibleId: 'synthetic-responsible-2', whatsapp: '27 98888-0002' },
  ];
  const plan = syntheticPlan('HOJE_MANHA', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '09:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '09:00'),
  ], patients);
  const messages = [];
  const service = liveOfflineDelivery({ messages });
  await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'HOJE_MANHA', routineDate: plan.dateStr, window: {} });
  assert.equal(messages.length, 2);
});

test('responsáveis com telefone compartilhado e identificador distinto não são misturados', () => {
  const first = { responsibleId: 'synthetic-responsible-1', responsibleName: 'Responsável Um', guardianName: 'Responsável Um', phone: '5527999990000@c.us' };
  const second = { responsibleId: 'synthetic-responsible-2', responsibleName: 'Responsável Dois', guardianName: 'Responsável Dois', phone: '5527999990000@c.us' };
  assert.notEqual(
    createReminderGroupingKey({ accountId: 'synthetic-account', reminder: first, routine: 'AMANHA', routineDate: '2026-08-11' }),
    createReminderGroupingKey({ accountId: 'synthetic-account', reminder: second, routine: 'AMANHA', routineDate: '2026-08-11' }),
  );
});

test('atendimento fora do lote atual não entra no plano', () => {
  const plan = syntheticPlan('HOJE_MANHA', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '09:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '15:00'),
  ]);
  assert.deepEqual(plan.reminders.map(item => item.patientId), ['synthetic-patient-a']);
  assert.equal(plan.diagnostics.find(item => item.id === 'synthetic-session-b')?.blockedReason, 'fora do turno (Sessão da tarde)');
});

test('lembrete já confirmado não é reenviado e o pendente segue individualmente', async () => {
  const plan = syntheticPlan('AMANHA', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-11', '17:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-11', '18:00'),
  ]);
  const messages = [];
  const ledger = createMemoryReminderLedger();
  const service = liveOfflineDelivery({ ledger, messages });
  await service.processReminder({ accountId: 'synthetic-account', reminder: plan.reminders[0], routine: 'AMANHA', routineDate: plan.dateStr, window: {} });
  await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'AMANHA', routineDate: plan.dateStr, window: {} });
  assert.equal(messages.length, 2);
  assert.match(messages[1].message, /Paciente Sintético B/);
  assert.doesNotMatch(messages[1].message, /Paciente Sintético A/);
});

test('sucesso agrupado confirma todos os IDs constituintes no ledger', async () => {
  const plan = syntheticPlan('AMANHA', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-11', '17:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-11', '18:00'),
  ]);
  const messages = [];
  const ledger = createMemoryReminderLedger();
  const service = liveOfflineDelivery({ ledger, messages });
  await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'AMANHA', routineDate: plan.dateStr, window: {} });
  assert.equal(messages.length, 1);
  const statuses = Object.values(ledger.read().reminders).map(item => item.status);
  assert.equal(statuses.length, 2);
  assert.deepEqual(statuses, ['confirmed', 'confirmed']);
});

test('falha no envio agrupado não confirma nenhum integrante', async () => {
  const plan = syntheticPlan('HOJE_TARDE', [
    syntheticSession('synthetic-session-a', 'synthetic-patient-a', '2026-08-10', '14:00'),
    syntheticSession('synthetic-session-b', 'synthetic-patient-b', '2026-08-10', '15:00'),
  ]);
  const ledger = createMemoryReminderLedger();
  const service = createReminderDeliveryService({
    mode: WHATSAPP_OPERATION_MODES.LIVE,
    ledger,
    sender: { sendMessage: async () => { throw new Error('falha sintética de envio'); } },
    maxAttempts: 1,
    logger: { log: () => {}, error: () => {} },
    now: fixedClock(),
  });
  const results = await service.processPlan({ accountId: 'synthetic-account', plan, routine: 'HOJE_TARDE', routineDate: plan.dateStr, window: {} });
  assert.deepEqual(results.map(item => item.status), ['failed', 'failed']);
  assert.equal(Object.values(ledger.read().reminders).filter(item => item.status === 'confirmed').length, 0);
  assert.equal(Object.values(ledger.read().reminders).filter(item => item.status === 'failed').length, 2);
});
