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

async function peek() {
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        console.log('User ID:', userId);
        
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).limit(2).get();
        patientsSnapshot.forEach(doc => console.log('Patient:', doc.id, doc.data()));
        
        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`).limit(2).get();
        sessionsSnapshot.forEach(doc => console.log('Session:', doc.id, doc.data()));
        
        const configSnapshot = await db.doc(`users/${userId}/settings/config`).get();
        console.log('Config:', configSnapshot.data());
    }
    process.exit(0);
}

peek();
