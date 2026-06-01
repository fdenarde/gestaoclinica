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
  
  // 1. Get Patients
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  const patientsMap = {};
  patientsSnapshot.forEach(p => {
    const data = { id: p.id, ...p.data() };
    patients.push(data);
    patientsMap[p.id] = data;
  });

  console.log('\n=== ALL PATIENTS CURRENT CONFIG ===');
  patients.forEach(p => {
    console.log(`ID: ${p.id} | Name: ${p.name} | Status: ${p.status} | Phone: ${p.whatsapp} | FixedDay: ${p.fixedDay} | FixedTime: ${p.fixedTime} | Double: ${p.doubleSession}`);
  });

  // 2. Get sessions for Wednesday 03/06/2026
  const targetDate = '2026-06-03';
  console.log(`\n=== SESSIONS IN DB FOR ${targetDate} ===`);
  const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
    .where('date', '==', targetDate)
    .get();

  const dbSessions = [];
  sessionsSnapshot.forEach(doc => {
    dbSessions.push({ id: doc.id, ...doc.data() });
  });

  dbSessions.sort((a, b) => a.time.localeCompare(b.time));
  dbSessions.forEach(s => {
    const p = patientsMap[s.patientId];
    console.log(`ID: ${s.id} | Patient: ${p ? p.name : 'Unknown ('+s.patientId+')'} | Time: ${s.time} | Pkg: ${s.packageNumber} | Status: ${s.status} | Notes: ${s.notes || ''}`);
  });
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
