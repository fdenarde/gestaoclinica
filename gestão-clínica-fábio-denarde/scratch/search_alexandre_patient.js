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

async function searchAlexandrePatient() {
    console.log("Searching for patient named Alexandre...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    
    for (const doc of patientsSnapshot.docs) {
        const p = doc.data();
        if (p.name && p.name.toLowerCase().includes('alexandre')) {
            console.log(`Found Patient: ${p.name}, Guardian: ${p.guardianName}, ID: ${doc.id}`);
            const today = new Date().toISOString().split('T')[0];
            const sessions = await db.collection(doc.ref.parent.parent.path + '/sessions')
                .where('patientId', '==', doc.id)
                .get();
            sessions.forEach(s => console.log(`  - Session: ${s.data().date} at ${s.data().time}, Status: ${s.data().status}`));
        }
    }
}

searchAlexandrePatient().then(() => process.exit(0));
