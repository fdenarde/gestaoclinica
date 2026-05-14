const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const serviceAccount = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function debug() {
    const settings = await db.collectionGroup('settings').get();
    for (const doc of settings.docs) {
        const uid = doc.ref.parent.parent.id;
        console.log(`UID: ${uid}`);
        
        const ps = await db.collection(`users/${uid}/patients`).get();
        ps.forEach(p => {
            const d = p.data();
            if (d.name === 'Alicia' || d.name.includes('Weslley')) {
                console.log(`Patient: ${d.name} | FixedDay: "${d.fixedDay}" | Time: "${d.fixedTime}" | Status: ${d.status}`);
            }
        });

        const ss = await db.collection(`users/${uid}/sessions`).where('date', '==', '2026-05-14').get();
        console.log(`Manual sessions for 2026-05-14:`);
        ss.forEach(s => {
            console.log(`- PatientID: ${s.data().patientId} | Time: ${s.data().time} | Status: ${s.data().status}`);
        });
    }
}
debug();
