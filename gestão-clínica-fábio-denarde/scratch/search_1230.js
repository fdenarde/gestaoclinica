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

async function search1230() {
    console.log("Searching for sessions at 12:30 or patients with that fixed time...");
    const sessions = await db.collectionGroup('sessions').where('time', '==', '12:30').get();
    sessions.forEach(s => console.log(`Session: ${s.data().date} for patient ${s.data().patientId}`));

    const patients = await db.collectionGroup('patients').where('fixedTime', '==', '12:30').get();
    patients.forEach(p => console.log(`Patient: ${p.data().name}, Guardian: ${p.data().guardianName}`));
}

search1230().then(() => process.exit(0));
