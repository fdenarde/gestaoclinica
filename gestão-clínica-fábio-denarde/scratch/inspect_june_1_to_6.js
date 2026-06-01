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
    
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayIndex = dateObj.getDay();
    const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dayKey = dayNames[dayIndex];
    
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

function getWhatsappReminderPlan({ runDateStr, tipo, patients, sessions, settings }) {
    let dateStr = runDateStr;
    if (tipo === 'AMANHA') {
        const d = new Date(runDateStr + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        dateStr = d.toISOString().split('T')[0];
    }
    
    const holiday = (settings.holidays || []).find(h => h.date === dateStr);
    if (holiday) {
        return {
            dateStr,
            isHoliday: true,
            holidayName: holiday.name,
            reminders: [],
            diagnostics: [
                {
                    id: `holiday-${dateStr}`,
                    time: '00:00',
                    patientName: 'Feriado/Recesso',
                    type: 'Bloqueio',
                    isVirtual: false,
                    isValid: false,
                    blockedReason: `feriado/recesso (${holiday.name.trim()})`
                }
            ]
        };
    }
    
    const daySessions = getSessionsForDate({ dateStr, patients, sessions, settings });
    const reminders = [];
    const diagnostics = [];
    
    const formatPhoneNumber = (phoneStr) => {
        let clean = phoneStr.replace(/\D/g, '');
        if (!clean.startsWith('55')) {
            clean = '55' + clean;
        }
        return `${clean}@c.us`;
    };
    
    const candidates = [];
    
    for (const s of daySessions) {
        const patient = patients.find(p => p.id === s.patientId);
        
        if (!s.isValid) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient ? patient.name : (s.blockName || 'Compromisso'),
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: s.blockedReason || 'desconhecido'
            });
            continue;
        }
        
        const [hour] = s.time.split(':').map(Number);
        if (tipo === 'HOJE_MANHA' && hour >= 12) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'fora do turno (Sessão da tarde)'
            });
            continue;
        }
        
        if (tipo === 'HOJE_TARDE' && hour < 12) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'fora do turno (Sessão da manhã)'
            });
            continue;
        }
        
        candidates.push(s);
    }
    
    const selectedMap = new Map();
    for (const s of candidates) {
        if (!selectedMap.has(s.patientId) || s.time < selectedMap.get(s.patientId).time) {
            selectedMap.set(s.patientId, s);
        }
    }
    
    for (const s of candidates) {
        const patient = patients.find(p => p.id === s.patientId);
        const isSent = selectedMap.get(s.patientId).id === s.id;
        
        if (isSent) {
            const phone = formatPhoneNumber(patient.whatsapp);
            const greeting = tipo === 'HOJE_TARDE' ? 'Boa tarde' : 'Bom dia';
            const timeFormatted = s.time.endsWith(':00') ? s.time.split(':')[0] + 'h' : s.time + 'h';
            
            let message = '';
            if (tipo === 'AMANHA') {
                message = `${greeting}! Olá, ${patient.guardianName.trim()}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n\nAguardo sua confirmação,\nAté logo!`;
            } else {
                message = `${greeting}!\nAguardo vocês hoje às *${timeFormatted}*!\nAté logo! 🙏🏼`;
            }
            
            reminders.push({
                id: s.id,
                patientId: s.patientId,
                patientName: patient.name,
                guardianName: patient.guardianName,
                whatsapp: patient.whatsapp,
                phone,
                time: s.time,
                timeFormatted,
                message,
                isVirtual: s.isVirtual,
                type: s.type
            });
        } else {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'conflito/deduplicação (Dupla)'
            });
        }
    }
    
    return {
        dateStr,
        isHoliday: false,
        reminders,
        diagnostics
    };
}

async function run() {
  const settingsConfigSnapshot = await db.collectionGroup('settings').get();
  const configDoc = settingsConfigSnapshot.docs[0];
  const userId = configDoc.ref.parent.parent.id;
  
  // Fetch patients
  const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
  const patients = [];
  patientsSnapshot.forEach(p => {
    patients.push({ id: p.id, ...p.data() });
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
    
    console.log(`📅 ${diaNomeBonito} (${dateStr.split('-').reverse().join('/')})`);

    const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
      .where('date', '==', dateStr)
      .get();
    
    const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const plan = getWhatsappReminderPlan({
        runDateStr: dateStr,
        tipo: 'AMANHA',
        patients,
        sessions: todasSessoesHoje,
        settings
    });

    if (plan.isHoliday) {
      console.log(`  🚫 [FERIADO/RECESSO] ${plan.holidayName.trim()} - Mensagens automáticas suspensas.`);
      console.log(`--------------------------------------------------`);
      continue;
    }

    if (plan.reminders.length === 0 && plan.diagnostics.length === 0) {
      console.log(`  [Nenhum atendimento agendado ou fixo para este dia]`);
    } else {
      plan.reminders.forEach(r => {
        const label = r.isVirtual ? 'FIXO' : 'MANUAL';
        console.log(`  ⏰ ${r.time} - [${label}] Paciente: ${r.patientName} | Responsável: ${r.guardianName} (${r.whatsapp})`);
        
        console.log(`     💬 Mensagem de Véspera (Enviada no dia anterior às 09:00):`);
        console.log(`        "Bom dia/Boa tarde! Olá, ${r.guardianName.trim()}, tudo bem?\n        Passando para lembrar você da sessão de *${r.patientName.trim()}* amanhã, às *${r.time.trim()}*.\n        Aguardo sua confirmação,\n        Até logo!"`);
        
        console.log(`     💬 Mensagem do Dia (Enviada no dia da sessão):`);
        console.log(`        "Bom dia/Boa tarde!\n        Aguardo vocês hoje às *${r.timeFormatted}*!\n        Até logo! 🙏🏼"`);
        console.log();
      });

      plan.diagnostics.forEach(d => {
        const label = d.isVirtual ? 'FIXO' : 'MANUAL';
        console.log(`  ⏰ ${d.time} - [${label}] Paciente: ${d.patientName} | 🚫 Bloqueado: ${d.blockedReason}`);
      });
    }
    console.log(`--------------------------------------------------`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
