import fs from 'fs';
import path from 'path';
import { getCompletedSessions, getSessionCycleNumber } from '../src/lib/sessionSequence';

type BackupDoc = {
  path: string;
  id: string;
  data: Record<string, any>;
};

type BackupFile = {
  metadata?: { generatedAt?: string };
  collections: Record<string, BackupDoc[]>;
};

function getArgValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findLatestBackup() {
  const backupDir = path.resolve('backups');
  const files = fs
    .readdirSync(backupDir)
    .filter(file => file.startsWith('firestore-collection-groups-backup-') && file.endsWith('.json'))
    .map(file => ({ file, mtimeMs: fs.statSync(path.join(backupDir, file)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files[0]) throw new Error(`Nenhum backup collectionGroup encontrado em ${backupDir}.`);
  return path.join(backupDir, files[0].file);
}

const backupPath = path.resolve(getArgValue('--backup') ?? findLatestBackup());
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as BackupFile;

const patients: Array<Record<string, any> & { id: string; path: string }> = (backup.collections.patients || [])
  .map(doc => ({ id: doc.id, path: doc.path, ...doc.data }));
const sessions: Array<Record<string, any> & { id: string; path: string }> = (backup.collections.sessions || [])
  .map(doc => ({ id: doc.id, path: doc.path, ...doc.data }));

const rows = patients
  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  .map(patient => {
    const completed = getCompletedSessions(sessions as any, patient.id);
    const inconsistencies = completed
      .map(session => ({
        id: session.id,
        date: session.date,
        time: session.time,
        status: session.status,
        stored: Number((session as any).packageNumber || 0),
        correct: getSessionCycleNumber(sessions as any, session as any)
      }))
      .filter(item => item.stored !== item.correct);

    return {
      patientName: patient.name || '(sem nome)',
      completedCount: completed.length,
      foundCount: completed.length,
      lastStored: Number((completed.at(-1) as any)?.packageNumber || 0),
      lastCorrect: completed.length > 0 ? getSessionCycleNumber(sessions as any, completed.at(-1) as any) : 0,
      status: inconsistencies.length > 0 ? 'INCONSISTENTE' : 'OK',
      inconsistencies
    };
  });

console.log('AUDITORIA DE SINCRONISMO DE SESSOES');
console.log(`Backup: ${backupPath}`);
console.log(`Gerado em: ${backup.metadata?.generatedAt ?? '(sem metadata)'}`);
console.log('');

for (const row of rows) {
  console.log(`Paciente: ${row.patientName}`);
  console.log(`Sessoes realizadas registradas: ${row.completedCount}`);
  console.log(`Sessoes efetivamente encontradas: ${row.foundCount}`);
  console.log(`Ultima sessao registrada: ${row.lastStored}`);
  console.log(`Ultima sessao correta: ${row.lastCorrect}`);
  console.log(`Status: ${row.status}`);
  if (row.inconsistencies.length > 0) {
    console.log('Divergencias:');
    for (const item of row.inconsistencies) {
      console.log(`- ${item.date} ${item.time} (${item.status}): gravado=${item.stored}, correto=${item.correct}, id=${item.id}`);
    }
  }
  console.log('');
}

const affected = rows.filter(row => row.status === 'INCONSISTENTE');
console.log(`Resumo: ${affected.length}/${rows.length} paciente(s) com divergencia.`);
