import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { getFirestore } from 'firebase-admin/firestore';
import { formatLocalDateStr, getWhatsappReminderPlan } from './whatsappReminderPlan.js';
import { loadWhatsappReminderSuppressions } from './whatsappReminderSuppressionStore.js';

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
  const date = new Date(runDate);
  if (tipo === 'AMANHA') date.setDate(date.getDate() + 1);
  return formatLocalDateStr(date);
}

export async function buildReminderPlanContexts({
  db = initializeFirebaseAdmin(),
  tipo,
  now = new Date(),
  suppressions = loadWhatsappReminderSuppressions(),
} = {}) {
  const contexts = [];
  const runDateStr = formatLocalDateStr(now);
  const targetDateStr = getTargetDateForRoutine({ runDate: now, tipo });
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();

  for (const configDoc of settingsConfigSnapshot.docs) {
    const userId = configDoc.ref.parent.parent.id;
    const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};

    const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
    const patients = patientsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('date', '==', targetDateStr)
      .get();
    const sessions = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const plan = getWhatsappReminderPlan({
      runDateStr,
      tipo,
      patients,
      sessions,
      settings,
      suppressions,
    });

    contexts.push({ userId, settings, plan, runDateStr, targetDateStr });
  }

  return contexts;
}
