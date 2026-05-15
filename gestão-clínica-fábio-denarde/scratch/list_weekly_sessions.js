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

async function listSessions() {
    const userId = 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3';
    const dates = ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16'];
    
    for (const d of dates) {
        const snap = await db.collection(`users/${userId}/sessions`).where('date', '==', d).get();
        console.log(`Date ${d}: ${snap.size} sessions`);
        snap.forEach(doc => console.log(doc.data()));
    }
    process.exit(0);
}

listSessions();
