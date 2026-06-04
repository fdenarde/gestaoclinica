import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import admin from 'firebase-admin';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { formatPhoneNumber, getWhatsappReminderPlan } from './src/lib/whatsappReminderPlan.js';

// 0. Capturar rejeições não tratadas de promessas (como erros do Puppeteer/Chromium)
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Rejeição de Promessa Não Tratada detectada:', reason);
    const msg = reason && reason.message ? reason.message : '';
    if (msg.includes('detached') || 
        msg.includes('Protocol error') || 
        msg.includes('closed') || 
        msg.includes('session') ||
        msg.includes('frame')) {
        console.error('ERRO CRÍTICO DO BROWSER (UNHANDLED REJECTION). Reiniciando o robô para auto-recuperação...');
        process.exit(1);
    }
});

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

let whatsappReady = false;
let whatsappQrBlocked = false;

client.on('qr', (qr) => {
    whatsappReady = false;
    whatsappQrBlocked = true;
    if (process.env.ALLOW_WHATSAPP_QR === 'SIM') {
        console.log('SCANNEIE O QR CODE ABAIXO PELO SEU WHATSAPP:');
        qrcode.generate(qr, { small: true });
        return;
    }
    console.error('QR Code bloqueado por seguranca. A sessao atual nao sera reautenticada automaticamente.');
    console.error('Para permitir QR Code explicitamente, reinicie com ALLOW_WHATSAPP_QR=SIM.');
});

client.on('ready', () => {
    whatsappReady = true;
    whatsappQrBlocked = false;
    console.log('✅ Robô do WhatsApp 100% pronto (Evento Ready recebido)!');
});

client.on('authenticated', () => {
    whatsappReady = true;
    whatsappQrBlocked = false;
    console.log('✅ Sessão autenticada e salva!');
    // Bypass visual para tranquilizar o usuário, já que o evento 'ready' está bugado no WhatsApp
    setTimeout(() => {
        console.log('✅ Robô do WhatsApp conectado e rodando em segundo plano!');
        console.log('⏳ Aguardando os horários programados (06:30, 09:00 e 12:30) para disparar as mensagens...');
    }, 5000);
});

client.on('auth_failure', msg => {
    whatsappReady = false;
    console.error('❌ Falha na autenticação', msg);
});

client.on('disconnected', reason => {
    whatsappReady = false;
    console.error('❌ Cliente do WhatsApp desconectado:', reason);
    console.error('ERRO CRÍTICO DE CONEXÃO. Reiniciando o processo do robô para auto-recuperação...');
    process.exit(1);
});

// Funções Auxiliares
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const maskName = (name) => {
    if (!name || !name.trim()) return '(sem nome)';
    const first = name.trim().split(/\s+/)[0];
    return `${first[0]}***`;
};

const maskPhone = (phone) => {
    if (!phone || !phone.trim()) return '(sem telefone)';
    const digits = phone.replace(/\D/g, '');
    return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
};

// 3. Lógica Principal de Lembretes
async function dispararLembretes(tipo) {
    console.log(`[${new Date().toISOString()}] Iniciando rotina de Lembretes: ${tipo}`);
    if (!whatsappReady) {
        const reason = whatsappQrBlocked ? 'QR Code bloqueado/sem reautenticacao' : 'cliente WhatsApp ainda nao esta pronto';
        console.error(`[BLOQUEIO] Rotina ${tipo} cancelada: ${reason}. Nenhuma mensagem sera enviada.`);
        return;
    }

    try {
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        
        for (const configDoc of settingsConfigSnapshot.docs) {
            const userId = configDoc.ref.parent.parent.id;
            
            // Buscar dados de amanhã/hoje
            const today = new Date();
            let dateStr = today.toISOString().split('T')[0];
            if (tipo === 'AMANHA') {
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                dateStr = tomorrow.toISOString().split('T')[0];
            }
            
            // Buscar configurações para ler feriados e telefone do admin
            const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
            const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
            
            // 1. Buscar Pacientes (para mapear nomes e horários fixos)
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patients = [];
            patientsSnapshot.forEach(p => {
                patients.push({ id: p.id, ...p.data() });
            });

            // 2. Buscar Sessões Manuais da Data (Qualquer Status)
            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .get();
            
            const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // 3. Executar o plano de remessa centralizado
            const plan = getWhatsappReminderPlan({
                runDateStr: today.toISOString().split('T')[0],
                tipo,
                patients,
                sessions: todasSessoesHoje,
                settings
            });

            if (plan.isHoliday) {
                console.log(`[BLOQUEIO] Data ${plan.dateStr} é feriado (${plan.holidayName}). Disparos cancelados para ${tipo}.`);
                
                if (tipo === 'AMANHA' && settings.whatsapp) {
                    const clinicPhone = formatPhoneNumber(settings.whatsapp);
                    console.log(`Avisando administrador no WhatsApp ${maskPhone(clinicPhone)}...`);
                    await client.sendMessage(clinicPhone, `*Lembrete do Robô*\n\nOlá! Lembrando que amanhã é feriado/recesso de *${plan.holidayName.trim()}*.\n\nO envio de mensagens automáticas de lembrete para os pacientes está suspenso para amanhã.`);
                }
                continue;
            }

            console.log(`[INFO] ${plan.dateStr} (${tipo}): ${plan.reminders.length} mensagens únicas para enviar.`);

            for (const r of plan.reminders) {
                console.log(`[ENVIO] Enviando para ${maskName(r.guardianName)} (${maskPhone(r.phone)})...`);
                try {
                    await client.sendMessage(r.phone, r.message);
                } catch (sendError) {
                    console.error(`❌ Erro ao enviar para ${maskPhone(r.phone)}:`, sendError.message);
                    if (sendError.message.includes('detached') || 
                        sendError.message.includes('Protocol error') || 
                        sendError.message.includes('closed') || 
                        sendError.message.includes('session') ||
                        sendError.message.includes('frame')) {
                        console.error('ERRO CRÍTICO DE NAVEGADOR DETECTADO. Reiniciando o processo do robô...');
                        process.exit(1);
                    }
                }
                await delay(5000); 
            }

        }
    } catch (error) {
        console.error("Erro crítico na rotina de lembretes:", error);
    }
}

// 4. Configurar os Alarmes (Cron Jobs)
// 06:30 da manhã - Lembretes para HOJE (sessões da manhã)
cron.schedule('30 6 * * *', () => {
    const today = new Date();
    if (today.getDay() === 0) return; // Pula Domingo
    dispararLembretes('HOJE_MANHA');
});

// 09:00 da manhã - Lembretes para AMANHÃ (todas as sessões)
cron.schedule('0 9 * * *', () => {
    const today = new Date();
    if (today.getDay() === 6) {
        console.log(`[PULO] Hoje é Sábado. Não há atendimentos amanhã (Domingo).`);
        return;
    }
    dispararLembretes('AMANHA');
});

// 12:30 da tarde - Lembretes para HOJE (sessões da tarde)
cron.schedule('30 12 * * *', () => {
    const today = new Date();
    if (today.getDay() === 0) return; // Pula Domingo
    dispararLembretes('HOJE_TARDE');
});

// 5. Iniciar o Robô
client.initialize().catch(err => {
    console.error("❌ ERRO AO INICIALIZAR O CLIENTE WHATSAPP:", err.message);
    console.error("Dica: Verifique se não há outra instância do navegador aberta ou se a pasta .wwebjs_auth está travada.");
});
console.log("Robô iniciado! Aguardando o WhatsApp...");
