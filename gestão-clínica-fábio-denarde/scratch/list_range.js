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

async function listSpecificRange() {
    const userId = 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3';
    console.log(`Listing sessions for user ${userId} between May 12 and May 15...`);
    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
        .where('date', '>=', '2026-05-12')
        .where('date', '<=', '2026-05-15')
        .get();
    
    for (const doc of sessionsSnapshot.docs) {
        const s = doc.data();
        const pDoc = await db.doc(`users/${userId}/patients/${s.patientId}`).get();
        const p = pDoc.exists ? pDoc.data() : { name: 'Unknown' };
        console.log(`- Date: ${s.date}, Time: ${s.time}, Patient: ${p.name}, Guardian: ${p.guardianName}, Status: ${s.status}, ID: ${doc.id}`);
    }
}

listSpecificRange().then(() => process.exit(0));
