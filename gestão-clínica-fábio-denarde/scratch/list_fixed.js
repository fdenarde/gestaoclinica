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

async function listAllPatients() {
    console.log("Listing all patients with fixed schedules...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    
    patientsSnapshot.forEach(doc => {
        const p = doc.data();
        if (p.status === 'Ativo' && p.fixedDay && p.fixedTime) {
            console.log(`- ${p.name} (Guardian: ${p.guardianName}): ${p.fixedDay} at ${p.fixedTime}`);
        }
    });
}

listAllPatients().then(() => process.exit(0));
