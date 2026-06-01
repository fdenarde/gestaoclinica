import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import admin from 'firebase-admin';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

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

client.on('disconnected', reason => {
    console.error('❌ Cliente do WhatsApp desconectado:', reason);
    console.error('ERRO CRÍTICO DE CONEXÃO. Reiniciando o processo do robô para auto-recuperação...');
    process.exit(1);
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

const normalizeStr = (s) => {
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};

const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return timeStr;
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
};

const addOneHour = (timeStr) => {
    if (!timeStr) return '';
    const [hour, min] = timeStr.split(':').map(Number);
    const newHour = (hour + 1) % 24;
    return `${String(newHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const getDayOfWeekName = (dateStr) => {
    const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dayIndex = new Date(dateStr + 'T12:00:00').getDay();
    return diasSemana[dayIndex];
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
                    await client.sendMessage(clinicPhone, `*Lembrete do Robô*\n\nOlá! Lembrando que amanhã é feriado/recesso de *${holidayObj.name.trim()}*.\n\nO envio de mensagens automáticas de lembrete para os pacientes está suspenso para amanhã.`);
                }
                continue;
            }

            // 1. Buscar Pacientes (para mapear nomes e horários fixos)
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patients = [];
            const patientsMap = {};
            
            patientsSnapshot.forEach(p => {
                const data = { id: p.id, ...p.data() };
                patients.push(data);
                patientsMap[p.id] = data;
            });

            // 2. Buscar Sessões Manuais da Data (Qualquer Status)
            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .get();
            
            const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Considerar apenas as "Agendada" para envio de lembrete real
            // Mas ignorar sessões obsoletas que não correspondem à configuração cadastral atual do paciente, a menos que sejam exceções manuais (reposição/extra)
            const sessionsReais = todasSessoesHoje.filter(s => {
                if (s.status !== 'Agendada') return false;
                
                const patient = patientsMap[s.patientId];
                if (!patient) return true; // manter se não achar o paciente para ser seguro
                
                if (patient.status !== 'Ativo') return false;

                // Verificar se bate com o dia/horário fixo atual
                const sessionDayOfWeek = getDayOfWeekName(s.date);
                const isMatchingDay = normalizeStr(sessionDayOfWeek) === normalizeStr(patient.fixedDay || '');
                const isMatchingTime = normalizeTime(s.time) === normalizeTime(patient.fixedTime) ||
                                       (patient.doubleSession && normalizeTime(s.time) === normalizeTime(addOneHour(patient.fixedTime)));
                
                if (isMatchingDay && isMatchingTime) {
                    return true;
                }

                // Se não bater com o fixo atual, verificar se é exceção manual (reposição ou extra)
                const isReposition = s.packageNumber === 0;
                const notesLower = (s.notes || '').toLowerCase();
                const isManualNotes = notesLower.includes('reposição') || notesLower.includes('reposicao') || notesLower.includes('extra') || notesLower.includes('manual');
                
                if (isReposition || isManualNotes) {
                    return true; // mantém exceções manuais!
                }

                // Caso contrário, é obsoleta! Ignorar.
                console.log(`[ROBO] Desprezando sessão obsoleta detectada para ${patient.name} em ${s.date} ${s.time} (Fixo atual: ${patient.fixedDay} ${patient.fixedTime})`);
                return false;
            });

            // 3. Gerar Sessões Virtuais (Baseadas no Horário Fixo dos pacientes ativos)
            const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
            const diaDaSemanaAlvo = diasSemana[new Date(dateStr + 'T12:00:00').getDay()];
            
            const sessionsVirtuais = [];
            patients.forEach(p => {
                if (p.status !== 'Ativo') return;
                
                const fixedDayNorm = (p.fixedDay || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const targetDayNorm = diaDaSemanaAlvo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                    // Impede o envio de mensagem se o paciente tem registro manual hoje EXATAMENTE no mesmo horário (ex: Falta, Desmarcada no horário fixo)
                    const jaTemSessaoManual = todasSessoesHoje.some(s => s.patientId === p.id && s.time === p.fixedTime);
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

            // 4. Unificar as sessões e aplicar Filtro de Turno
            const todasAsSessoes = [...sessionsReais, ...sessionsVirtuais];
            let sessoesFiltradas = [];

            todasAsSessoes.forEach(s => {
                const [hour] = s.time.split(':').map(Number);
                if (tipo === 'HOJE_MANHA' && hour >= 12) return;
                if (tipo === 'HOJE_TARDE' && hour < 12) return;
                sessoesFiltradas.push(s);
            });

            // 5. Agrupar por paciente para enviar apenas 1 mensagem mesmo em sessão dupla (pegar o horário mais cedo)
            const disparosUnicos = new Map();
            for (const s of sessoesFiltradas) {
                const patient = patientsMap[s.patientId];
                if (!patient || !patient.whatsapp) continue;
                
                const phone = formatPhoneNumber(patient.whatsapp);
                // Agrupa pelo ID do paciente, não apenas pelo telefone.
                // Assim, sessões duplas/consecutivas do MESMO paciente geram 1 só mensagem.
                // Mas dois irmãos (pacientes diferentes) com o MESMO telefone recebem 2 mensagens.
                if (!disparosUnicos.has(patient.id) || s.time < disparosUnicos.get(patient.id).s.time) {
                    disparosUnicos.set(patient.id, { s, patient, phone });
                }
            }

            console.log(`[INFO] ${dateStr} (${tipo}): ${disparosUnicos.size} mensagens únicas para enviar.`);

            for (const { s, patient, phone } of disparosUnicos.values()) {
                const currentHour = new Date().getHours();
                const saudacao = currentHour < 12 ? 'Bom dia' : 'Boa tarde';
                
                // Formata 14:00 -> 14h, 14:30 -> 14:30h
                const horaFormatada = s.time.endsWith(':00') ? s.time.split(':')[0] + 'h' : s.time + 'h';

                let message = '';
                if (tipo === 'AMANHA') {
                    message = `${saudacao}! Olá, ${patient.guardianName.trim()}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n\nAguardo sua confirmação,\nAté logo!`;
                } else {
                    message = `${saudacao}!\nAguardo vocês hoje às *${horaFormatada}*!\nAté logo! 🙏🏼`;
                }

                console.log(`[ENVIO] Enviando para ${patient.guardianName} (${phone})...`);
                try {
                    await client.sendMessage(phone, message);
                } catch (sendError) {
                    console.error(`❌ Erro ao enviar para ${phone}:`, sendError.message);
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
