import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function checkDb() {
    console.log("=== DIAGNÓSTICO DO BANCO DE DADOS ===");
    const settingsConfigSnapshot = await db.collectionGroup('settings').get();
    
    for (const configDoc of settingsConfigSnapshot.docs) {
        const userId = configDoc.ref.parent.parent.id;
        console.log(`User ID: ${userId}`);
        
        // 1. Listar Pacientes
        const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
        console.log("\n--- PACIENTES ---");
        patientsSnapshot.forEach(doc => {
            const p = doc.data();
            console.log(`ID: ${doc.id} | Nome: ${p.name} | Status: ${p.status} | Dia Fixo: ${p.fixedDay} | Hora Fixa: ${p.fixedTime} | WhatsApp: ${p.whatsapp}`);
        });

        // 2. Listar todas as sessões cadastradas de 18/05/2026 a 24/05/2026
        const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
            .where('date', '>=', '2026-05-18')
            .where('date', '<=', '2026-05-24')
            .get();
        console.log("\n--- SESSÕES MANUAIS NA SEMANA DE 18/05 A 24/05 ---");
        sessionsSnapshot.forEach(doc => {
            const s = doc.data();
            console.log(`ID: ${doc.id} | Patient ID: ${s.patientId} | Data: ${s.date} | Hora: ${s.time} | Status: ${s.status}`);
        });
    }
}

checkDb().then(() => process.exit(0)).catch(console.error);
