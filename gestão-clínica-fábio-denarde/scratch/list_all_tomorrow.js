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

async function listAllTomorrow() {
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];

    console.log(`Listing ALL sessions for ${tomorrow}...`);
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '==', tomorrow)
        .get();
    
    for (const doc of sessionsSnapshot.docs) {
        const s = doc.data();
        const pDoc = await db.doc(doc.ref.parent.parent.path + '/patients/' + s.patientId).get();
        const p = pDoc.exists ? pDoc.data() : { name: 'Unknown' };
        console.log(`- Patient: ${p.name}, Guardian: ${p.guardianName}, Time: ${s.time}, Status: ${s.status}, Path: ${doc.ref.path}`);
    }
}

listAllTomorrow().then(() => process.exit(0));
