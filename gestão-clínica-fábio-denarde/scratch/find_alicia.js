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

async function findAlicia() {
    const today = new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().split('T')[0];

    console.log("Searching for Alicia...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    let aliciaId = null;
    let userId = null;
    let aliciaData = null;

    patientsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.name.toLowerCase().includes('alicia')) {
            aliciaId = doc.id;
            aliciaData = data;
            userId = doc.ref.parent.parent.id;
            console.log(`Found Alicia: ${data.name} (ID: ${aliciaId}) in user ${userId}`);
            console.log(`Guardian: ${data.guardianName}, Fixed Day: ${data.fixedDay}, Fixed Time: ${data.fixedTime}`);
        }
    });

    if (aliciaId) {
        console.log("\nSessions for Today (" + today + "):");
        const todaySessions = await db.collection(`users/${userId}/sessions`)
            .where('patientId', '==', aliciaId)
            .where('date', '==', today)
            .get();
        todaySessions.forEach(doc => console.log(`- ${doc.id}: Time ${doc.data().time}, Status ${doc.data().status}`));

        console.log("\nSessions for Tomorrow (" + tomorrow + "):");
        const tomorrowSessions = await db.collection(`users/${userId}/sessions`)
            .where('patientId', '==', aliciaId)
            .where('date', '==', tomorrow)
            .get();
        tomorrowSessions.forEach(doc => console.log(`- ${doc.id}: Time ${doc.data().time}, Status ${doc.data().status}`));
    } else {
        console.log("Alicia not found.");
    }
}

findAlicia().then(() => process.exit(0));
