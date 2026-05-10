import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// 1. Inicializar Firebase Admin
const serviceAccountPath = path.resolve('./firebase-key.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error("ERRO CRÍTICO: Arquivo firebase-key.json não encontrado.");
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

// 2. Inicializar Cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

client.on('qr', (qr) => {
    console.log('SCANNEIE O QR CODE ABAIXO PELO SEU WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const formatPhoneNumber = (phoneStr) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) {
        clean = '55' + clean;
    }
    return `${clean}@c.us`;
};

async function dispararLembretes(tipo) {
    console.log(`\n[${new Date().toISOString()}] Forçando rotina de Lembretes: ${tipo}`);
    try {
        const settingsConfigSnapshot = await db.collectionGroup('settings').get();
        
        for (const configDoc of settingsConfigSnapshot.docs) {
            const userId = configDoc.ref.parent.parent.id;
            
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const dateStr = tipo === 'AMANHA' ? tomorrow.toISOString().split('T')[0] : today.toISOString().split('T')[0];
            
            const settingsSnapshot = await db.doc(`users/${userId}/settings/config`).get();
            const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
            
            const holidayObj = (settings.holidays || []).find(h => h.date === dateStr);
            if (holidayObj) {
                console.log(`[BLOQUEIO] Data ${dateStr} é feriado (${holidayObj.name}).`);
                continue;
            }

            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patientsMap = {};
            const patients = [];
            
            patientsSnapshot.forEach(p => {
                const data = { id: p.id, ...p.data() };
                patients.push(data);
                patientsMap[p.id] = data;
            });

            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .where('status', '==', 'Agendada')
                .get();
            
            const sessionsReais = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            const diaDaSemanaAlvo = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];
            
            const sessionsVirtuais = [];
            patients.forEach(p => {
                if (p.status !== 'Ativo') return;
                
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    const jaTemSessaoReal = sessionsReais.some(s => s.patientId === p.id);
                    if (!jaTemSessaoReal) {
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

            const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
            let sessoesParaAvisar = [];

            todasAsSessoes.forEach(s => {
                const [hour] = s.time.split(':').map(Number);
                if (tipo === 'HOJE_MANHA' && hour >= 12) return;
                if (tipo === 'HOJE_TARDE' && hour < 12) return;
                sessoesParaAvisar.push(s);
            });

            console.log(`[INFO] ${dateStr} (${tipo}): Encontradas ${sessoesParaAvisar.length} sessões.`);

            for (const s of sessoesParaAvisar) {
                const patient = patientsMap[s.patientId];
                if (!patient || !patient.whatsapp) continue;

                const [hour] = s.time.split(':').map(Number);
                const phone = formatPhoneNumber(patient.whatsapp);
                const saudacao = hour < 12 ? 'Bom dia' : 'Boa tarde';

                let message = '';
                if (tipo === 'AMANHA') {
                    message = `${saudacao}! Olá, ${patient.guardianName}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name}* amanhã, às *${s.time}*.\n\nAguardo sua confirmação,\nAté logo!`;
                } else {
                    message = `${saudacao}! Passando para confirmar nosso atendimento de hoje às *${s.time}*!\n\nAguardo vocês! 🙏`;
                }

                console.log(`[ENVIO] Enviando para ${patient.guardianName} (${phone})...`);
                try {
                    await client.sendMessage(phone, message);
                    console.log(`✅ Sucesso!`);
                } catch (e) {
                    console.error(`❌ Erro ao enviar para ${phone}:`, e.message);
                }
                await delay(3000); 
            }
        }
    } catch (error) {
        console.error("Erro ao disparar lembretes:", error);
    }
}

let executed = false;
client.on('ready', async () => {
    if (executed) return;
    executed = true;
    console.log('✅ Robô Conectado! Iniciando disparos manuais...');
    
    await dispararLembretes('HOJE_MANHA');
    await dispararLembretes('AMANHA');
    
    console.log('\n--- DISPAROS CONCLUÍDOS ---');
    console.log('Aguardando 5 segundos para encerrar...');
    await delay(5000);
    process.exit(0);
});

// Bypass visual
client.on('authenticated', () => {
    console.log('✅ Autenticado! Aguardando o WhatsApp ficar pronto...');
    setTimeout(async () => {
        if (!executed) {
            console.log('⚠️ Forçando execução (Bypass ready)...');
            client.emit('ready');
        }
    }, 30000);
});

client.initialize();
