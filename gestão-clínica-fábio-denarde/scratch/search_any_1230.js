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

async function searchAny1230() {
    console.log("Searching for ANY session at 12:30...");
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .get();
    
    for (const doc of sessionsSnapshot.docs) {
        const s = doc.data();
        if (s.time && (s.time.includes('12:30') || s.time.includes('12h30'))) {
            const pDoc = await db.doc(doc.ref.parent.parent.path + '/patients/' + s.patientId).get();
            const p = pDoc.exists ? pDoc.data() : { name: 'Unknown' };
            console.log(`- Date: ${s.date}, Time: ${s.time}, Patient: ${p.name}, Guardian: ${p.guardianName}, Status: ${s.status}`);
        }
    }
}

searchAny1230().then(() => process.exit(0));
