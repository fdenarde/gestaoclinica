import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();
  const configDoc = settingsConfigSnapshot.docs[0];
  const userId = configDoc.ref.parent.parent.id;
  
  console.log(`\n=== Inspeção de Sessões do Celso ===`);
  
  const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('patientId', '==', 'wg9ojb9el')
      .get();
      
  sessionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.date >= '2026-07-01' && data.date <= '2026-08-31') {
          console.log(`Sessão ID: ${doc.id} | Data: ${data.date} | Hora: ${data.time} | PackageNumber: ${data.packageNumber} | Status: ${data.status}`);
      }
  });
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
