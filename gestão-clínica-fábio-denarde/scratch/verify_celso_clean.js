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
  
  console.log(`\n=== Verificação de Segurança (Paciente Celso) ===`);
  
  const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('patientId', '==', 'wg9ojb9el')
      .get();
      
  const sessions = [];
  sessionsSnapshot.forEach(doc => {
      sessions.push({ id: doc.id, ...doc.data() });
  });
  
  // Ordenar por data cronológica
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  
  const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  
  console.log(`\nSessões Futuras / Ativas Agendadas encontradas no Firestore:`);
  let activeIncorrectSessions = 0;
  
  sessions.forEach(s => {
      const sDate = new Date(s.date + 'T12:00:00');
      const dayOfWeek = diasSemana[sDate.getDay()];
      
      const isIncorrect = s.time === '08:00' || dayOfWeek !== 'sexta';
      if (s.status === 'Agendada') {
          console.log(`- Data: ${s.date} (${dayOfWeek}) | Hora: ${s.time} | Status: ${s.status} | ID: ${s.id} ${isIncorrect ? '⚠️ INCORRETA!' : '✅ CORRETA'}`);
          if (isIncorrect) activeIncorrectSessions++;
      }
  });
  
  console.log(`\nTotal de sessões INCORRETAS com status 'Agendada' encontradas: ${activeIncorrectSessions}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
