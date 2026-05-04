import admin from 'firebase-admin';
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

const db = admin.firestore();

async function simularMensagens() {
    console.log("=========================================");
    console.log("   MODO DE TESTE (Nenhuma mensagem será enviada)");
    console.log("=========================================\n");

    try {
        const usersSnapshot = await db.collection('users').get();
        
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const todayStr = today.toISOString().split('T')[0];
            const tomorrowStr = tomorrow.toISOString().split('T')[0];

            // Buscar configurações para verificar feriados
            const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
            const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
            const holidays = settings.holidays || [];

            // Buscar pacientes
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patientsMap = {};
            patientsSnapshot.forEach(p => patientsMap[p.id] = p.data());

            // Buscar sessões de hoje
            const sessionsToday = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', todayStr)
                .where('status', '==', 'Agendada')
                .get();

            // Buscar sessões de amanhã
            const sessionsTomorrow = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', tomorrowStr)
                .where('status', '==', 'Agendada')
                .get();

            console.log(`📅 LENDO AGENDAMENTOS DE HOJE (${todayStr}):`);
            const todayHoliday = holidays.find(h => h.date === todayStr);
            if (todayHoliday) {
                console.log(`  [BLOQUEADO] Hoje é feriado/recesso: ${todayHoliday.name}. Nenhuma mensagem será enviada.`);
            } else if (sessionsToday.empty) {
                console.log("   (Nenhuma sessão agendada para hoje)");
            } else {
                sessionsToday.forEach(doc => {
                const s = doc.data();
                const patient = patientsMap[s.patientId];
                if (!patient) return;
                
                const [hour] = s.time.split(':').map(Number);
                const turno = hour < 12 ? 'Manhã (Alarme 06:30)' : 'Tarde (Alarme 12:30)';
                const saudacao = hour < 12 ? 'Bom dia' : 'Boa tarde';
                const msg = `${saudacao}! Aguardo vocês hoje às ${s.time}!\nAté logo! 🙏`;
                
                console.log(`\n  Turno: ${turno}`);
                console.log(`  Para: ${patient.guardianName} (Responsável por ${patient.name})`);
                console.log(`  Mensagem que será gerada:\n   "${msg.replace(/\n/g, ' ')}"`);
            });
            }

            console.log(`\n📅 LENDO AGENDAMENTOS DE AMANHÃ (${tomorrowStr}):`);
            const tomorrowHoliday = holidays.find(h => h.date === tomorrowStr);
            if (tomorrowHoliday) {
                console.log(`  [BLOQUEADO] Amanhã é feriado/recesso: ${tomorrowHoliday.name}. Nenhuma mensagem será enviada aos pacientes.`);
                if (settings.whatsapp) {
                    console.log(`  [AVISO] Uma mensagem de aviso de feriado será enviada para o administrador (${settings.whatsapp}).`);
                }
            } else if (sessionsTomorrow.empty) {
                console.log("   (Nenhuma sessão agendada para amanhã)");
            } else {
                sessionsTomorrow.forEach(doc => {
                const s = doc.data();
                const patient = patientsMap[s.patientId];
                if (!patient) return;
                
                const saudacao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
                const msg = `${saudacao}! Olá, ${patient.guardianName}, tudo bem?\nPassando para lembrá-la do atendimento do(a) ${patient.name} amanhã, às ${s.time}.\n\nAguardo sua confirmação,\nAté logo!`;
                
                console.log(`\n  Alarme: 09:00 de hoje`);
                console.log(`  Para: ${patient.guardianName} (Responsável por ${patient.name})`);
                console.log(`  Mensagem que será gerada:\n   "${msg.replace(/\n/g, ' ')}"`);
            });
            }
            console.log("\n=========================================");
        }
    } catch (error) {
        console.error("Erro no teste:", error);
    }
}

simularMensagens();
