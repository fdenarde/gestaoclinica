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

async function checkWeslley() {
    const doc = await db.doc('users/cFn4wYT7FhO4WUbyoTQL7AUrMlF3/patients/1777698597790tlrmb37').get();
    if (doc.exists) {
        console.log("Weslley Patient Data:", doc.data());
    } else {
        console.log("Weslley NOT FOUND.");
    }
}

checkWeslley().then(() => process.exit(0));
