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
  
  console.log(`User ID: ${userId}`);
  
  // Query all patients
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  patientsSnapshot.forEach(doc => {
    patients.push({ id: doc.id, ...doc.data() });
  });
  
  console.log('\n=== PATIENTS ===');
  patients.forEach(p => {
    console.log(`ID: ${p.id} | Name: ${p.name} | Status: ${p.status}`);
  });
  
  // For each patient, query all sessions
  for (const patient of patients) {
    if (patient.name.includes('Celso') || patient.name.includes('Eliza')) {
      console.log(`\n=== Sessions for ${patient.name} ===`);
      const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
        .where('patientId', '==', patient.id)
        .get();
        
      const sessions = [];
      sessionsSnapshot.forEach(doc => {
        sessions.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort chronologically
      sessions.sort((a, b) => a.date.localeCompare(b.date));
      
      sessions.forEach(s => {
        console.log(`  Date: ${s.date} | Time: ${s.time} | PkgNum: ${s.packageNumber} | Status: ${s.status} | Notes: ${s.notes || ''}`);
      });
    }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
