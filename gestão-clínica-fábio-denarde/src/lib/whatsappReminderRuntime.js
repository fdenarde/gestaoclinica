import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { getFirestore } from 'firebase-admin/firestore';
import { formatLocalDateStr, getWhatsappReminderPlan } from './whatsappReminderPlan.js';
import { loadWhatsappReminderSuppressions } from './whatsappReminderSuppressionStore.js';
import { emitFirestoreMetric } from '../../api/_lib/firestoreDiagnostics.js';
import { getSaoPauloDateKey } from '../../shared/clinicalDate.js';

export const FIRESTORE_DATABASE_ID = 'ai-studio-587970e5-0653-44a5-93a3-be1a74301eda';

export function initializeFirebaseAdmin({
  serviceAccountPath = path.resolve('./firebase-key.json'),
  databaseId = FIRESTORE_DATABASE_ID,
} = {}) {
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Arquivo firebase-key.json não encontrado em ${serviceAccountPath}.`);
  }

  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return getFirestore(databaseId);
}

export function getTargetDateForRoutine({ runDate = new Date(), tipo }) {
  const date = new Date(`${getSaoPauloDateKey(runDate)}T12:00:00Z`);
  if (tipo === 'AMANHA') date.setUTCDate(date.getUTCDate() + 1);
  return getSaoPauloDateKey(date);
}

function normalizeInvocationReason(value) {
  return ['routine', 'admin-preview', 'recovery'].includes(value) ? value : 'unknown';
}

function countPlanReminders(plan) {
  if (Array.isArray(plan)) return plan.length;
  if (!plan || typeof plan !== 'object') return 0;
  for (const key of ['reminders', 'messages', 'items']) {
    if (Array.isArray(plan[key])) return plan[key].length;
  }
  return 0;
}

export async function buildReminderPlanContexts({
  db = initializeFirebaseAdmin(),
  tipo,
  scheduledTime = '',
  customOnly = false,
  routineDateStr = '',
  accountIds = [],
  now = new Date(),
  suppressions = loadWhatsappReminderSuppressions(),
  invocationReason = 'unknown',
} = {}) {
  const contexts = [];
  const runDateStr = routineDateStr || formatLocalDateStr(now);
  const targetDateStr = routineDateStr
    ? (() => { const date = new Date(`${runDateStr}T12:00:00Z`); if (tipo === 'AMANHA') date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); })()
    : getTargetDateForRoutine({ runDate: now, tipo });
  const safeInvocationReason = normalizeInvocationReason(invocationReason);
  const safeRoutine = ['HOJE_MANHA', 'AMANHA', 'HOJE_TARDE'].includes(tipo) ? tipo : 'unknown';
  const startedAt = Date.now();
  let configSnapshotCount = 0;
  let patientsRead = 0;
  let sessionsRead = 0;
  let reminders = 0;
  let status = 'error';
  emitFirestoreMetric({
    source: 'whatsapp-runtime',
    operation: 'buildReminderPlanContexts',
    event: 'start',
    routine: safeRoutine,
    invocationReason: safeInvocationReason,
  });

  try {
    const safeAccountIds = customOnly && Array.isArray(accountIds)
      ? [...new Set(accountIds.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))]
      : [];
    const settingsDocs = customOnly
      ? await Promise.all(safeAccountIds.map(id => db.doc(`users/${id}/settings/config`).get()))
      : (await db.collectionGroup('settings').get()).docs;
    configSnapshotCount = settingsDocs.length;

    for (const configDoc of settingsDocs) {
      const userId = configDoc.ref.parent.parent.id;
      const settingsSnapshot = configDoc.id === 'config'
        ? configDoc
        : await db.doc(`users/${userId}/settings/config`).get();
      const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};

      const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
      const patients = patientsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      patientsRead += patients.length;

      const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
        .where('date', '==', targetDateStr)
        .get();
      const sessions = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sessionsRead += sessions.length;

      const plan = getWhatsappReminderPlan({
        runDateStr,
        tipo,
        scheduledTime,
        customOnly,
        patients,
        sessions,
        settings,
        suppressions,
        now,
      });
      reminders += countPlanReminders(plan);

      contexts.push({ userId, settings, plan, runDateStr, targetDateStr });
    }

    status = 'success';
    return contexts;
  } finally {
    emitFirestoreMetric({
      source: 'whatsapp-runtime',
      operation: 'buildReminderPlanContexts',
      event: 'finish',
      routine: safeRoutine,
      invocationReason: safeInvocationReason,
      configSnapshots: configSnapshotCount,
      accounts: contexts.length,
      patientsRead,
      sessionsRead,
      reminders,
      durationMs: Date.now() - startedAt,
      status,
    });
  }
}
