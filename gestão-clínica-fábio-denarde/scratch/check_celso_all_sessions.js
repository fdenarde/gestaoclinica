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
  for (const configDoc of settingsConfigSnapshot.docs) {
      const userId = configDoc.ref.parent.parent.id;
      
      const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
      let celsoId = null;
      patientsSnapshot.forEach(p => {
         const data = p.data();
         if (data.name.toLowerCase().includes('celso')) {
             console.log(`\n=== Paciente Encontrado ===`);
             console.log(`ID: ${p.id}`);
             console.log(`Nome: ${data.name}`);
             console.log(`Responsável: ${data.guardianName}`);
             console.log(`Dia Fixo: ${data.fixedDay}`);
             console.log(`Hora Fixa: ${data.fixedTime}`);
             console.log(`Status: ${data.status}`);
             console.log(`Double Session: ${data.doubleSession}`);
             console.log(`Dados completos:`, JSON.stringify(data, null, 2));
             celsoId = p.id;
         }
      });
      
      if (celsoId) {
          console.log(`\n=== Todas as Sessões de Celso ===`);
          const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
              .where('patientId', '==', celsoId)
              .get();
          
          if (sessionsSnapshot.empty) {
              console.log("Nenhuma sessão cadastrada para Celso.");
          } else {
              sessionsSnapshot.forEach(s => {
                  const data = s.data();
                  console.log(`Sessão ID: ${s.id} | Data: ${data.date} | Hora: ${data.time} | Tipo: ${data.type} | Status: ${data.status}`);
              });
          }
      }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
