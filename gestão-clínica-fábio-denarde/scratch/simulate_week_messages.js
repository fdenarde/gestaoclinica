import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

const formatPhoneNumber = (phoneStr) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) clean = '55' + clean;
    return `${clean}@c.us`;
};

// Formata 14:00 -> 14h, 14:30 -> 14:30h
const formatTimeMsg = (timeStr) => {
    return timeStr.endsWith(':00') ? timeStr.split(':')[0] + 'h' : timeStr + 'h';
};

async function simulateWeek() {
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    // Configurações do primeiro usuário encontrado
    const configDoc = settingsConfigSnapshot.docs[0];
    const userId = configDoc.ref.parent.parent.id;
    
    // Buscar pacientes
    const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
    const patients = [];
    const patientsMap = {};
    patientsSnapshot.forEach(p => {
        const data = { id: p.id, ...p.data() };
        patients.push(data);
        patientsMap[p.id] = data;
    });

    const days = [
        { dateStr: '2026-05-18', name: 'Segunda-feira' },
        { dateStr: '2026-05-19', name: 'Terça-feira' },
        { dateStr: '2026-05-20', name: 'Quarta-feira' },
        { dateStr: '2026-05-21', name: 'Quinta-feira' },
        { dateStr: '2026-05-22', name: 'Sexta-feira' },
        { dateStr: '2026-05-23', name: 'Sábado' }
    ];

    console.log("=== SIMULAÇÃO DOS ENVIOS DO ROBÔ WHATSAPP DA SEMANA (18/05/2026 a 23/05/2026) ===\n");

    for (const day of days) {
        const { dateStr, name } = day;
        console.log(`📅 ${name.toUpperCase()} (${dateStr})`);

        // Buscar sessões manuais deste dia
        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '==', dateStr).get();
        const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');

        // Buscar sessões virtuais
        const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
        const diaSemanaNome = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];
        const sessionsVirtuais = [];

        patients.forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = diaSemanaNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

        // 1. Simular HOJE_MANHA (Disparo às 06:30)
        // Somente sessões antes das 12:00
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

        // 2. Simular HOJE_TARDE (Disparo às 12:30)
        // Somente sessões a partir das 12:00
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

        // 3. Simular AMANHA (Disparo no dia ANTERIOR às 09:00)
        // Todas as sessões deste dia
        const disparosAmanha = new Map();
        for (const s of todasAsSessoes) {
            const patient = patientsMap[s.patientId];
            if (!patient || !patient.whatsapp) continue;
            if (!disparosAmanha.has(patient.id) || s.time < disparosAmanha.get(patient.id).s.time) {
                disparosAmanha.set(patient.id, { s, patient });
            }
        }

        // Exibir resultados de disparos de HOJE (enviados no próprio dia)
        console.log("  ⏰ Disparo 06:30 (Lembrete para hoje de manhã):");
        if (disparosManha.size === 0) {
            console.log("    - Nenhum envio.");
        } else {
            for (const { s, patient } of disparosManha.values()) {
                const horaFormatada = formatTimeMsg(s.time);
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) às ${s.time}`);
                console.log(`      Texto: "Bom dia!\nAguardo vocês hoje às *${horaFormatada}*!\nAté logo! 🙏🏼"`);
            }
        }

        console.log("  ⏰ Disparo 12:30 (Lembrete para hoje à tarde):");
        if (disparosTarde.size === 0) {
            console.log("    - Nenhum envio.");
        } else {
            for (const { s, patient } of disparosTarde.values()) {
                const horaFormatada = formatTimeMsg(s.time);
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) às ${s.time}`);
                console.log(`      Texto: "Boa tarde!\nAguardo vocês hoje às *${horaFormatada}*!\nAté logo! 🙏🏼"`);
            }
        }

        // Exibir resultados de disparos de AMANHÃ (enviados no dia ANTERIOR às 09:00)
        const diasSemanaParaAnterior = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
        const diaAnteriorIndex = (new Date(dateStr + 'T12:00:00').getDay() - 1 + 7) % 7;
        const diaAnteriorNome = diasSemanaParaAnterior[diaAnteriorIndex];
        console.log(`  ⏰ Disparo no dia anterior (${diaAnteriorNome} às 09:00 - Lembrete de amanhã):`);
        if (disparosAmanha.size === 0) {
            console.log("    - Nenhum envio.");
        } else {
            for (const { s, patient } of disparosAmanha.values()) {
                console.log(`    - Para: ${patient.guardianName} (${patient.name}) às ${s.time}`);
                console.log(`      Texto: "Bom dia! Olá, ${patient.guardianName.trim()}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n\nAguardo sua confirmação,\nAté logo!"`);
            }
        }
        console.log("\n--------------------------------------------------\n");
    }
}

simulateWeek().then(() => process.exit(0)).catch(console.error);
