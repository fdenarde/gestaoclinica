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

async function listAllFriday() {
    const fridayDate = new Date();
    fridayDate.setDate(fridayDate.getDate() + 2);
    const friday = fridayDate.toISOString().split('T')[0];

    console.log(`Listing ALL sessions for ${friday}...`);
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '==', friday)
        .get();
    
    for (const doc of sessionsSnapshot.docs) {
        const s = doc.data();
        const pDoc = await db.doc(doc.ref.parent.parent.path + '/patients/' + s.patientId).get();
        const p = pDoc.exists ? pDoc.data() : { name: 'Unknown' };
        console.log(`- Patient: ${p.name}, Guardian: ${p.guardianName}, Time: ${s.time}, Status: ${s.status}`);
    }
}

listAllFriday().then(() => process.exit(0));
