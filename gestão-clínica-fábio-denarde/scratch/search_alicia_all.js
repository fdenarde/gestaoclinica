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

async function searchAllAlicias() {
    console.log("Searching for all patients named Alicia...");
    const patientsSnapshot = await db.collectionGroup('patients').get();
    
    for (const doc of patientsSnapshot.docs) {
        const p = doc.data();
        if (p.name && p.name.toLowerCase().includes('alicia')) {
            console.log(`\nFound: ${p.name} (Guardian: ${p.guardianName}, ID: ${doc.id}, Status: ${p.status})`);
            console.log(`Path: ${doc.ref.path}`);
            
            const today = new Date().toISOString().split('T')[0];
            const sessions = await db.collection(doc.ref.parent.parent.path + '/sessions')
                .where('patientId', '==', doc.id)
                .where('date', '==', today)
                .get();
            
            if (sessions.empty) {
                console.log("  No sessions for today.");
            } else {
                sessions.forEach(s => {
                    console.log(`  - Session Today: ${s.data().time}, Status: ${s.data().status}`);
                });
            }

            const tomorrowDate = new Date();
            tomorrowDate.setDate(tomorrowDate.getDate() + 1);
            const tomorrow = tomorrowDate.toISOString().split('T')[0];
            const sessionsTomorrow = await db.collection(doc.ref.parent.parent.path + '/sessions')
                .where('patientId', '==', doc.id)
                .where('date', '==', tomorrow)
                .get();
            
            if (sessionsTomorrow.empty) {
                console.log("  No sessions for tomorrow.");
            } else {
                sessionsTomorrow.forEach(s => {
                    console.log(`  - Session Tomorrow: ${s.data().time}, Status: ${s.data().status}`);
                });
            }
        }
    }
}

searchAllAlicias().then(() => process.exit(0));
