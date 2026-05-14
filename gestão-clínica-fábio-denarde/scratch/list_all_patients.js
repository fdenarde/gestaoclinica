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

async function listAllPatientsOfUser() {
    const userId = 'cFn4wYT7FhO4WUbyoTQL7AUrMlF3';
    console.log(`Listing all patients for user ${userId}...`);
    const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
    
    for (const doc of patientsSnapshot.docs) {
        const p = doc.data();
        console.log(`- ${p.name} (Guardian: ${p.guardianName}, ID: ${doc.id}, Status: ${p.status})`);
        console.log(`  Fixed: ${p.fixedDay} at ${p.fixedTime}`);
    }
}

listAllPatientsOfUser().then(() => process.exit(0));
