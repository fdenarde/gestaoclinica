import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function debugSummary() {
    const weekStart = '2026-05-11';
    const weekEnd = '2026-05-16';

    console.log("Fetching all patients...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    const patientsMap = {};
    patientsSnapshot.forEach(doc => {
        patientsMap[doc.id] = { id: doc.id, ...doc.data() };
    });

    console.log("Fetching sessions for the week...");
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '>=', weekStart)
        .where('date', '<=', weekEnd)
        .get();

    console.log(`Found ${sessionsSnapshot.size} sessions in range.`);
    sessionsSnapshot.forEach(doc => {
        const s = doc.data();
        const p = patientsMap[s.patientId];
        console.log(`- Date: ${s.date}, Time: ${s.time}, Patient: ${p ? p.name : 'UNKNOWN (' + s.patientId + ')'}, Status: ${s.status}`);
    });
}

debugSummary().then(() => process.exit(0));
