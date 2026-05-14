import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function generateSummary() {
    // Current week: 2026-05-10 (Sun) to 2026-05-16 (Sat)
    const startDateStr = '2026-05-10';
    const endDateStr = '2026-05-16';
    const daysOfWeek = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    console.log(`Resumo de envios para a semana de ${startDateStr} a ${endDateStr}\n`);

    // Fetch all patients for all users (assuming single user based on previous exploration but searching group)
    const patientsSnapshot = await db.collectionGroup('patients').get();
    const patientsMap = {};
    patientsSnapshot.forEach(doc => {
        patientsMap[doc.id] = { id: doc.id, ...doc.data(), userId: doc.ref.parent.parent.id };
    });

    // Fetch all sessions for this week
    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '>=', startDateStr)
        .where('date', '<=', endDateStr)
        .get();

    const manualSessionsByDate = {};
    sessionsSnapshot.forEach(doc => {
        const s = doc.data();
        if (!manualSessionsByDate[s.date]) manualSessionsByDate[s.date] = [];
        manualSessionsByDate[s.date].push(s);
    });

    const summary = [];

    // Iterate through each day of the week
    for (let i = 0; i <= 6; i++) {
        const current = new Date(startDateStr + 'T12:00:00');
        current.setDate(current.getDate() + i);
        const dateStr = current.toISOString().split('T')[0];
        const dayName = daysOfWeek[i];

        if (dayName === 'domingo') continue; // No appointments on Sunday

        // Manual sessions for this day
        const manual = manualSessionsByDate[dateStr] || [];
        const manualIds = new Set(manual.map(m => m.patientId));

        // Virtual sessions for this day
        const virtual = [];
        Object.values(patientsMap).forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = dayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                if (!manualIds.has(p.id)) {
                    virtual.push({ patientId: p.id, time: p.fixedTime, date: dateStr, status: 'Agendada (Fixo)' });
                }
            }
        });

        const allDaySessions = [...manual, ...virtual].filter(s => s.status === 'Agendada' || s.status === 'Agendada (Fixo)');

        if (allDaySessions.length > 0) {
            allDaySessions.sort((a, b) => a.time.localeCompare(b.time));
            allDaySessions.forEach(s => {
                const p = patientsMap[s.patientId];
                if (!p) return;

                const [hour] = s.time.split(':').map(Number);
                const diaEnvio = hour < 12 ? '06:30' : '12:30';
                
                summary.push({
                    data: dateStr,
                    diaSemana: dayName,
                    paciente: p.name,
                    responsavel: p.guardianName,
                    horario: s.time,
                    envioVespera: '09:00', // Sent at 09:00 on (date - 1)
                    envioDia: diaEnvio
                });
            });
        }
    }

    // Format output
    summary.forEach(item => {
        console.log(`[${item.data} - ${item.diaSemana}]`);
        console.log(`   Paciente: ${item.paciente}`);
        console.log(`   Responsável: ${item.responsavel}`);
        console.log(`   Horário Atendimento: ${item.horario}`);
        console.log(`   Envio Véspera (dia anterior): ${item.envioVespera}`);
        console.log(`   Envio no Dia: ${item.envioDia}`);
        console.log('-----------------------------------');
    });
}

generateSummary().then(() => process.exit(0));
