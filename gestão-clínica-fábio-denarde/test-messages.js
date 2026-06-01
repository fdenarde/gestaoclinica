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

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function gerarRelatorioSemanal() {
    console.log("=========================================");
    console.log("   RELATÓRIO SEMANAL (SINCRONIZADO)");
    console.log("   Sessões Reais + Horários Fixos");
    console.log("=========================================\n");

    try {
        const patientsSnapshot = await db.collectionGroup('patients').get();
        const patients = [];
        const patientsMap = {};
        patientsSnapshot.forEach(p => {
            const data = { id: p.id, ...p.data() };
            patients.push(data);
            patientsMap[p.id] = data;
        });

        const settingsSnapshot = await db.collectionGroup('settings').get();
        const holidaysMap = {};
        settingsSnapshot.forEach(s => {
            const data = s.data();
            const userId = s.ref.parent.parent.id;
            holidaysMap[userId] = data.holidays || [];
        });

        const hoje = new Date();
        const dias = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(hoje);
            d.setDate(hoje.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            dias.push({ 
                label: dayNames[d.getDay()].toUpperCase(), 
                date: dateStr,
                dayKey: dayNames[d.getDay()],
                dayIndex: d.getDay()
            });
        }

        const diasUteis = dias.filter(d => [1, 2, 3, 4, 5, 6].includes(d.dayIndex));

        for (const dia of diasUteis) {
            const firstUserId = Object.keys(holidaysMap)[0];
            const isHoliday = firstUserId ? (holidaysMap[firstUserId] || []).find(h => h.date === dia.date) : null;
            
            if (isHoliday) {
                console.log(`\n📅 ${dia.label} (${dia.date})`);
                console.log(`   🚫 [FERIADO/RECESSO] ${isHoliday.name.trim()} - Mensagens automáticas suspensas.`);
                continue;
            }

            console.log(`\n📅 ${dia.label} (${dia.date})`);
            
            // 1. Sessões Reais
            const sessionsSnapshot = await db.collectionGroup('sessions')
                .where('date', '==', dia.date)
                .where('status', '==', 'Agendada')
                .get();

            const sessionsReais = sessionsSnapshot.docs.map(doc => doc.data());
            
            // 2. Sessões Virtuais (Horários Fixos)
            const sessionsVirtuais = [];
            patients.forEach(p => {
                if (p.status !== 'Ativo') return;
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = dia.dayKey.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    const jaTemSessaoReal = sessionsReais.some(s => s.patientId === p.id);
                    if (!jaTemSessaoReal) {
                        sessionsVirtuais.push({
                            patientId: p.id,
                            time: p.fixedTime,
                            isVirtual: true
                        });
                    }
                }
            });

            const todas = [...sessionsReais, ...sessionsVirtuais];

            if (todas.length === 0) {
                console.log("   (Sem agendamentos)");
                continue;
            }

            todas.sort((a, b) => a.time.localeCompare(b.time));

            todas.forEach(s => {
                const patient = patientsMap[s.patientId];
                if (!patient) return;

                const isHoliday = (holidaysMap[patient.userId] || []).find(h => h.date === dia.date);
                if (isHoliday) {
                    console.log(`   🚫 [FERIADO] - ${patient.name} (${s.time})`);
                    return;
                }

                const [hour] = s.time.split(':').map(Number);
                const alarmeHoje = hour < 12 ? '06:30' : '12:30';
                const tag = s.isVirtual ? '[FIXO]' : '[MANUAL]';

                console.log(`   ✅ ${tag} ${patient.name} (${patient.guardianName}) - ${s.time}`);
                console.log(`      └─ Confirmação: ${alarmeHoje} do próprio dia`);
            });
        }

        console.log("\n=========================================");
    } catch (error) {
        console.error("Erro no relatório:", error);
    }
}

gerarRelatorioSemanal();
