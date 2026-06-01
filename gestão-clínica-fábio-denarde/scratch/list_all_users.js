import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const usersSnapshot = await db.collection('users').get();
  console.log("Total users:", usersSnapshot.size);
  usersSnapshot.forEach(doc => {
    console.log("User ID:", doc.id);
  });
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
