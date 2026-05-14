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

async function checkTomorrow() {
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];

    console.log("Checando sessões para amanhã:", tomorrow);
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '==', tomorrow)
        .where('status', '==', 'Agendada')
        .get();
    
    console.log("Total agendadas para amanhã:", sessionsSnapshot.size);
    for (const doc of sessionsSnapshot.docs) {
        const data = doc.data();
        const patientDoc = await db.doc(doc.ref.parent.parent.path + '/patients/' + data.patientId).get();
        const pData = patientDoc.exists ? patientDoc.data() : { name: 'Unknown' };
        console.log(`- Sessão: ${pData.name} (Guardian: ${pData.guardianName}) as ${data.time}`);
    }
}

checkTomorrow().then(() => process.exit(0));
