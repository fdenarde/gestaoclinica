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

async function checkToday() {
    const today = new Date().toISOString().split('T')[0];
    console.log("Checando sessões para hoje:", today);
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '==', today)
        .where('status', '==', 'Agendada')
        .get();
    console.log("Total agendadas para hoje:", sessionsSnapshot.size);
    sessionsSnapshot.forEach(doc => {
        console.log(`- Sessão: ${doc.data().patientId} as ${doc.data().time}`);
    });
}

checkToday().then(() => process.exit(0));
