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
      
      const sessionsSnapshot = await db.collection(`users/${userId}/sessions`).get();
      for(const s of sessionsSnapshot.docs) {
          const data = s.data();
          if (data.patientId === 'wg9ojb9el' && data.date === '2026-05-19' && data.time === '08:00') {
             await db.collection(`users/${userId}/sessions`).doc(s.id).delete();
             console.log('Sessão errada do Celso (19/05 às 08h) apagada com sucesso!');
          }
      }
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
