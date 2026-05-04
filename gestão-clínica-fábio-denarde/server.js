import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import admin from 'firebase-admin';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

// 1. Inicializar Firebase Admin
const serviceAccountPath = path.resolve('./firebase-key.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error("ERRO CRÍTICO: Arquivo firebase-key.json não encontrado.");
    console.error("Por favor, gere a chave no Console do Firebase e salve na raiz do projeto com esse nome.");
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

import { getFirestore } from 'firebase-admin/firestore';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

// 2. Inicializar Cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('SCANNEIE O QR CODE ABAIXO PELO SEU WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Robô do WhatsApp 100% pronto (Evento Ready recebido)!');
});

client.on('authenticated', () => {
    console.log('✅ Sessão autenticada e salva!');
    // Bypass visual para tranquilizar o usuário, já que o evento 'ready' está bugado no WhatsApp
    setTimeout(() => {
        console.log('✅ Robô do WhatsApp conectado e rodando em segundo plano!');
        console.log('⏳ Aguardando os horários programados (06:30, 09:00 e 12:30) para disparar as mensagens...');
    }, 5000);
});

client.on('auth_failure', msg => {
    console.error('❌ Falha na autenticação', msg);
});

// Funções Auxiliares
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const formatPhoneNumber = (phoneStr) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) {
        clean = '55' + clean;
    }
    return `${clean}@c.us`;
};

// 3. Lógica Principal de Lembretes
async function dispararLembretes(tipo) {
    console.log(`[${new Date().toISOString()}] Iniciando rotina de Lembretes: ${tipo}`);
    try {
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        
        for (const configDoc of settingsConfigSnapshot.docs) {
            const userId = configDoc.ref.parent.parent.id;
            
            // Buscar dados de amanhã/hoje
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const dateStr = tipo === 'AMANHA' ? tomorrow.toISOString().split('T')[0] : today.toISOString().split('T')[0];
            
            // Buscar configurações para ler feriados e telefone do admin
            const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
            const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
            
            const holidayObj = (settings.holidays || []).find(h => h.date === dateStr);
            if (holidayObj) {
                console.log(`[BLOQUEIO] Data ${dateStr} é feriado (${holidayObj.name}). Disparos cancelados para ${tipo}.`);
                
                if (tipo === 'AMANHA' && settings.whatsapp) {
                    const clinicPhone = formatPhoneNumber(settings.whatsapp);
                    console.log(`Avisando administrador no WhatsApp ${clinicPhone}...`);
                    await client.sendMessage(clinicPhone, `*Lembrete do Robô*\n\nOlá! Lembrando que amanhã é feriado/recesso de *${holidayObj.name}*.\n\nO envio de mensagens automáticas de lembrete para os pacientes está suspenso para amanhã.`);
                }
                continue;
            }

            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .where('status', '==', 'Agendada')
                .get();

            if (sessionsSnapshot.empty) {
                console.log(`Sem sessões agendadas para ${dateStr} (Filtro: ${tipo})`);
                continue;
            }

            // Mapear pacientes para buscar os nomes
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patientsMap = {};
            patientsSnapshot.forEach(p => patientsMap[p.id] = p.data());

            let sessoesParaAvisar = [];

            sessionsSnapshot.forEach(doc => {
                const s = doc.data();
                const [hour] = s.time.split(':').map(Number);
                
                // Filtro de Turno
                if (tipo === 'HOJE_MANHA' && hour >= 12) return; // ignora tarde
                if (tipo === 'HOJE_TARDE' && hour < 12) return; // ignora manhã
                
                sessoesParaAvisar.push(s);
            });

            console.log(`Encontradas ${sessoesParaAvisar.length} sessões para avisar.`);

            for (const s of sessoesParaAvisar) {
                const patient = patientsMap[s.patientId];
                if (!patient || !patient.whatsapp) continue;

                const phone = formatPhoneNumber(patient.whatsapp);
                const saudacao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';

                let message = '';
                if (tipo === 'AMANHA') {
                    message = `${saudacao}! Olá, ${patient.guardianName}, tudo bem?\nPassando para lembrar você da sessão de ${patient.name} amanhã, às ${s.time}.\n\nAguardo sua confirmação,\nAté logo!`;
                } else {
                    message = `${saudacao}! Aguardo vocês hoje às ${s.time}!\nAté logo! 🙏`;
                }

                console.log(`Enviando para ${patient.guardianName} (${phone})...`);
                await client.sendMessage(phone, message);
                await delay(5000); // 5 segundos de pausa entre cada envio para evitar SPAM
            }
        }
    } catch (error) {
        console.error("Erro ao disparar lembretes:", error);
    }
}

// 4. Configurar os Alarmes (Cron Jobs)
// 06:30 da manhã - Lembretes para HOJE (sessões da manhã)
cron.schedule('30 6 * * *', () => {
    dispararLembretes('HOJE_MANHA');
});

// 09:00 da manhã - Lembretes para AMANHÃ (todas as sessões)
cron.schedule('0 9 * * *', () => {
    dispararLembretes('AMANHA');
});

// 12:30 da tarde - Lembretes para HOJE (sessões da tarde)
cron.schedule('30 12 * * *', () => {
    dispararLembretes('HOJE_TARDE');
});

// 5. Iniciar o Robô
client.initialize();
console.log("Robô iniciado! Aguardando o WhatsApp...");
