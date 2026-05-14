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

async function searchAliciaByTime() {
    const aliciaId = 'xyfijoha8';
    console.log(`Searching for sessions for Alicia (ID: ${aliciaId}) at 09:00 or 12:30...`);
    
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('patientId', '==', aliciaId)
        .get();
    
    sessionsSnapshot.forEach(doc => {
        const s = doc.data();
        if (s.time === '09:00' || s.time === '12:30' || s.time === '09h' || s.time === '12h30') {
            console.log(`Match: Date ${s.date}, Time ${s.time}, Status ${s.status}`);
        }
    });
}

searchAliciaByTime().then(() => process.exit(0));
