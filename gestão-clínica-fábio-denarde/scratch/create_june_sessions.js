import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();
  const configDoc = settingsConfigSnapshot.docs[0];
  const userId = configDoc.ref.parent.parent.id;
  
  console.log(`\n=== Criando Sessões Corretas de Junho para Celso ===`);
  
  const juneDates = [
    '2026-05-29',
    '2026-06-05',
    '2026-06-12',
    '2026-06-19',
    '2026-06-26',
    '2026-07-03',
    '2026-07-10'
  ];
  
  let createdCount = 0;
  
  for (const date of juneDates) {
      const sessionId = Math.random().toString(36).substr(2, 9);
      
      const newSession = {
          id: sessionId,
          patientId: "wg9ojb9el",
          date: date,
          time: "14:00",
          type: "Sessão simples (50 min)",
          status: "Agendada",
          packageNumber: 2
      };
      
      await db.collection(`users/${userId}/sessions`).doc(sessionId).set(newSession);
      console.log(`[CRIADA] Sessão: ID=${sessionId} | Data=${date} (sexta) | Hora=14:00 | Status=Agendada | Package=2`);
      createdCount++;
  }
  
  console.log(`\nConcluído! Total de sessões corretas criadas para Junho/Julho: ${createdCount}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
