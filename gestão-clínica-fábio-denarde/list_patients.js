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

async function listPatients() {
    const patientsSnapshot = await db.collectionGroup('patients').get();
    console.log(`Total pacientes: ${patientsSnapshot.size}`);
    patientsSnapshot.forEach(doc => {
        const p = doc.data();
        console.log(`- ${p.name} (${p.status}): Day=${p.fixedDay}, Time=${p.fixedTime}`);
    });
}

listPatients().then(() => process.exit(0));
