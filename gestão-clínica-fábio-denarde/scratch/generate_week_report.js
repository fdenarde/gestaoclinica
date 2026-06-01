import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

const formatPhoneNumber = (phoneStr) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) clean = '55' + clean;
    return `${clean}@c.us`;
};

const formatTimeMsg = (timeStr) => {
    return timeStr.endsWith(':00') ? timeStr.split(':')[0] + 'h' : timeStr + 'h';
};

const getHourBase = (timeStr) => {
    if (!timeStr) return '';
    const [hour] = timeStr.split(':');
    return `${hour}:00`;
};

async function simulateWeek() {
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

    // We target the current week: 2026-06-01 (Monday) to 2026-06-06 (Saturday)
    const days = [
        { dateStr: '2026-06-01', name: 'Segunda-feira' },
        { dateStr: '2026-06-02', name: 'Terça-feira' },
        { dateStr: '2026-06-03', name: 'Quarta-feira' },
        { dateStr: '2026-06-04', name: 'Quinta-feira' },
        { dateStr: '2026-06-05', name: 'Sexta-feira' },
        { dateStr: '2026-06-06', name: 'Sábado' }
    ];

    const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    console.log("==================================================================================");
    console.log(" SIMULAÇÃO DE ENVIOS DO ROBÔ WHATSAPP - SEMANA DE 01/06/2026 A 06/06/2026");
    console.log("==================================================================================\n");

    for (const day of days) {
        const { dateStr, name } = day;
        console.log(`📅 ${name.toUpperCase()} (${dateStr.split('-').reverse().join('/')})`);

        // Fetch manual sessions for this day
        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '==', dateStr)
            .get();
        const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');

        // Target day name
        const dateObj = new Date(dateStr + 'T12:00:00');
        const diaSemanaNome = diasSemana[dateObj.getDay()];

        // Generate virtual sessions
        const sessionsVirtuais = [];
        patients.forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = diaSemanaNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                // Check if there is already a manual session for this patient *at this time*
                // Wait! In server.js, the check is: s.patientId === p.id && s.time === p.fixedTime
                const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === p.id && s.time === p.fixedTime);
                if (!jaTemSessaoManual) {
                    sessionsVirtuais.push({
                        patientId: p.id,
                        date: dateStr,
                        time: p.fixedTime,
                        status: 'Agendada',
                        isVirtual: true
                    });
                    
                    // Also support double sessions
                    if (p.doubleSession) {
                        const [hour, min] = p.fixedTime.split(':').map(Number);
                        const nextHourStr = `${String((hour + 1) % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
                        const jaTemSessaoManualSegunda = todasSessoesHoje.some(s => s.patientId === p.id && s.time === nextHourStr);
                        if (!jaTemSessaoManualSegunda) {
                            sessionsVirtuais.push({
                                patientId: p.id,
                                date: dateStr,
                                time: nextHourStr,
                                status: 'Agendada',
                                isVirtual: true
                            });
                        }
                    }
                }
            }
        });

        const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
        todasAsSessoes.sort((a, b) => a.time.localeCompare(b.time));

        // Display agenda info for the day
        if (todasAsSessoes.length === 0) {
            console.log("  [Sem sessões agendadas ou fixas para hoje]");
        } else {
            console.log("  Atendimentos do dia:");
            todasAsSessoes.forEach(s => {
                const patient = patientsMap[s.patientId];
                console.log(`    - ${s.time} | Paciente: ${patient ? patient.name : 'N/A'} (Resp: ${patient ? patient.guardianName : 'N/A'}) [${s.isVirtual ? 'Fixo/Virtual' : 'Manual'}]`);
            });
        }
        console.log("");

        // 1. Simular HOJE_MANHA (06:30) - Appointments before 12:00
        const sessoesManha = todasAsSessoes.filter(s => {
            const [hour] = s.time.split(':').map(Number);
            return hour < 12;
        });
        const disparosManha = new Map();
        for (const s of sessoesManha) {
            const patient = patientsMap[s.patientId];
            if (!patient || !patient.whatsapp) continue;
            if (!disparosManha.has(patient.id) || s.time < disparosManha.get(patient.id).s.time) {
                disparosManha.set(patient.id, { s, patient });
            }
        }

        // 2. Simular HOJE_TARDE (12:30) - Appointments from 12:00 onwards
        const sessoesTarde = todasAsSessoes.filter(s => {
            const [hour] = s.time.split(':').map(Number);
            return hour >= 12;
        });
        const disparosTarde = new Map();
        for (const s of sessoesTarde) {
            const patient = patientsMap[s.patientId];
            if (!patient || !patient.whatsapp) continue;
            if (!disparosTarde.has(patient.id) || s.time < disparosTarde.get(patient.id).s.time) {
                disparosTarde.set(patient.id, { s, patient });
            }
        }

        // 3. Simular AMANHA (dispatched on the PREVIOUS day at 09:00)
        const disparosAmanha = new Map();
        for (const s of todasAsSessoes) {
            const patient = patientsMap[s.patientId];
            if (!patient || !patient.whatsapp) continue;
            if (!disparosAmanha.has(patient.id) || s.time < disparosAmanha.get(patient.id).s.time) {
                disparosAmanha.set(patient.id, { s, patient });
            }
        }

        // Output notifications
        console.log("  ⏰ DISPAROS ÀS 06:30 (Lembretes de Hoje de Manhã):");
        if (disparosManha.size === 0) {
            console.log("    - [Nenhum envio]");
        } else {
            for (const { s, patient } of disparosManha.values()) {
                const horaFormatada = formatTimeMsg(s.time);
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) | Celular: ${patient.whatsapp}`);
                console.log(`      Mensagem: "Bom dia!\nAguardo vocês hoje às *${horaFormatada}*!\nAté logo! 🙏🏼"`);
            }
        }

        console.log("  ⏰ DISPAROS ÀS 12:30 (Lembretes de Hoje à Tarde):");
        if (disparosTarde.size === 0) {
            console.log("    - [Nenhum envio]");
        } else {
            for (const { s, patient } of disparosTarde.values()) {
                const horaFormatada = formatTimeMsg(s.time);
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) | Celular: ${patient.whatsapp}`);
                console.log(`      Mensagem: "Boa tarde!\nAguardo vocês hoje às *${horaFormatada}*!\nAté logo! 🙏🏼"`);
            }
        }

        // Yesterday's 09:00 dispatch for today
        const diaAnteriorIndex = (dateObj.getDay() - 1 + 7) % 7;
        const diasSemanaNomes = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const diaAnteriorNome = diasSemanaNomes[diaAnteriorIndex];
        console.log(`  ⏰ DISPAROS NO DIA ANTERIOR (${diaAnteriorNome} às 09:00 - Lembrete de Amanhã):`);
        if (disparosAmanha.size === 0) {
            console.log("    - [Nenhum envio]");
        } else {
            for (const { s, patient } of disparosAmanha.values()) {
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) | Celular: ${patient.whatsapp}`);
                console.log(`      Mensagem: "Bom dia! Olá, ${patient.guardianName.trim()}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n\nAguardo sua confirmação,\nAté logo!"`);
            }
        }
        console.log("\n----------------------------------------------------------------------------------\n");
    }
}

simulateWeek().then(() => process.exit(0)).catch(console.error);
