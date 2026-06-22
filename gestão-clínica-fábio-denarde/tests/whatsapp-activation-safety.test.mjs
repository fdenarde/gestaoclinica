import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canRecoverActivationLock,
  capturePm2ProcessState,
  containsCorruptedUnicode,
  hasEnoughMarginBeforeNextProtectedWindow,
  isInsideProtectedWindow,
  planRollbackActions,
  resolveProjectRootFromScriptPath,
} from '../src/lib/whatsappActivationSafety.js';

const fixtureProjectRoot = path.resolve('D:/Projeto Gestão Clínica - Repositório/gestão-clínica-fábio-denarde');
const runtimeProjectRoot = process.cwd();
const scriptsRoot = path.join(fixtureProjectRoot, 'scripts');

function fakeExists(filePath) {
  return ['server.js', 'package.json', 'ecosystem.config.cjs'].some(name => filePath.endsWith(name));
}

test('resolve ProjectRoot a partir do diretório do script com acentos preservados', () => {
  assert.equal(resolveProjectRootFromScriptPath(scriptsRoot, fakeExists), fixtureProjectRoot);
});

test('recusa ProjectRoot com caracteres corrompidos', () => {
  const corrupted = 'D:/Projeto GestÃ£o ClÃ­nica - RepositÃ³rio/gestão-clínica-fábio-denarde/scripts';
  assert.throws(() => resolveProjectRootFromScriptPath(corrupted, fakeExists), /corrompidos/);
  assert.equal(containsCorruptedUnicode(corrupted), true);
});

test('recusa ProjectRoot quando server.js está ausente', () => {
  assert.throws(
    () => resolveProjectRootFromScriptPath(scriptsRoot, filePath => !filePath.endsWith('server.js')),
    /server\.js/
  );
});

test('detecta janelas protegidas e margem antes da próxima janela', () => {
  assert.equal(isInsideProtectedWindow(new Date(2026, 5, 20, 8, 33, 0))?.label, '08:20-09:20');
  assert.equal(isInsideProtectedWindow(new Date(2026, 5, 20, 13, 0, 0)), null);
  assert.equal(hasEnoughMarginBeforeNextProtectedWindow(new Date(2026, 5, 20, 11, 35, 0), 20), false);
  assert.equal(hasEnoughMarginBeforeNextProtectedWindow(new Date(2026, 5, 20, 13, 0, 0), 20), true);
});

test('captura estado PM2 relevante sem expor ambiente inteiro', () => {
  const snapshot = capturePm2ProcessState([
    {
      name: 'RoboClinica',
      pm_id: 1,
      pid: 123,
      pm2_env: {
        status: 'online',
        pm_exec_path: path.join(fixtureProjectRoot, 'server.js'),
        pm_cwd: fixtureProjectRoot,
        exec_mode: 'fork_mode',
        restart_time: 0,
        env: { WHATSAPP_PROCESS_ROLE: 'sender' },
      },
    },
  ]);
  assert.deepEqual(snapshot[0], {
    name: 'RoboClinica',
    pm_id: 1,
    pid: 123,
    status: 'online',
    script: path.join(fixtureProjectRoot, 'server.js'),
    cwd: fixtureProjectRoot,
    execMode: 'fork_mode',
    restarts: 0,
    role: 'sender',
  });
});

test('rollback não inicia Scheduler/Watchdog se não existiam antes e preserva ClinicaFrontend', () => {
  const original = [
    { name: 'ClinicaFrontend', pm_id: 0 },
    { name: 'RoboClinica', pm_id: 1 },
  ];
  const current = [
    { name: 'ClinicaFrontend', pm_id: 0 },
    { name: 'RoboClinica', pm_id: 1 },
    { name: 'RoboClinicaScheduler', pm_id: 2 },
    { name: 'RoboClinicaWatchdog', pm_id: 3 },
  ];
  const actions = planRollbackActions({ originalProcesses: original, currentProcesses: current });
  assert.ok(actions.some(action => action.type === 'delete-process' && action.name === 'RoboClinicaScheduler'));
  assert.ok(actions.some(action => action.type === 'delete-process' && action.name === 'RoboClinicaWatchdog'));
  assert.ok(actions.some(action => action.type === 'preserve-process' && action.name === 'ClinicaFrontend'));
  assert.ok(!actions.some(action => action.type === 'restart-existing-process' && action.name === 'ClinicaFrontend'));
  assert.ok(actions.some(action => action.type === 'skip-pm2-save'));
});

test('rollback com estado sanitizado funciona sem pm_id e sem ambiente PM2 bruto', () => {
  const original = [
    { name: 'RoboClinica', pid: 24376, status: 'online', pm_exec_path: `${fixtureProjectRoot}/server.js` },
  ];
  const current = [
    { name: 'RoboClinica', pid: 24376, status: 'online', pm_exec_path: `${fixtureProjectRoot}/server.js` },
    { name: 'RoboClinicaScheduler', pid: 30001, status: 'online' },
    { name: 'RoboClinicaWatchdog', pid: 30002, status: 'online' },
  ];
  const actions = planRollbackActions({
    originalProcesses: original,
    currentProcesses: current,
    backupAvailable: true,
    failureStage: 'dry-run',
  });

  assert.ok(actions.some(action => action.type === 'restore-file'));
  assert.ok(actions.some(action => action.type === 'delete-process' && action.name === 'RoboClinicaScheduler'));
  assert.ok(actions.some(action => action.type === 'delete-process' && action.name === 'RoboClinicaWatchdog'));
  assert.ok(actions.some(action => action.type === 'restart-existing-process' && action.name === 'RoboClinica'));
  assert.ok(actions.some(action => action.type === 'skip-pm2-save' && action.failureStage === 'dry-run'));
});

test('rollback cobre falha antes do backup completo sem recriar processos inexistentes', () => {
  const actions = planRollbackActions({
    originalProcesses: [{ name: 'RoboClinica', pid: 24376 }],
    currentProcesses: [{ name: 'RoboClinica', pid: 24376 }],
    backupAvailable: false,
    failureStage: 'before-backup',
  });

  assert.ok(actions.some(action => action.type === 'skip-restore-file'));
  assert.ok(!actions.some(action => action.type === 'delete-process'));
  assert.ok(!actions.some(action => action.name === 'RoboClinicaScheduler' && action.type === 'restart-existing-process'));
  assert.ok(!actions.some(action => action.name === 'RoboClinicaWatchdog' && action.type === 'restart-existing-process'));
  assert.ok(actions.some(action => action.type === 'skip-pm2-save' && action.failureStage === 'before-backup'));
});

test('rollback após sender ready preserva processos anteriores e nunca toca ClinicaFrontend', () => {
  const original = [
    { name: 'ClinicaFrontend', pid: 111 },
    { name: 'RoboClinica', pid: 24376 },
    { name: 'RoboClinicaScheduler', pid: 222 },
  ];
  const current = [
    { name: 'ClinicaFrontend', pid: 111 },
    { name: 'RoboClinica', pid: 24377 },
    { name: 'RoboClinicaScheduler', pid: 222 },
    { name: 'RoboClinicaWatchdog', pid: 333 },
  ];
  const actions = planRollbackActions({
    originalProcesses: original,
    currentProcesses: current,
    failureStage: 'after-sender-ready',
  });

  assert.ok(actions.some(action => action.type === 'preserve-process' && action.name === 'ClinicaFrontend'));
  assert.ok(!actions.some(action => action.type === 'restart-existing-process' && action.name === 'ClinicaFrontend'));
  assert.ok(actions.some(action => action.type === 'restart-existing-process' && action.name === 'RoboClinicaScheduler'));
  assert.ok(actions.some(action => action.type === 'delete-process' && action.name === 'RoboClinicaWatchdog'));
});

test('ativador usa helper PM2 sanitizado e exige PowerShell 7+', () => {
  const activator = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  assert.match(activator, /read-pm2-whatsapp-state\.js/);
  assert.match(activator, /Assert-PowerShellHost/);
  assert.match(activator, /pwsh -NoProfile/);
  assert.match(activator, /--from-pm2 --base64/);
  assert.match(activator, /FromBase64String/);
  assert.match(activator, /Encoding\]::UTF8/);
  assert.match(activator, /StringComparer\]::OrdinalIgnoreCase/);
  assert.match(activator, /pm_cwd/);
  assert.doesNotMatch(activator, /pm2 jlist[\s\S]{0,80}ConvertFrom-Json/);
  assert.match(activator, /pm2" @\("start", "\.\\ecosystem\.config\.cjs", "--only", "RoboClinica"/);
  assert.match(activator, /Wait-Pm2OperationalModes/);
  assert.match(activator, /Wait-LiveRuntimeEvidence/);
  assert.doesNotMatch(activator, /pm2" @\("restart", "RoboClinica", "--update-env"\)/);
});

test('lock ativo não é removível e lock órfão antigo pode ser recuperado', () => {
  const active = canRecoverActivationLock({
    lock: {
      pid: 123,
      createdAt: '2026-06-20T08:30:00-03:00',
      fixtureProjectRoot,
    },
    now: new Date('2026-06-20T10:00:00-03:00'),
    isPidRunning: pid => pid === 123,
  });
  assert.equal(active.recover, false);
  assert.match(active.reason, /ativo/);

  const stale = canRecoverActivationLock({
    lock: {
      pid: 321,
      createdAt: '2026-06-20T08:00:00-03:00',
      fixtureProjectRoot,
    },
    now: new Date('2026-06-20T10:00:00-03:00'),
    maxAgeMinutes: 60,
    isPidRunning: () => false,
  });
  assert.equal(stale.recover, true);
});


test('watchdog usa o helper PM2 seguro e não chama pm2 diretamente', () => {
  const watchdog = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'whatsapp-reminder-watchdog.js'), 'utf8');
  assert.match(watchdog, /readPm2JsonUtf8/);
  assert.match(watchdog, /parseAndSanitizePm2Json/);
  assert.doesNotMatch(watchdog, /execFileAsync\(['"]pm2['"]/);
});


test('ativador delimita variável seguida de dois-pontos em strings PowerShell', () => {
  const activator = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  assert.doesNotMatch(activator, /\$ExpectedMode:/);
  assert.match(activator, /\$\{ExpectedMode\}:/);
});


test('ativador preserva exatamente uma quebra final no ecosystem sem criar linha em branco', () => {
  const activator = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  assert.doesNotMatch(activator, /Set-Content\s+-LiteralPath\s+\$ecosystem/);
  assert.match(activator, /TrimEnd\(\[char\[\]\]@\(\[char\]13, \[char\]10\)\) \+ "`n"/);
  assert.match(activator, /UTF8Encoding\]::new\(\$false\)/);
  assert.match(activator, /WriteAllText\(\$ecosystem, \$normalized, \$utf8WithoutBom\)/);
});


test('self-checks usam ledger em memória e não executam verificações operacionais', () => {
  const scheduler = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'whatsapp-reminder-scheduler.js'), 'utf8');
  const watchdog = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'whatsapp-reminder-watchdog.js'), 'utf8');

  assert.match(scheduler, /isSelfCheck \? createMemoryReminderLedger\(\) : new JsonReminderLedger\(\)/);
  assert.match(watchdog, /isSelfCheck \? createMemoryReminderLedger\(\) : new JsonReminderLedger\(\)/);

  const schedulerSelfCheck = scheduler.slice(
    scheduler.indexOf('if (isSelfCheck)'),
    scheduler.indexOf('recordStartupMissedRoutines();')
  );
  const watchdogSelfCheck = watchdog.slice(
    watchdog.indexOf('if (isSelfCheck)'),
    watchdog.indexOf("recordHeartbeat({ event: 'startup' });")
  );

  assert.match(schedulerSelfCheck, /ambiente isolado; ledger operacional preservado/);
  assert.match(watchdogSelfCheck, /ambiente isolado; PM2, ledger operacional e fila administrativa preservados/);
  assert.doesNotMatch(watchdogSelfCheck, /runWatchdogCheck\(/);
  assert.doesNotMatch(watchdogSelfCheck, /reconcileTechnicalAlerts\(/);
  assert.doesNotMatch(watchdogSelfCheck, /appendIncident\(/);
});

test('ativador lê propriedades opcionais sem acesso direto incompatível com modo estrito', () => {
  const activator = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  const runtimeEvidence = activator.slice(
    activator.indexOf('function Wait-LiveRuntimeEvidence'),
    activator.indexOf('function Save-PreActivationBackup')
  );

  assert.match(activator, /Set-StrictMode -Version Latest/);
  assert.match(activator, /function Get-OptionalObjectValue/);
  assert.match(activator, /function Convert-ToOptionalUtcDate/);
  assert.match(activator, /function Get-OptionalCollectionValues/);
  for (const property of ['process', 'mode', 'whatsappReady', 'qrBlocked', 'event', 'recordedAt', 'schedulerRegistered']) {
    assert.doesNotMatch(runtimeEvidence, new RegExp(`\\$_\\.${property}\\b`));
    assert.match(runtimeEvidence, new RegExp(`Get-OptionalObjectValue[^\\n]+-Name "${property}"`));
  }
  assert.match(runtimeEvidence, /-Name "event"\) -eq "ready"/);
  assert.match(runtimeEvidence, /-Name "qrBlocked"\) -ne \$true/);
  assert.match(runtimeEvidence, /Convert-ToOptionalUtcDate/);
});

test('ativador normaliza DateTime, DateTimeOffset e texto ISO sem conversão cultural frágil', () => {
  const activator = fs.readFileSync(path.join(runtimeProjectRoot, 'scripts', 'activate-whatsapp-robust-live.ps1'), 'utf8');
  const converter = activator.slice(
    activator.indexOf('function Convert-ToOptionalUtcDate'),
    activator.indexOf('function Get-OptionalCollectionValues')
  );
  const runtimeEvidence = activator.slice(
    activator.indexOf('function Wait-LiveRuntimeEvidence'),
    activator.indexOf('function Save-PreActivationBackup')
  );

  assert.match(converter, /\$Value -is \[DateTimeOffset\]/);
  assert.match(converter, /\$Value -is \[DateTime\]/);
  assert.match(converter, /CultureInfo\]::InvariantCulture/);
  assert.match(converter, /DateTimeStyles\]::RoundtripKind/);
  assert.match(converter, /CultureInfo\]::CurrentCulture/);
  assert.match(runtimeEvidence, /\$startedUtc = Convert-ToOptionalUtcDate -Value \$StartedAt/);
  assert.doesNotMatch(runtimeEvidence, /\$startedUtc = \$StartedAt\.ToUniversalTime\(\)/);
});
