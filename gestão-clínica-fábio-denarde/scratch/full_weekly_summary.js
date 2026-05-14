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

async function generateFullWeeklySummary() {
    // Current week (Monday to Saturday): 2026-05-11 (Mon) to 2026-05-16 (Sat)
    const weekStart = '2026-05-11';
    const weekEnd = '2026-05-16';
    const daysOfWeek = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    const patientsSnapshot = await db.collectionGroup('patients').get();
    const patientsMap = {};
    patientsSnapshot.forEach(doc => {
        patientsMap[doc.id] = { id: doc.id, ...doc.data() };
    });

    const sessionsSnapshot = await db.collectionGroup('sessions')
        .where('date', '>=', weekStart)
        .where('date', '<=', weekEnd)
        .get();

    const manualSessionsByDate = {};
    sessionsSnapshot.forEach(doc => {
        const s = doc.data();
        if (!manualSessionsByDate[s.date]) manualSessionsByDate[s.date] = [];
        manualSessionsByDate[s.date].push(s);
    });

    const fullSummary = [];

    for (let i = 1; i <= 6; i++) { // Monday to Saturday
        const d = new Date('2026-05-10T12:00:00'); // Sunday 10th
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = daysOfWeek[i];

        const manual = manualSessionsByDate[dateStr] || [];
        const manualIds = new Set(manual.map(m => m.patientId));

        const virtual = [];
        Object.values(patientsMap).forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = dayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                if (!manualIds.has(p.id)) {
                    virtual.push({ patientId: p.id, time: p.fixedTime, date: dateStr, isVirtual: true, status: 'Agendada' });
                }
            }
        });

        const allDaySessions = [...manual, ...virtual].filter(s => s.status === 'Agendada');

        allDaySessions.sort((a, b) => a.time.localeCompare(b.time));

        allDaySessions.forEach(s => {
            const p = patientsMap[s.patientId];
            if (!p) return;

            const [hour] = s.time.split(':').map(Number);
            const diaEnvio = hour < 12 ? '06:30' : '12:30';
            
            // For sending eve: Date - 1 at 09:00
            const eveDate = new Date(dateStr + 'T12:00:00');
            eveDate.setDate(eveDate.getDate() - 1);
            const eveDateStr = eveDate.toISOString().split('T')[0].split('-').reverse().slice(0, 2).join('/'); // DD/MM

            fullSummary.push({
                date: dateStr.split('-').reverse().slice(0, 2).join('/'), // DD/MM
                day: dayName,
                paciente: p.name,
                responsavel: p.guardianName,
                horario: s.time,
                envioVespera: `${eveDateStr} às 09:00`,
                envioDia: `${dateStr.split('-').reverse().slice(0, 2).join('/')} às ${diaEnvio}`
            });
        });
    }

    console.log(JSON.stringify(fullSummary, null, 2));
}

generateFullWeeklySummary().then(() => process.exit(0));
