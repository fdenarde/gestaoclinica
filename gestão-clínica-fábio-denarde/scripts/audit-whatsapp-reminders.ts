import fs from 'node:fs';
import path from 'node:path';
import { getWhatsappReminderPlan as getTypedWhatsappReminderPlan } from '../src/lib/utils';
import { getWhatsappReminderPlan as getSharedWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import type { ClinicSettings, Patient, Session } from '../src/types';

type BackupDoc<T = Record<string, unknown>> = {
  id: string;
  path: string;
  parentPath: string;
  data: T;
};

type BackupFile = {
  metadata?: {
    generatedAt?: string;
    documentCount?: number;
  };
  collections: {
    settings?: BackupDoc<ClinicSettings>[];
    patients?: BackupDoc<Patient>[];
    sessions?: BackupDoc<Session>[];
  };
};

type ReminderType = 'HOJE_MANHA' | 'AMANHA' | 'HOJE_TARDE';

const args = new Set(process.argv.slice(2));
const getArgValue = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};

const showSensitive = args.has('--show-sensitive') && process.env.ALLOW_SENSITIVE_AUDIT_OUTPUT === 'SIM';
const runDateStr = getArgValue('--date') ?? new Date().toISOString().slice(0, 10);
const backupArg = getArgValue('--backup');
const backupDir = path.resolve('backups');

function findLatestBackup(): string {
  const files = fs
    .readdirSync(backupDir)
    .filter(file => file.startsWith('firestore-collection-groups-backup-') && file.endsWith('.json'))
    .map(file => ({
      file,
      mtimeMs: fs.statSync(path.join(backupDir, file)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error(`Nenhum backup collectionGroup encontrado em ${backupDir}.`);
  }

  return path.join(backupDir, files[0].file);
}

function maskName(value: string | undefined): string {
  if (!value?.trim()) return '(sem nome)';
  const trimmed = value.trim();
  if (showSensitive) return trimmed;
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '';
  return `${first[0]}***${initial}`;
}

function maskPhone(value: string | undefined): string {
  if (!value?.trim()) return '(sem WhatsApp)';
  if (showSensitive) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

function groupByUser<T>(docs: BackupDoc<T>[] = []): Map<string, BackupDoc<T>[]> {
  const grouped = new Map<string, BackupDoc<T>[]>();
  for (const doc of docs) {
    const match = doc.parentPath.match(/^users\/([^/]+)/);
    const userId = match?.[1] ?? '(usuario-desconhecido)';
    grouped.set(userId, [...(grouped.get(userId) ?? []), doc]);
  }
  return grouped;
}

function totalDiagnosticsByReason(diagnostics: { blockedReason: string }[]): Record<string, number> {
  return diagnostics.reduce<Record<string, number>>((acc, item) => {
    acc[item.blockedReason] = (acc[item.blockedReason] ?? 0) + 1;
    return acc;
  }, {});
}

const backupPath = path.resolve(backupArg ?? findLatestBackup());
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as BackupFile;

const settingsByUser = groupByUser(backup.collections.settings);
const patientsByUser = groupByUser(backup.collections.patients);
const sessionsByUser = groupByUser(backup.collections.sessions);
const userIds = new Set([...settingsByUser.keys(), ...patientsByUser.keys(), ...sessionsByUser.keys()]);
const tipos: ReminderType[] = ['HOJE_MANHA', 'AMANHA', 'HOJE_TARDE'];

console.log('AUDITORIA OFFLINE DE WHATSAPP');
console.log(`Backup: ${backupPath}`);
console.log(`Backup gerado em: ${backup.metadata?.generatedAt ?? '(sem metadata)'}`);
console.log(`Data-base da auditoria: ${runDateStr}`);
console.log(`Saida sensivel: ${showSensitive ? 'SIM' : 'NAO (mascarada)'}`);
console.log('');

for (const userId of userIds) {
  const settings = settingsByUser.get(userId)?.[0]?.data ?? ({} as ClinicSettings);
  const patients = (patientsByUser.get(userId) ?? []).map(doc => ({ ...doc.data, id: doc.id }));
  const sessions = (sessionsByUser.get(userId) ?? []).map(doc => ({ ...doc.data, id: doc.id }));

  console.log(`Usuario: ${userId}`);
  console.log(`Pacientes no backup: ${patients.length}`);
  console.log(`Sessoes no backup: ${sessions.length}`);

  for (const tipo of tipos) {
    const planInput = {
      runDateStr,
      tipo,
      patients,
      sessions,
      settings
    };
    const plan = getSharedWhatsappReminderPlan(planInput);
    const typedPlan = getTypedWhatsappReminderPlan(planInput);
    if (JSON.stringify(plan) !== JSON.stringify(typedPlan)) {
      throw new Error(`Divergencia entre modulo compartilhado e frontend para ${tipo} em ${runDateStr}.`);
    }

    console.log('');
    console.log(`- Rotina ${tipo} -> data alvo ${plan.dateStr}`);
    if (plan.isHoliday) {
      console.log(`  BLOQUEADA POR FERIADO/RECESSO: ${plan.holidayName}`);
      continue;
    }

    console.log(`  Mensagens que seriam enviadas: ${plan.reminders.length}`);
    for (const reminder of plan.reminders) {
      const firstLine = reminder.message.split('\n')[0];
      console.log(
        `  * ${reminder.time} | paciente ${maskName(reminder.patientName)} | responsavel ${maskName(reminder.guardianName)} | WhatsApp ${maskPhone(reminder.whatsapp)} | ${firstLine}`
      );
    }

    const diagnostics = totalDiagnosticsByReason(plan.diagnostics);
    const diagnosticEntries = Object.entries(diagnostics);
    if (diagnosticEntries.length > 0) {
      console.log('  Bloqueios/diagnosticos:');
      for (const [reason, count] of diagnosticEntries) {
        console.log(`  * ${reason}: ${count}`);
      }
    }
  }

  console.log('');
}

console.log('Esta auditoria nao envia mensagens, nao inicializa WhatsApp e nao acessa Firebase ao vivo.');
