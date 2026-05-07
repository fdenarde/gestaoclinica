import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const serviceAccountPath = path.resolve('./firebase-key.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error("Erro: firebase-key.json não encontrado.");
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Usando o mesmo banco de dados do server.js
const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function simularMensagens() {
    console.log("=========================================");
    console.log("   RELATÓRIO DE SINCRONIZAÇÃO DO ROBÔ");
    console.log("   Sexta-feira e Sábado (Fim de Semana)");
    console.log("=========================================\n");

    try {
        // Buscar pacientes globalmente para o mapeamento
        const patientsSnapshot = await db.collectionGroup('patients').get();
        const patientsMap = {};
        patientsSnapshot.forEach(p => patientsMap[p.id] = p.data());

        // Buscar configurações globalmente para verificar feriados
        const settingsSnapshot = await db.collectionGroup('settings').get();
        const holidaysMap = {};
        settingsSnapshot.forEach(s => {
            const data = s.data();
            const userId = s.ref.parent.parent.id;
            holidaysMap[userId] = data.holidays || [];
        });

        // Datas de interesse
        const dias = [
            { label: 'SEXTA-FEIRA', date: '2026-05-08' },
            { label: 'SÁBADO', date: '2026-05-09' }
        ];

        for (const dia of dias) {
            console.log(`\n📅 VERIFICANDO: ${dia.label} (${dia.date})`);
            
            const sessionsSnapshot = await db.collectionGroup('sessions')
                .where('date', '==', dia.date)
                .where('status', '==', 'Agendada')
                .get();

            if (sessionsSnapshot.empty) {
                console.log("   (Nenhuma sessão agendada)");
                continue;
            }

            sessionsSnapshot.forEach(doc => {
                const s = doc.data();
                const userId = doc.ref.parent.parent.id;
                const patient = patientsMap[s.patientId];
                
                if (!patient) return;

                const [hour] = s.time.split(':').map(Number);
                const holidays = holidaysMap[userId] || [];
                const isHoliday = holidays.find(h => h.date === dia.date);

                if (isHoliday) {
                    console.log(`\n   [BLOQUEADO] Feriado detectado: ${isHoliday.name}`);
                    console.log(`   Paciente: ${patient.name}`);
                    return;
                }

                console.log(`\n   ✅ PACIENTE: ${patient.name}`);
                console.log(`      Responsável: ${patient.guardianName}`);
                console.log(`      Horário da Sessão: ${s.time}`);
                
                // Programação do Robô
                console.log(`      --- Programação de Mensagens ---`);
                
                // Regra de Amanhã (Alarme das 09:00 do dia anterior)
                const diaLembreteVespera = new Date(dia.date);
                diaLembreteVespera.setDate(diaLembreteVespera.getDate() - 1);
                const diaVesperaStr = diaLembreteVespera.toISOString().split('T')[0];
                console.log(`      1. Lembrete de Véspera: ${diaVesperaStr} às 09:00`);
                
                // Regra de Hoje (Alarme das 06:30 ou 12:30)
                const alarmeHoje = hour < 12 ? '06:30' : '12:30';
                console.log(`      2. Confirmação de Hoje: ${dia.date} às ${alarmeHoje}`);
            });
        }

        console.log("\n=========================================");
    } catch (error) {
        console.error("Erro ao gerar relatório:", error);
    }
}

simularMensagens();
