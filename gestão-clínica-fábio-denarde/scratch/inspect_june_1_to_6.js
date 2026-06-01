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
  
  // Fetch patients
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  const patientsMap = {};
  patientsSnapshot.forEach(p => {
    const data = { id: p.id, ...p.data() };
    patients.push(data);
    patientsMap[p.id] = data;
  });

  // Dates to analyze (01/06/2026 to 06/06/2026)
  const weekDates = [
    '2026-06-01', // Segunda
    '2026-06-02', // Terça
    '2026-06-03', // Quarta
    '2026-06-04', // Quinta
    '2026-06-05', // Sexta
    '2026-06-06'  // Sábado
  ];

  const diasSemanaNomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diasSemanaBonitos = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  console.log(`==================================================`);
  console.log(` RESUMO DAS MENSAGENS DO ROBÔ DE WHATSAPP`);
  console.log(` Período: 01/06/2026 a 06/06/2026 (Hoje: 01/06/2026)`);
  console.log(`==================================================\n`);

  for (let i = 0; i < weekDates.length; i++) {
    const dateStr = weekDates[i];
    const diaNomeBonito = diasSemanaBonitos[i];
    
    // Obter dia da semana index
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayOfWeekIndex = dateObj.getDay();
    const diaDaSemanaAlvo = diasSemanaNomes[dayOfWeekIndex];

    const configSnapshot = await db.doc(`users/${userId}/settings/config`).get();
    const settings = configSnapshot.exists ? configSnapshot.data() : {};
    const holidays = settings.holidays || [];
    const holidayObj = holidays.find(h => h.date === dateStr);
    
    if (holidayObj) {
      console.log(`📅 ${diaNomeBonito} (${dateStr.split('-').reverse().join('/')})`);
      console.log(`  🚫 [FERIADO/RECESSO] ${holidayObj.name.trim()} - Mensagens automáticas suspensas.`);
      console.log(`--------------------------------------------------`);
      continue;
    }

    // 1. Fetch real sessions for today
    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('date', '==', dateStr)
      .get();
    
    const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Use the exact filter logic from our updated server.js
    const sessionsReais = todasSessoesHoje.filter(s => {
      if (s.status !== 'Agendada') return false;
      
      const patient = patientsMap[s.patientId];
      if (!patient) return true;
      if (patient.status !== 'Ativo') return false;

      // Check if it matches current schedule
      const normalizeStr = (s) => s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
      const normalizeTime = (timeStr) => {
        if (!timeStr) return '';
        const parts = timeStr.trim().split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
      };
      const addOneHour = (timeStr) => {
        const [hour, min] = timeStr.split(':').map(Number);
        return `${String((hour + 1) % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      };

      const isMatchingDay = normalizeStr(diaDaSemanaAlvo) === normalizeStr(patient.fixedDay || '');
      const isMatchingTime = normalizeTime(s.time) === normalizeTime(patient.fixedTime) ||
                             (patient.doubleSession && normalizeTime(s.time) === normalizeTime(addOneHour(patient.fixedTime)));
      
      if (isMatchingDay && isMatchingTime) {
        return true;
      }

      const isReposition = s.packageNumber === 0;
      const notesLower = (s.notes || '').toLowerCase();
      const isManualNotes = notesLower.includes('reposição') || notesLower.includes('reposicao') || notesLower.includes('extra') || notesLower.includes('manual');
      
      if (isReposition || isManualNotes) {
        return true;
      }
      return false;
    });

    // 2. Generate virtual sessions
    const sessionsVirtuais = [];
    patients.forEach(p => {
      if (p.status !== 'Ativo') return;
      
      const normalizeStr = (s) => s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';
      const fixedDayNorm = normalizeStr(p.fixedDay || '');
      const targetDayNorm = normalizeStr(diaDaSemanaAlvo);

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
    
    // Group and pick earliest
    const formatPhoneNumber = (phoneStr) => {
        let clean = phoneStr.replace(/\D/g, '');
        if (!clean.startsWith('55')) {
            clean = '55' + clean;
        }
        return `${clean}@c.us`;
    };

    const disparosUnicos = new Map();
    for (const s of todasAsSessoes) {
        const patient = patientsMap[s.patientId];
        if (!patient || !patient.whatsapp) continue;
        
        const phone = formatPhoneNumber(patient.whatsapp);
        if (!disparosUnicos.has(patient.id) || s.time < disparosUnicos.get(patient.id).s.time) {
            disparosUnicos.set(patient.id, { s, patient, phone });
        }
    }

    console.log(`📅 ${diaNomeBonito} (${dateStr.split('-').reverse().join('/')})`);
    
    if (disparosUnicos.size === 0) {
      console.log(`  [Nenhuma mensagem de lembrete programada para este dia]`);
    } else {
      const items = Array.from(disparosUnicos.values()).sort((a, b) => a.s.time.localeCompare(b.s.time));
      items.forEach(({ s, patient, phone }) => {
        const horaFormatada = s.time.endsWith(':00') ? s.time.split(':')[0] + 'h' : s.time + 'h';
        console.log(`  ⏰ ${s.time} - Paciente: ${patient.name} | Responsável: ${patient.guardianName} (${phone})`);
        
        // Exibir mensagens (D-1 e D-0)
        console.log(`     💬 Mensagem de Véspera (Enviada no dia anterior às 09:00):`);
        console.log(`        "Bom dia/Boa tarde! Olá, ${patient.guardianName.trim()}, tudo bem?\n        Passando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n        Aguardo sua confirmação,\n        Até logo!"`);
        
        console.log(`     💬 Mensagem do Dia (Enviada no dia da sessão):`);
        console.log(`        "Bom dia/Boa tarde!\n        Aguardo vocês hoje às *${horaFormatada}*!\n        Até logo! 🙏🏼"`);
        console.log();
      });
    }
    console.log(`--------------------------------------------------`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
