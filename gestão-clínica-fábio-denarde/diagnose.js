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

async function diagnose() {
    console.log("--- Diagnóstico de Mensagens ---");
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    console.log("Data de amanhã:", dateStr);

    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    console.log("Configurações encontradas:", settingsConfigSnapshot.size);

    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        console.log("Processando usuário:", userId);

        const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
        const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
        
        const holidayObj = (settings.holidays || []).find(h => h.date === dateStr);
        if (holidayObj) {
            console.log("BLOQUEIO: Amanhã é feriado:", holidayObj.name);
            continue;
        }

        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patients = patientsSnapshot.docs.map(p => ({ id: p.id, ...p.data() }));
        const patientsMap = {};
        patientsSnapshot.forEach(p => patientsMap[p.id] = p.data());
        console.log("Pacientes ativos:", patients.filter(p => p.status === 'Ativo').length);

        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '==', dateStr)
            .where('status', '==', 'Agendada')
            .get();
        console.log("Sessões reais para amanhã:", sessionsSnapshot.size);

        const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
        const diaDaSemanaAlvo = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];
        console.log("Dia da semana alvo:", diaDaSemanaAlvo);

        const sessionsVirtuais = [];
        patients.forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                const jaTemSessaoReal = sessionsSnapshot.docs.some(s => s.data().patientId === p.id);
                if (!jaTemSessaoReal) {
                    sessionsVirtuais.push({ patientId: p.id, time: p.fixedTime });
                }
            }
        });
        console.log("Sessões virtuais para amanhã:", sessionsVirtuais.length);

        const total = sessionsSnapshot.size + sessionsVirtuais.length;
        console.log("Total de mensagens que deveriam ter sido enviadas:", total);
        
        if (total > 0) {
            console.log("Listagem:");
            sessionsSnapshot.docs.forEach(s => {
                const p = patientsMap[s.data().patientId];
                console.log(`- [REAL] ${p ? p.name : 'Unknown'} as ${s.data().time}`);
            });
            sessionsVirtuais.forEach(v => {
                const p = patientsMap[v.patientId];
                console.log(`- [VIRTUAL] ${p ? p.name : 'Unknown'} as ${v.time}`);
            });
        }
    }
}

diagnose().then(() => process.exit(0));
