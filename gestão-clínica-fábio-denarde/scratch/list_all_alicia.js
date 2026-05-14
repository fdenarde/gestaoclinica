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

async function listAllAlicia() {
    const aliciaId = 'xyfijoha8';
    console.log(`Listing ALL sessions for Alicia (ID: ${aliciaId})...`);
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('patientId', '==', aliciaId)
        .get();
    
    sessionsSnapshot.forEach(doc => {
        console.log(`- Date: ${doc.data().date}, Time: ${doc.data().time}, Status: ${doc.data().status}, ID: ${doc.id}`);
    });
}

listAllAlicia().then(() => process.exit(0));
