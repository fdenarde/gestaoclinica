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
  const userId = settingsConfigSnapshot.docs[0].ref.parent.parent.id;
  
  // Find Isabelly ID
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  let isabellyId = null;
  let weslleyId = null;
  
  patientsSnapshot.forEach(p => {
    const data = p.data();
    if (data.name.toLowerCase().includes('isabelly')) {
      isabellyId = p.id;
      console.log(`Isabelly ID: ${isabellyId}`);
    }
    if (data.name.toLowerCase().includes('weslley')) {
      weslleyId = p.id;
      console.log(`Weslley ID: ${weslleyId}`);
    }
  });
  
  if (isabellyId) {
    console.log("\n=== SESSÕES DE ISABELLY ===");
    const sessions = await db.collection(`users/${userId}/sessions`)
      .where('patientId', '==', isabellyId)
      .get();
    sessions.forEach(s => {
      console.log(s.id, s.data());
    });
  }

  if (weslleyId) {
    console.log("\n=== SESSÕES DE WESLLEY ===");
    const sessions = await db.collection(`users/${userId}/sessions`)
      .where('patientId', '==', weslleyId)
      .get();
    sessions.forEach(s => {
      console.log(s.id, s.data());
    });
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
