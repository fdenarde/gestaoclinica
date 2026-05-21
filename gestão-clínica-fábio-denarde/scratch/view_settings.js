import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();
  for (const configDoc of settingsConfigSnapshot.docs) {
      const userId = configDoc.ref.parent.parent.id;
      const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
      if (settingsSnapshot.exists) {
          console.log(`Config:`, JSON.stringify(settingsSnapshot.data(), null, 2));
      } else {
          console.log(`No config found for user ${userId}`);
      }
  }
}
run().then(() => process.exit(0)).catch(console.error);
