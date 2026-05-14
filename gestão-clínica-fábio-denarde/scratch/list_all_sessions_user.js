const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function listAllSessions() {
    try {
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        for (const configDoc of settingsConfigSnapshot.docs) {
            const userId = configDoc.ref.parent.parent.id;
            console.log(`User: ${userId}`);
            
            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '>=', '2026-05-11')
                .where('date', '<=', '2026-05-17')
                .get();
            
            console.log(`Found ${sessionsSnapshot.size} manual sessions.`);
            sessionsSnapshot.forEach(doc => {
                console.log(`- ${doc.data().date} ${doc.data().time} (Status: ${doc.data().status}) Patient: ${doc.data().patientId}`);
            });
        }
    } catch (e) { console.error(e); }
}

listAllSessions();
