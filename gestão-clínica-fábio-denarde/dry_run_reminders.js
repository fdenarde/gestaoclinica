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

async function dryRun() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patientsMap = {};
        patientsSnapshot.forEach(p => patientsMap[p.id] = p.data());

        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '==', dateStr)
            .get();

        const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');

        const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
        const diaDaSemanaAlvo = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];

        const sessionsVirtuais = [];
        patientsSnapshot.forEach(pDoc => {
            const p = pDoc.data();
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === pDoc.id);
                if (!jaTemSessaoManual) sessionsVirtuais.push({ patientId: pDoc.id, time: p.fixedTime });
            }
        });

        const total = sessionsReais.length + sessionsVirtuais.length;
        console.log(`\n--- PENDENTES PARA AMANHÃ (${dateStr}) ---`);
        if (total === 0) {
            console.log("Nenhuma mensagem pendente.");
        } else {
            sessionsReais.forEach(s => {
                const p = patientsMap[s.patientId];
                console.log(`MENSAGEM: Olá, ${p.guardianName}! Lembrando da sessão de ${p.name} amanhã às ${s.time}.`);
            });
            sessionsVirtuais.forEach(v => {
                const p = patientsMap[v.patientId];
                console.log(`MENSAGEM: Olá, ${p.guardianName}! Lembrando da sessão de ${p.name} amanhã às ${v.time}.`);
            });
        }
    }
}

dryRun().then(() => process.exit(0));
