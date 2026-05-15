import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function generateSummary() {
    const todayStr = '2026-05-15'; // Friday
    const startOfWeek = new Date('2026-05-11T12:00:00'); // Monday
    const endOfWeek = new Date('2026-05-16T12:00:00'); // Saturday

    const dates = [];
    for (let d = new Date(startOfWeek); d <= endOfWeek; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d).toISOString().split('T')[0]);
    }

    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patientsMap = {};
        patientsSnapshot.forEach(p => {
            patientsMap[p.id] = { id: p.id, ...p.data() };
        });

        const configSnapshot = await db.doc(`users/${userId}/settings/config`).get();
        const settings = configSnapshot.exists ? configSnapshot.data() : {};
        const holidays = settings.holidays || [];

        console.log(`\n### Resumo da Agenda - Semana de ${dates[0].split('-').reverse().join('/')} a ${dates[dates.length-1].split('-').reverse().join('/')}`);
        console.log(`| Data | Atendente (Paciente) | Responsável | Horário | Véspera (09:00) | Dia (06:30/12:30) |`);
        console.log(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

        for (const dateStr of dates) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d, 12, 0, 0); // Local date
            const dayOfWeekIndex = dateObj.getDay();
            const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            const diaDaSemanaAlvo = diasSemana[dayOfWeekIndex];

            const holidayObj = holidays.find(h => h.date === dateStr);
            if (holidayObj) {
                console.log(`| ${dateStr.split('-').reverse().join('/')} | --- FERIADO --- | ${holidayObj.name} | --- | --- | --- |`);
                continue;
            }

            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .get();
            
            const manualSessions = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const sessionsReais = manualSessions.filter(s => s.status === 'Agendada');

            const sessionsVirtuais = [];
            Object.values(patientsMap).forEach(p => {
                if (p.status !== 'Ativo') return;
                
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    const jaTemSessaoManual = manualSessions.some(s => s.patientId === p.id);
                    if (!jaTemSessaoManual) {
                        sessionsVirtuais.push({
                            patientId: p.id,
                            date: dateStr,
                            time: p.fixedTime.trim(),
                            status: 'Agendada',
                            isVirtual: true
                        });
                    }
                }
            });

            const allSessions = [...sessionsReais, ...sessionsVirtuais].sort((a, b) => a.time.localeCompare(b.time));

            if (allSessions.length === 0) {
                console.log(`| ${dateStr.split('-').reverse().join('/')} | (Sem agendamentos) | --- | --- | --- | --- |`);
                continue;
            }

            for (const s of allSessions) {
                const patient = patientsMap[s.patientId];
                if (!patient) continue;

                // Véspera logic
                const vesperaDate = new Date(dateObj);
                vesperaDate.setDate(vesperaDate.getDate() - 1);
                const vesperaDisplay = `${vesperaDate.getDate().toString().padStart(2, '0')}/${(vesperaDate.getMonth()+1).toString().padStart(2, '0')}/${vesperaDate.getFullYear()} 09:00`;
                
                // Dia logic
                const [hour] = s.time.split(':').map(Number);
                let diaTime = hour < 12 ? '06:30' : '12:30';
                let diaDisplay = `${dateStr.split('-').reverse().join('/')} ${diaTime}`;

                console.log(`| ${dateStr.split('-').reverse().join('/')} | ${patient.name} | ${patient.guardianName} | ${s.time} | ${vesperaDisplay} | ${diaDisplay} |`);
            }
        }
    }
    process.exit(0);
}

generateSummary();
