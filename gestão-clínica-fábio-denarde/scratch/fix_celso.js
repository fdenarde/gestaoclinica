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
      console.log(`\n==========================================`);
      console.log(`Processando usuário: ${userId}`);
      console.log(`==========================================`);
      
      // 1. Atualizar registro do paciente Celso
      const celsoRef = db.doc(`users/${userId}/patients/wg9ojb9el`);
      const celsoDoc = await celsoRef.get();
      
      if (celsoDoc.exists) {
          console.log(`\n[PACIENTE] Encontrado Celso (ID: wg9ojb9el).`);
          console.log(`[PACIENTE] Valores atuais:`);
          console.log(` - fixedDay: "${celsoDoc.data().fixedDay}"`);
          console.log(` - fixedTime: "${celsoDoc.data().fixedTime}"`);
          console.log(` - guardianName: "${celsoDoc.data().guardianName}"`);
          
          await celsoRef.update({
              fixedDay: "sexta",
              fixedTime: "14:00",
              guardianName: "Debriane"
          });
          
          const updatedCelsoDoc = await celsoRef.get();
          console.log(`\n[PACIENTE] Registro atualizado com sucesso!`);
          console.log(`[PACIENTE] Novos valores:`);
          console.log(` - fixedDay: "${updatedCelsoDoc.data().fixedDay}"`);
          console.log(` - fixedTime: "${updatedCelsoDoc.data().fixedTime}"`);
          console.log(` - guardianName: "${updatedCelsoDoc.data().guardianName}"`);
      } else {
          console.log(`[PACIENTE] Paciente Celso (ID: wg9ojb9el) não encontrado neste usuário.`);
          continue;
      }
      
      // 2. Verificar e remover agendamentos duplicados/incorretos (especialmente terças/segundas às 08:00)
      console.log(`\n[SESSÕES] Buscando sessões de Celso...`);
      const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
          .where('patientId', '==', 'wg9ojb9el')
          .get();
          
      const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      
      let deletedCount = 0;
      
      for (const doc of sessionsSnapshot.docs) {
          const s = doc.data();
          const sDate = new Date(s.date + 'T12:00:00');
          const dayOfWeek = diasSemana[sDate.getDay()];
          
          // Condição para deletar: 
          // 1. Horário às 08:00 (já que o atendimento correto é às 14:00 nas sextas-feiras)
          // 2. Ou dia de semana diferente de sexta-feira
          const isAt08 = s.time === '08:00';
          const isNotFriday = dayOfWeek !== 'sexta';
          
          if (isAt08 || isNotFriday) {
              console.log(`[SESSÕES] Deletando sessão incorreta: ID=${doc.id} | Data=${s.date} (${dayOfWeek}) | Hora=${s.time} | Status=${s.status}`);
              await db.collection(`users/${userId}/sessions`).doc(doc.id).delete();
              deletedCount++;
          }
      }
      
      console.log(`\n[SESSÕES] Concluído! Total de sessões incorretas/duplicadas removidas: ${deletedCount}`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
