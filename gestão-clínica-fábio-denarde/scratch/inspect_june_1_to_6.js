import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

const normalizeStr = (s) => {
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};

const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return timeStr;
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
};

const addOneHour = (timeStr) => {
    if (!timeStr) return '';
    const [hour, min] = timeStr.split(':').map(Number);
    const newHour = (hour + 1) % 24;
    return `${String(newHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

function getSessionsForDate({ dateStr, patients, sessions, settings }) {
    const processed = [];
    
    // Parse target day of week in Portuguese
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayIndex = dateObj.getDay();
    const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dayKey = dayNames[dayIndex];
    
    // Check if holiday
    const holiday = (settings.holidays || []).find(h => h.date === dateStr);
    
    // 1. Process Real Sessions
    const dbSessions = sessions.filter(s => s.date === dateStr);
    for (const s of dbSessions) {
        if (s.isBlocked) {
            processed.push({
                ...s,
                isVirtual: false,
                isValid: false,
                blockedReason: 'sessão manual bloqueadora'
            });
            continue;
        }
        
        const patient = patients.find(p => p.id === s.patientId);
        if (!patient) {
            processed.push({
                ...s,
                isVirtual: false,
                isValid: false,
                blockedReason: 'paciente inativo'
            });
            continue;
        }
        
        let blockedReason = null;
        if (holiday) {
            blockedReason = 'feriado/recesso';
        } else if (patient.status !== 'Ativo') {
            blockedReason = 'paciente inativo';
        } else if (s.status === 'Cancelada') {
            blockedReason = 'sessão cancelada';
        } else if (!patient.whatsapp || !patient.whatsapp.trim()) {
            blockedReason = 'paciente sem WhatsApp';
        } else if (s.status !== 'Agendada') {
            blockedReason = 'status inválido';
        }
        
        processed.push({
            ...s,
            isVirtual: false,
            isValid: !blockedReason,
            blockedReason: blockedReason || undefined
        });
    }
    
    // 2. Process Virtual Sessions
    if (!holiday) {
        for (const p of patients) {
            if (p.status !== 'Ativo') continue;
            
            const fixedDayNorm = normalizeStr(p.fixedDay).replace('-feira', '');
            const targetDayNorm = normalizeStr(dayKey).replace('-feira', '');
            
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                const time1 = p.fixedTime;
                // Check if a real manual session exists for this patient, date, and time
                const hasManual1 = dbSessions.some(
                  s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time1)
                );
                if (!hasManual1) {
                    const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : null;
                    processed.push({
                        id: `virtual-${p.id}-${dateStr}-${time1}`,
                        patientId: p.id,
                        date: dateStr,
                        time: time1,
                        type: p.doubleSession ? 'Sessão dupla (2 × 50 min)' : 'Sessão simples (50 min)',
                        status: 'Agendada',
                        notes: '',
                        packageNumber: 0,
                        isVirtual: true,
                        isValid: !blockedReason,
                        blockedReason: blockedReason || undefined
                    });
                }
                
                if (p.doubleSession) {
                    const time2 = addOneHour(p.fixedTime);
                    const hasManual2 = dbSessions.some(
                      s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time2)
                    );
                    if (!hasManual2) {
                        const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : null;
                        processed.push({
                            id: `virtual-${p.id}-${dateStr}-${time2}`,
                            patientId: p.id,
                            date: dateStr,
                            time: time2,
                            type: 'Sessão dupla (2 × 50 min)',
                            status: 'Agendada',
                            notes: '',
                            packageNumber: 0,
                            isVirtual: true,
                            isValid: !blockedReason,
                            blockedReason: blockedReason || undefined
                        });
                    }
                }
            }
        }
    }
    
    processed.sort((a, b) => a.time.localeCompare(b.time));
    return processed;
}

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
    '2026-06-04', // Quinta (Feriado)
    '2026-06-05', // Sexta (Emenda)
    '2026-06-06'  // Sábado
  ];

  const diasSemanaNomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diasSemanaBonitos = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  console.log(`==================================================`);
  console.log(` RESUMO DIAGNÓSTICO DO ROBÔ E AGENDA CLÍNICA`);
  console.log(` Período: 01/06/2026 a 06/06/2026 (Hoje: 01/06/2026)`);
  console.log(`==================================================\n`);

  for (let i = 0; i < weekDates.length; i++) {
    const dateStr = weekDates[i];
    const diaNomeBonito = diasSemanaBonitos[i];

    const configSnapshot = await db.doc(`users/${userId}/settings/config`).get();
    const settings = configSnapshot.exists ? configSnapshot.data() : {};
    const holidays = settings.holidays || [];
    const holidayObj = holidays.find(h => h.date === dateStr);
    
    console.log(`📅 ${diaNomeBonito} (${dateStr.split('-').reverse().join('/')})`);

    if (holidayObj) {
      console.log(`  🚫 [FERIADO/RECESSO] ${holidayObj.name.trim()} - Mensagens automáticas suspensas.`);
      console.log(`--------------------------------------------------`);
      continue;
    }

    // 1. Fetch all manual sessions for this date
    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('date', '==', dateStr)
      .get();
    
    const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const daySessions = getSessionsForDate({
        dateStr,
        patients,
        sessions: todasSessoesHoje,
        settings
    });

    // Group to find earliest unique messages (server.js exact algorithm)
    const disparosUnicos = new Map();
    for (const s of daySessions) {
        if (!s.isValid) continue;
        const patient = patientsMap[s.patientId];
        if (!patient || !patient.whatsapp) continue;
        
        // Agrupa por ID de paciente
        if (!disparosUnicos.has(patient.id) || s.time < disparosUnicos.get(patient.id).s.time) {
            disparosUnicos.set(patient.id, { s, patient });
        }
    }

    if (daySessions.length === 0) {
      console.log(`  [Nenhum atendimento agendado ou fixo para este dia]`);
    } else {
      daySessions.forEach(s => {
        const patient = patientsMap[s.patientId];
        const label = s.isVirtual ? 'FIXO' : 'MANUAL';
        
        if (s.isValid) {
            const isSent = disparosUnicos.get(s.patientId)?.s.id === s.id;
            
            if (isSent) {
                const phone = patient.whatsapp;
                console.log(`  ⏰ ${s.time} - [${label}] Paciente: ${patient.name} | Responsável: ${patient.guardianName} (${phone})`);
                const horaFormatada = s.time.endsWith(':00') ? s.time.split(':')[0] + 'h' : s.time + 'h';
                
                console.log(`     💬 Mensagem de Véspera (Enviada no dia anterior às 09:00):`);
                console.log(`        "Bom dia/Boa tarde! Olá, ${patient.guardianName.trim()}, tudo bem?\n        Passando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n        Aguardo sua confirmação,\n        Até logo!"`);
                
                console.log(`     💬 Mensagem do Dia (Enviada no dia da sessão):`);
                console.log(`        "Bom dia/Boa tarde!\n        Aguardo vocês hoje às *${horaFormatada}*!\n        Até logo! 🙏🏼"`);
            } else {
                console.log(`  ⏰ ${s.time} - [${label}] Paciente: ${patient.name} | 🚫 Bloqueado: conflito/deduplicação (Já possui lembrete para esta data)`);
            }
        } else {
            const name = patient ? patient.name : (s.blockName || 'Compromisso');
            console.log(`  ⏰ ${s.time} - [${label}] Paciente: ${name} | 🚫 Bloqueado: ${s.blockedReason}`);
        }
        console.log();
      });
    }
    console.log(`--------------------------------------------------`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
