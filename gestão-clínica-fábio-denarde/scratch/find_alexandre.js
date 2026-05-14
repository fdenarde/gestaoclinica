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

async function findByGuardian() {
    console.log("Searching for patients with guardian Alexandre...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    
    for (const doc of patientsSnapshot.docs) {
        const p = doc.data();
        if (p.guardianName && p.guardianName.toLowerCase().includes('alexandre')) {
            console.log(`Found: ${p.name} (Guardian: ${p.guardianName}, ID: ${doc.id})`);
            const sessions = await db.collection(doc.ref.parent.parent.path + '/sessions')
                .where('patientId', '==', doc.id)
                .where('date', '>=', '2026-05-13')
                .limit(5)
                .get();
            sessions.forEach(s => {
                console.log(`  - Session: ${s.data().date} at ${s.data().time}, Status: ${s.data().status}`);
            });
        }
    }
}

findByGuardian().then(() => process.exit(0));
