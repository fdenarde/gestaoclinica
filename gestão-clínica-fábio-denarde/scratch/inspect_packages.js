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
  
  // Query all packages
  const packagesSnapshot = await db.collection(`users/${userId}/packages`).get();
  const packages = [];
  packagesSnapshot.forEach(doc => {
    packages.push({ id: doc.id, ...doc.data() });
  });
  
  console.log('\n=== PACKAGES IN FIRESTORE ===');
  packages.sort((a,b) => a.patientId.localeCompare(b.patientId) || a.number - b.number);
  packages.forEach(p => {
    console.log(`PatientID: ${p.patientId} | Number: ${p.number} | Start: ${p.startDate} | End: ${p.endDate} | Status: ${p.status}`);
  });
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
