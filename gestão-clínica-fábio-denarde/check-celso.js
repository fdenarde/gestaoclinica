import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function run() {
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();
  for (const configDoc of settingsConfigSnapshot.docs) {
      const userId = configDoc.ref.parent.parent.id;
      const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
      
      patientsSnapshot.forEach(p => {
         const data = p.data();
         if (data.name.toLowerCase().includes('celso')) {
             console.log(`Paciente: ${data.name} | Resp: ${data.guardianName} | Status: ${data.status}`);
             console.log(`Dia fixo: ${data.fixedDay} | Hora fixa: ${data.fixedTime} | Dupla: ${data.doubleSession}`);
             console.log(`ID: ${p.id}`);
         }
      });
      
      const sessionsSnapshot = await db.collection(`users/${userId}/sessions`).get();
      sessionsSnapshot.forEach(s => {
          const data = s.data();
          // Procurar sessões manuais do Celso na semana
          if (data.date >= '2026-05-17' && data.date <= '2026-05-25') {
             // Pegar o nome do paciente
             const pData = patientsSnapshot.docs.find(doc => doc.id === data.patientId)?.data();
             const pName = pData ? pData.name : data.patientId;
             if (pName.toLowerCase().includes('celso')) {
                console.log(`Sessão Manual: Data=${data.date} Hora=${data.time} Paciente=${pName} Status=${data.status}`);
             }
          }
      });
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
