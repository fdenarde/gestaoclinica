import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const userId = 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3';
  
  // 1. Fetch config/settings (holidays, etc.)
  const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
  console.log("=== CLINIC CONFIGURATION ===");
  if (settingsSnapshot.exists) {
    console.log(JSON.stringify(settingsSnapshot.data(), null, 2));
  } else {
    console.log("No config found for user.");
  }
  
  // 2. Fetch all active patients
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  patientsSnapshot.forEach(doc => {
    patients.push({ id: doc.id, ...doc.data() });
  });

  const isabellyList = patients.filter(p => p.name && p.name.toLowerCase().includes('isabelly'));
  const weslleyList = patients.filter(p => p.name && p.name.toLowerCase().includes('weslley'));

  console.log("\n=== ISABELLY PATIENT DATA ===");
  console.log(JSON.stringify(isabellyList, null, 2));

  console.log("\n=== WESLLEY PATIENT DATA ===");
  console.log(JSON.stringify(weslleyList, null, 2));

  // 3. Fetch manual sessions for tomorrow (2026-05-28)
  const tomorrow = '2026-05-28';
  const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
    .where('date', '==', tomorrow)
    .get();

  const sessions = [];
  sessionsSnapshot.forEach(doc => {
    sessions.push({ id: doc.id, ...doc.data() });
  });

  console.log(`\n=== MANUAL SESSIONS FOR ${tomorrow} ===`);
  console.log(JSON.stringify(sessions, null, 2));
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
