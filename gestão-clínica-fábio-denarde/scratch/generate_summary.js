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
    const today = new Date('2026-05-15T12:00:00'); // Based on user context
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 5); // Saturday

    const dates = [];
    for (let d = new Date(startOfWeek); d <= endOfWeek; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d).toISOString().split('T')[0]);
    }

    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        
        // Patients
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patientsMap = {};
        patientsSnapshot.forEach(p => {
            patientsMap[p.id] = { id: p.id, ...p.data() };
        });

        // Config for holidays
        const configSnapshot = await db.doc(`users/${userId}/settings/config`).get();
        const settings = configSnapshot.exists ? configSnapshot.data() : {};
        const holidays = settings.holidays || [];

        console.log(`\n### Resumo da Agenda - Semana de ${dates[0].split('-').reverse().join('/')} a ${dates[dates.length-1].split('-').reverse().join('/')}`);
        console.log(`| Data | Atendente (Paciente) | Responsável | Horário | Véspera (09:00) | Dia (06:30/12:30) |`);
        console.log(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

        for (const dateStr of dates) {
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

            const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            const dayOfWeekIndex = new Date(dateStr + 'T12:00:00').getDay();
            const diaDaSemanaAlvo = diasSemana[dayOfWeekIndex];

            const sessionsVirtuais = [];
            Object.values(patientsMap).forEach(p => {
                if (p.status !== 'Ativo') return;
                
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    const jaTemSessaoManual = manualSessions.some(s => s.patientId === p.id);
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

            const allSessions = [...sessionsReais, ...sessionsVirtuais].sort((a, b) => a.time.localeCompare(b.time));

            if (allSessions.length === 0) {
                console.log(`| ${dateStr.split('-').reverse().join('/')} | (Sem agendamentos) | --- | --- | --- | --- |`);
                continue;
            }

            for (const s of allSessions) {
                const patient = patientsMap[s.patientId];
                if (!patient) continue;

                // Véspera logic
                const vesperaDate = new Date(dateStr + 'T12:00:00');
                vesperaDate.setDate(vesperaDate.getDate() - 1);
                const vesperaDay = vesperaDate.getDay();
                let vesperaTime = '09:00';
                
                // If session is on Monday (1), vespera is Sunday (0). server.js sends on Sunday.
                // If session is on Sunday (0), vespera is Saturday (6). server.js skips if today is Saturday.
                let vesperaDisplay = `${vesperaDate.toISOString().split('T')[0].split('-').reverse().join('/')} 09:00`;
                
                if (dayOfWeekIndex === 0) { // Sunday session (unlikely)
                    vesperaDisplay = 'Não enviado (Sábado)';
                }

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
