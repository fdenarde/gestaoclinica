import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function listAllPatients() {
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        patientsSnapshot.forEach(doc => {
            const p = doc.data();
            console.log(`Patient: ${p.name}, Guardian: ${p.guardianName}, FixedDay: ${p.fixedDay}, FixedTime: ${p.fixedTime}, Status: ${p.status}`);
        });
    }
    process.exit(0);
}

listAllPatients();
