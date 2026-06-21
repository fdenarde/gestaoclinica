import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WHATSAPP_OPERATION_MODES,
  JsonReminderLedger,
  buildWhatsappHealthSnapshot,
  createMemoryReminderLedger,
  createReminderDeliveryService,
  createRoutineCheckpointId,
  createRoutineWindow,
  detectMissedRoutineCheckpoints,
  isGlobalActivationLocked,
  resolveWhatsappOperationMode,
} from '../src/lib/whatsappReminderOperations.js';

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
        { ...baseReminder, id: 'session-b', patientId: 'patient-b', patientName: 'Paciente B' },
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
