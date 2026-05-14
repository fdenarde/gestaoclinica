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

async function searchByTime() {
    console.log("Searching for sessions at 09:00 or 12:30 near today...");
    const today = new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];

    const times = ['09:00', '12:30', '9:00', '09h', '12h30'];
    
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '>=', today)
        .where('date', '<=', tomorrow)
        .get();
    
    for (const doc of sessionsSnapshot.docs) {
        const s = doc.data();
        if (times.includes(s.time)) {
            const pDoc = await db.doc(doc.ref.parent.parent.path + '/patients/' + s.patientId).get();
            const p = pDoc.exists ? pDoc.data() : { name: 'Unknown' };
            console.log(`- Session: ${s.date} at ${s.time}, Patient: ${p.name}, Guardian: ${p.guardianName}, Status: ${s.status}`);
        } else {
             // log all for debug
             console.log(`- Debug Session: ${s.date} at ${s.time}, PatientId: ${s.patientId}`);
        }
    }
}

searchByTime().then(() => process.exit(0));
