import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const serviceAccount = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function debug() {
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    const configDoc = settingsConfigSnapshot.docs[0];
    const userId = configDoc.ref.parent.parent.id;

    console.log("=== Saturday Debug ===");
    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
        .where('date', '==', '2026-06-06')
        .get();
    
    console.log(`Found ${sessionsSnapshot.size} manual sessions on 2026-06-06`);
    sessionsSnapshot.forEach(doc => {
        console.log(`Session: ${doc.id} | Patient: ${doc.data().patientId} | Time: ${doc.data().time} | Status: ${doc.data().status}`);
    });

    const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
    patientsSnapshot.forEach(doc => {
        const p = doc.data();
        if (p.name === 'Luiza' || p.name === 'Nicolas') {
            console.log(`Patient: ${p.name} | Status: ${p.status} | fixedDay: "${p.fixedDay}" | fixedTime: "${p.fixedTime}" | whatsapp: "${p.whatsapp}"`);
        }
    });
}

debug().then(() => process.exit(0));
