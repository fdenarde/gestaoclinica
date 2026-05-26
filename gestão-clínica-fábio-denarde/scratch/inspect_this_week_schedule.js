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
  
  // Buscar dados dos pacientes
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  const patientsMap = {};
  patientsSnapshot.forEach(p => {
    const data = { id: p.id, ...p.data() };
    patients.push(data);
    patientsMap[p.id] = data;
  });

  // Dias da semana a analisar (25/05/2026 a 31/05/2026)
  const weekDates = [
    '2026-05-25', // Segunda
    '2026-05-26', // Terça
    '2026-05-27', // Quarta
    '2026-05-28', // Quinta
    '2026-05-29', // Sexta
    '2026-05-30', // Sábado
    '2026-05-31'  // Domingo
  ];

  const diasSemanaNomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diasSemanaBonitos = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

  console.log(`==================================================`);
  console.log(` RELATÓRIO DE AGENDAMENTOS E DISPAROS DO ROBÔ`);
  console.log(` Semana: 25/05/2026 a 31/05/2026`);
  console.log(`==================================================\n`);

  for (let i = 0; i < weekDates.length; i++) {
    const dateStr = weekDates[i];
    const diaNomeBonito = diasSemanaBonitos[i];
    
    // Obter dia da semana index
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayOfWeekIndex = dateObj.getDay();
    const diaDaSemanaAlvo = diasSemanaNomes[dayOfWeekIndex];

    // 1. Buscar Sessões Manuais para esta data
    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('date', '==', dateStr)
      .get();
    
    const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');

    // 2. Gerar Sessões Virtuais (baseadas em horários fixos)
    const sessionsVirtuais = [];
    patients.forEach(p => {
      if (p.status !== 'Ativo') return;
      
      const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      if (fixedDayNorm === targetDayNorm && p.fixedTime) {
        const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === p.id && s.time === p.fixedTime);
        if (!jaTemSessaoManual) {
          sessionsVirtuais.push({
            patientId: p.id,
            date: dateStr,
            time: p.fixedTime,
            status: 'Agendada',
            isVirtual: true
          });
        }
      }
    });

    const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
    todasAsSessoes.sort((a, b) => a.time.localeCompare(b.time));

    console.log(`📅 ${diaNomeBonito} (${dateStr.split('-').reverse().join('/')})`);
    
    if (todasAsSessoes.length === 0) {
      console.log(`  [Sem atendimentos agendados ou fixos para este dia]`);
    } else {
      todasAsSessoes.forEach(s => {
        const patient = patientsMap[s.patientId];
        const tipoLabel = s.isVirtual ? 'Horário Fixo (Virtual)' : 'Agendamento Manual';
        const phone = patient ? patient.whatsapp || 'Sem celular' : 'N/A';
        console.log(`  ⏰ ${s.time} - 👦 ${patient ? patient.name : 'Desconhecido'} (${patient ? patient.guardianName : 'N/A'})`);
        console.log(`     📱 Envios para: ${phone} | Origem: ${tipoLabel}`);
      });
    }
    console.log(`--------------------------------------------------`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
