const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.resolve('./firebase-key.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

async function getWeeklySummary() {
    console.log('--- Resumo de Mensagens WhatsApp (Semana 11/05 a 17/05) ---\n');
    
    try {
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        
        for (const configDoc of settingsConfigSnapshot.docs) {
            const userId = configDoc.ref.parent.parent.id;
            console.log(`Clínica: ${configDoc.data().name || userId}\n`);

            // 1. Buscar todos os pacientes
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patientsMap = {};
            const activePatients = [];
            
            patientsSnapshot.forEach(p => {
                const data = { id: p.id, ...p.data() };
                patientsMap[p.id] = data;
                if (data.status === 'Ativo') {
                    activePatients.push(data);
                }
            });

            // 2. Definir os dias da semana
            const dates = [
                '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14',
                '2026-05-15', '2026-05-16', '2026-05-17'
            ];
            const diasSemanaNomes = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

            for (let i = 0; i < dates.length; i++) {
                const dateStr = dates[i];
                const diaNome = diasSemanaNomes[i];
                console.log(`> ${diaNome.toUpperCase()} (${dateStr})`);

                // Buscar sessões manuais para este dia
                const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                    .where('date', '==', dateStr)
                    .get();
                
                const manualSessions = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const sessionsReais = manualSessions.filter(s => s.status === 'Agendada');

                // Calcular sessões virtuais (recorrência)
                const sessionsVirtuais = [];
                activePatients.forEach(p => {
                    const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    const targetDayNorm = diaNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

                const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais].sort((a, b) => a.time.localeCompare(b.time));

                if (todasAsSessoes.length === 0) {
                    console.log('  (Nenhum atendimento agendado)\n');
                    continue;
                }

                todasAsSessoes.forEach(s => {
                    const patient = patientsMap[s.patientId];
                    if (!patient) return;

                    const [hour] = s.time.split(':').map(Number);
                    const remDiaHora = hour < 12 ? '06:30' : '12:30';
                    
                    // Cálculo da véspera
                    const d = new Date(dateStr + 'T12:00:00');
                    d.setDate(d.getDate() - 1);
                    const vesperaStr = d.toISOString().split('T')[0];

                    console.log(`  - ${patient.name} (Resp: ${patient.guardianName})`);
                    console.log(`    Atendimento: ${s.time}`);
                    console.log(`    Lembrete Véspera: ${vesperaStr} às 09:00`);
                    console.log(`    Lembrete do Dia: ${dateStr} às ${remDiaHora}`);
                });
                console.log('');
            }
        }
    } catch (error) {
        console.error('Erro ao gerar resumo:', error);
    }
}

getWeeklySummary();
