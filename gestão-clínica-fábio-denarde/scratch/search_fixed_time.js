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

async function searchByFixedTime() {
    console.log("Searching for patients with fixed time 09:00 or 12:30...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    
    for (const doc of patientsSnapshot.docs) {
        const p = doc.data();
        if (p.fixedTime === '09:00' || p.fixedTime === '12:30' || p.fixedTime === '09h' || p.fixedTime === '12h30') {
            console.log(`Found: ${p.name} (Guardian: ${p.guardianName}, ID: ${doc.id}, Status: ${p.status})`);
            console.log(`  Fixed: ${p.fixedDay} at ${p.fixedTime}`);
        }
    }
}

searchByFixedTime().then(() => process.exit(0));
