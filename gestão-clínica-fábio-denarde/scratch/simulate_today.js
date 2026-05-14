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

const formatPhoneNumber = (phoneStr) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) clean = '55' + clean;
    return `${clean}@c.us`;
};

async function simulate(tipo) {
    console.log(`\n--- SIMULATING: ${tipo} ---`);
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tipo === 'AMANHA' ? tomorrow.toISOString().split('T')[0] : today.toISOString().split('T')[0];

        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patientsMap = {};
        patientsSnapshot.forEach(p => patientsMap[p.id] = { id: p.id, ...p.data() });

        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '==', dateStr)
            .get();
        const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');

        const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
        const diaDaSemanaAlvo = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];
        
        const sessionsVirtuais = [];
        Object.values(patientsMap).forEach(p => {
            if (p.status !== 'Ativo') return;
            const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === p.id);
                if (!jaTemSessaoManual) {
                    sessionsVirtuais.push({ patientId: p.id, time: p.fixedTime, isVirtual: true });
                }
            }
        });

        const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
        let sessoesFiltradas = [];
        todasAsSessoes.forEach(s => {
            const [hour] = s.time.split(':').map(Number);
            if (tipo === 'HOJE_MANHA' && hour >= 12) return;
            if (tipo === 'HOJE_TARDE' && hour < 12) return;
            sessoesFiltradas.push(s);
        });

        const disparosUnicos = new Map();
        for (const s of sessoesFiltradas) {
            const patient = patientsMap[s.patientId];
            if (!patient || !patient.whatsapp) continue;
            const phone = formatPhoneNumber(patient.whatsapp);
            if (!disparosUnicos.has(phone) || s.time < disparosUnicos.get(phone).s.time) {
                disparosUnicos.set(phone, { s, patient });
            }
        }

        for (const [phone, { s, patient }] of disparosUnicos) {
            console.log(`[TARGET] Patient: ${patient.name}, Guardian: ${patient.guardianName}, Appt Time: ${s.time}, Date: ${dateStr}`);
        }
    }
}

async function run() {
    await simulate('AMANHA'); // Today at 09:00
    await simulate('HOJE_TARDE'); // Today at 12:30
}

run().then(() => process.exit(0));
