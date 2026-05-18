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

async function generateReport() {
    console.log("=== RELATÓRIO DO ROBÔ WHATSAPP DA SEMANA ===");
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    // Simulate from Monday (May 18) to Saturday (May 23)
    const startDate = new Date('2026-05-18T12:00:00Z');
    
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        const patients = [];
        const patientsMap = {};
        patientsSnapshot.forEach(p => {
            const data = { id: p.id, ...p.data() };
            patients.push(data);
            patientsMap[p.id] = data;
        });
        
        for (let i = 0; i < 6; i++) {
            const loopDate = new Date(startDate);
            loopDate.setDate(loopDate.getDate() + i);
            const dateStr = loopDate.toISOString().split('T')[0];
            
            const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            const diaSemanaNome = diasSemana[loopDate.getDay()];
            
            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr).get();
            const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const sessionsReais = todasSessoesHoje.filter(s => s.status === 'Agendada');
            
            const sessionsVirtuais = [];
            patients.forEach(p => {
                if (p.status !== 'Ativo') return;
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = diaSemanaNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === p.id);
                    if (!jaTemSessaoManual) {
                        sessionsVirtuais.push({ patientId: p.id, date: dateStr, time: p.fixedTime, status: 'Agendada', isVirtual: true });
                    }
                }
            });
            
            const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
            
            // Agrupar igual ao server.js (por ID do paciente)
            const disparosUnicos = new Map();
            for (const s of todasAsSessoes) {
                const patient = patientsMap[s.patientId];
                if (!patient || !patient.whatsapp) continue;
                if (!disparosUnicos.has(patient.id) || s.time < disparosUnicos.get(patient.id).s.time) {
                    disparosUnicos.set(patient.id, { s, patient });
                }
            }
            
            if (disparosUnicos.size > 0) {
                console.log(`\n📅 ${diaSemanaNome.toUpperCase()} (${dateStr}):`);
                // Sort by time
                const disparosArray = Array.from(disparosUnicos.values()).sort((a,b) => a.s.time.localeCompare(b.s.time));
                disparosArray.forEach(({s, patient}) => {
                    console.log(`  - ${s.time} | ${patient.name} (Resp: ${patient.guardianName.trim()})`);
                });
            }
        }
    }
}

generateReport().then(() => process.exit(0)).catch(console.error);
