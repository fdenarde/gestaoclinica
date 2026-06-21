import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ecosystem from '../ecosystem.config.cjs';

const root = process.cwd();
const files = {
  sender: path.join(root, 'server.js'),
  scheduler: path.join(root, 'scripts', 'whatsapp-reminder-scheduler.js'),
  watchdog: path.join(root, 'scripts', 'whatsapp-reminder-watchdog.js'),
  operations: path.join(root, 'src', 'lib', 'whatsappReminderOperations.js'),
  adminMonitor: path.join(root, 'src', 'lib', 'whatsappAdminMonitor.js'),
  phone: path.join(root, 'src', 'lib', 'whatsappPhone.js'),
  pm2Helper: path.join(root, 'scripts', 'read-pm2-whatsapp-state.js'),
  activator: path.join(root, 'scripts', 'activate-whatsapp-robust-live.ps1'),
};

for (const [name, file] of Object.entries(files)) {
  assert.ok(fs.existsSync(file), `${name} ausente: ${file}`);
}

const senderSource = fs.readFileSync(files.sender, 'utf8');
const schedulerSource = fs.readFileSync(files.scheduler, 'utf8');
const watchdogSource = fs.readFileSync(files.watchdog, 'utf8');
const operationsSource = fs.readFileSync(files.operations, 'utf8');
const adminMonitorSource = fs.readFileSync(files.adminMonitor, 'utf8');
const pm2HelperSource = fs.readFileSync(files.pm2Helper, 'utf8');
const activatorSource = fs.readFileSync(files.activator, 'utf8');

assert.match(senderSource, /whatsapp-web\.js/, 'server.js deve ser o único remetente WhatsApp.');
assert.match(senderSource, /client\.initialize\(\)/, 'server.js deve ser o único ponto de inicialização WhatsApp.');
assert.doesNotMatch(schedulerSource, /whatsapp-web\.js|sendMessage|Client\(|LocalAuth/, 'Scheduler não pode inicializar ou enviar WhatsApp.');
assert.doesNotMatch(watchdogSource, /whatsapp-web\.js|sendMessage|Client\(|LocalAuth/, 'Watchdog não pode inicializar ou enviar WhatsApp.');
assert.doesNotMatch(schedulerSource, /client\.initialize\(\)/, 'Scheduler não pode inicializar cliente WhatsApp.');
assert.doesNotMatch(watchdogSource, /client\.initialize\(\)/, 'Watchdog não pode inicializar cliente WhatsApp.');
assert.match(operationsSource, /fs\.renameSync/, 'Ledger precisa de escrita atômica por rename.');
assert.match(operationsSource, /withExclusiveLock/, 'Ledger precisa de lock exclusivo.');
assert.match(operationsSource, /claimNextQueuedRoutine/, 'Fila de rotina precisa de claim atômico.');
assert.match(operationsSource, /WHATSAPP_SENDER_MODE/, 'Modo do sender precisa ser separado.');
assert.match(operationsSource, /WHATSAPP_SCHEDULER_MODE/, 'Modo do scheduler precisa ser separado.');
assert.match(operationsSource, /WHATSAPP_WATCHDOG_MODE/, 'Modo do watchdog precisa ser separado.');
assert.match(adminMonitorSource, /WHATSAPP_ADMIN_REPORT_PHONE/, 'Telefone administrativo precisa vir da variável central.');
assert.doesNotMatch(adminMonitorSource, /98114|0948|WHATSAPP_ADMIN_MONITOR_PHONE/, 'Número administrativo antigo não pode ficar ativo no monitor.');
assert.match(pm2HelperSource, /JSON\.parse/, 'Helper PM2 precisa interpretar JSON com Node.');
assert.match(pm2HelperSource, /WHATSAPP_ADMIN_REPORT_PHONE_MASKED/, 'Helper PM2 deve mascarar telefone administrativo.');
assert.match(pm2HelperSource, /toString\('base64'\)/, 'Helper PM2 deve oferecer transporte Base64 ASCII.');
assert.match(pm2HelperSource, /TextDecoder\('utf-8'/, 'Helper PM2 deve decodificar a saída nativa como UTF-8 estrito.');
assert.match(pm2HelperSource, /chcp 65001/, 'Fallback do shim Windows deve fixar a página de códigos em UTF-8.');
assert.doesNotMatch(pm2HelperSource, /ConvertFrom-Json/, 'Helper PM2 não deve depender de parser PowerShell.');
assert.match(activatorSource, /\$PSScriptRoot/, 'Ativador deve resolver ProjectRoot via PSScriptRoot.');
assert.match(activatorSource, /read-pm2-whatsapp-state\.js/, 'Ativador deve consumir helper PM2 sanitizado.');
assert.match(activatorSource, /--from-pm2 --base64/, 'Ativador deve receber o estado PM2 por Base64 ASCII.');
assert.match(activatorSource, /FromBase64String/, 'Ativador deve decodificar Base64 explicitamente.');
assert.match(activatorSource, /StringComparer\]::OrdinalIgnoreCase/, 'Ativador deve comparar caminhos com OrdinalIgnoreCase.');
assert.doesNotMatch(activatorSource, /pm2 jlist[\s\S]{0,120}ConvertFrom-Json/, 'Ativador não pode converter JSON bruto do PM2 com PowerShell.');
assert.doesNotMatch(activatorSource, /D:\\Projeto|GestÃ|ClÃ|RepositÃ|ativaÃ|execuÃ|nÃ|robÃ|reversÃ|prÃ/, 'Ativador não pode conter caminho absoluto/corrupção de codificação.');
assert.match(activatorSource, /\$ValidateOnly/, 'Ativador deve expor -ValidateOnly.');

assert.match(watchdogSource, /readPm2JsonUtf8/, 'Watchdog deve reutilizar a leitura PM2 UTF-8 segura.');
assert.match(watchdogSource, /parseAndSanitizePm2Json/, 'Watchdog deve consumir estado PM2 sanitizado.');
assert.doesNotMatch(watchdogSource, /execFileAsync\(['"]pm2['"]/, 'Watchdog não pode executar pm2 diretamente no Windows.');
assert.match(activatorSource, /pm2" @\("start", "\.\\ecosystem\.config\.cjs", "--only", "RoboClinica"/, 'Ativador deve recarregar o sender a partir do ecosystem para aplicar o modo live.');
assert.match(activatorSource, /Wait-Pm2OperationalModes/, 'Ativador deve confirmar os modos reais antes do pm2 save.');
assert.match(activatorSource, /Wait-LiveRuntimeEvidence/, 'Ativador deve confirmar sender ready e watchdog antes do pm2 save.');


const apps = ecosystem.apps || [];
for (const appName of ['RoboClinica', 'RoboClinicaScheduler', 'RoboClinicaWatchdog']) {
  assert.ok(apps.some(app => app.name === appName), `App PM2 ausente: ${appName}`);
}

const senderApps = apps.filter(app => fs.readFileSync(app.script, 'utf8').includes('whatsapp-web.js'));
assert.deepEqual(senderApps.map(app => app.name), ['RoboClinica'], 'Somente RoboClinica pode importar whatsapp-web.js.');

const sender = apps.find(app => app.name === 'RoboClinica');
const scheduler = apps.find(app => app.name === 'RoboClinicaScheduler');
const watchdog = apps.find(app => app.name === 'RoboClinicaWatchdog');
assert.equal(sender.env.WHATSAPP_PROCESS_ROLE, 'sender');
assert.equal(scheduler.env.WHATSAPP_PROCESS_ROLE, 'scheduler');
assert.equal(watchdog.env.WHATSAPP_PROCESS_ROLE, 'watchdog');
assert.ok('WHATSAPP_SENDER_MODE' in sender.env, 'Sender precisa de WHATSAPP_SENDER_MODE.');
assert.ok('WHATSAPP_SCHEDULER_MODE' in scheduler.env, 'Scheduler precisa de WHATSAPP_SCHEDULER_MODE.');
assert.ok('WHATSAPP_WATCHDOG_MODE' in watchdog.env, 'Watchdog precisa de WHATSAPP_WATCHDOG_MODE.');
assert.equal(sender.env.WHATSAPP_SENDER_MODE, 'disabled', 'Sender deve iniciar disabled por padrão; live exige ativação explícita.');
assert.equal(scheduler.env.WHATSAPP_SCHEDULER_MODE, 'disabled', 'Scheduler deve iniciar disabled por padrão; live exige ativação explícita.');
assert.equal(watchdog.env.WHATSAPP_WATCHDOG_MODE, 'disabled', 'Watchdog deve iniciar disabled por padrão; live exige ativação explícita.');
assert.ok(!('WHATSAPP_REMINDER_MODE' in sender.env), 'Sender não deve depender do modo global.');
assert.equal(sender.env.WHATSAPP_ADMIN_REPORT_PHONE, '27999072659', 'Sender precisa carregar o telefone administrativo autorizado.');
assert.ok(!('WHATSAPP_ADMIN_REPORT_PHONE' in scheduler.env), 'Scheduler não deve receber o telefone administrativo completo.');
assert.ok(!('WHATSAPP_ADMIN_REPORT_PHONE' in watchdog.env), 'Watchdog não deve receber o telefone administrativo completo.');

console.log('Arquitetura WhatsApp validada: remetente, scheduler e watchdog separados.');
