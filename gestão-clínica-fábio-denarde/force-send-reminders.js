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

function getSessionsForDate({ dateStr, patients, sessions, settings }) {
    const processed = [];
    
    // Parse target day of week in Portuguese
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayIndex = dateObj.getDay();
    const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dayKey = dayNames[dayIndex];
    
    // Check if holiday
    const holiday = (settings.holidays || []).find(h => h.date === dateStr);
    
    // 1. Process Real Sessions
    const dbSessions = sessions.filter(s => s.date === dateStr);
    for (const s of dbSessions) {
        if (s.isBlocked) {
            processed.push({
                ...s,
                isVirtual: false,
                isValid: false,
                blockedReason: 'sessão manual bloqueadora'
            });
            continue;
        }
        
        const patient = patients.find(p => p.id === s.patientId);
        if (!patient) {
            processed.push({
                ...s,
                isVirtual: false,
                isValid: false,
                blockedReason: 'paciente inativo'
            });
            continue;
        }
        
        let blockedReason = null;
        if (holiday) {
            blockedReason = 'feriado/recesso';
        } else if (patient.status !== 'Ativo') {
            blockedReason = 'paciente inativo';
        } else if (s.status === 'Cancelada') {
            blockedReason = 'sessão cancelada';
        } else if (!patient.whatsapp || !patient.whatsapp.trim()) {
            blockedReason = 'paciente sem WhatsApp';
        } else if (s.status !== 'Agendada') {
            blockedReason = 'status inválido';
        }
        
        processed.push({
            ...s,
            isVirtual: false,
            isValid: !blockedReason,
            blockedReason: blockedReason || undefined
        });
    }
    
    // 2. Process Virtual Sessions
    if (!holiday) {
        for (const p of patients) {
            if (p.status !== 'Ativo') continue;
            
            const fixedDayNorm = normalizeStr(p.fixedDay).replace('-feira', '');
            const targetDayNorm = normalizeStr(dayKey).replace('-feira', '');
            
            if (fixedDayNorm === targetDayNorm && p.fixedTime) {
                const time1 = p.fixedTime;
                // Check if a real manual session exists for this patient, date, and time
                const hasManual1 = dbSessions.some(
                  s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time1)
                );
                if (!hasManual1) {
                    const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : null;
                    processed.push({
                        id: `virtual-${p.id}-${dateStr}-${time1}`,
                        patientId: p.id,
                        date: dateStr,
                        time: time1,
                        type: p.doubleSession ? 'Sessão dupla (2 × 50 min)' : 'Sessão simples (50 min)',
                        status: 'Agendada',
                        notes: '',
                        packageNumber: 0,
                        isVirtual: true,
                        isValid: !blockedReason,
                        blockedReason: blockedReason || undefined
                    });
                }
                
                if (p.doubleSession) {
                    const time2 = addOneHour(p.fixedTime);
                    const hasManual2 = dbSessions.some(
                      s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time2)
                    );
                    if (!hasManual2) {
                        const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : null;
                        processed.push({
                            id: `virtual-${p.id}-${dateStr}-${time2}`,
                            patientId: p.id,
                            date: dateStr,
                            time: time2,
                            type: 'Sessão dupla (2 × 50 min)',
                            status: 'Agendada',
                            notes: '',
                            packageNumber: 0,
                            isVirtual: true,
                            isValid: !blockedReason,
                            blockedReason: blockedReason || undefined
                        });
                    }
                }
            }
        }
    }
    
    processed.sort((a, b) => a.time.localeCompare(b.time));
    return processed;
}

function getWhatsappReminderPlan({ runDateStr, tipo, patients, sessions, settings }) {
    // 1. Calculate target date
    let dateStr = runDateStr;
    if (tipo === 'AMANHA') {
        const d = new Date(runDateStr + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        dateStr = d.toISOString().split('T')[0];
    }
    
    const holiday = (settings.holidays || []).find(h => h.date === dateStr);
    if (holiday) {
        return {
            dateStr,
            isHoliday: true,
            holidayName: holiday.name,
            reminders: [],
            diagnostics: [
                {
                    id: `holiday-${dateStr}`,
                    time: '00:00',
                    patientName: 'Feriado/Recesso',
                    type: 'Bloqueio',
                    isVirtual: false,
                    isValid: false,
                    blockedReason: `feriado/recesso (${holiday.name.trim()})`
                }
            ]
        };
    }
    
    // 2. Retrieve all sessions using getSessionsForDate
    const daySessions = getSessionsForDate({ dateStr, patients, sessions, settings });
    
    const reminders = [];
    const diagnostics = [];
    
    // Standard phone format helper
    const formatPhoneNumber = (phoneStr) => {
        let clean = phoneStr.replace(/\D/g, '');
        if (!clean.startsWith('55')) {
            clean = '55' + clean;
        }
        return `${clean}@c.us`;
    };
    
    // Candidate sessions after shift/turn filtering
    const candidates = [];
    
    for (const s of daySessions) {
        const patient = patients.find(p => p.id === s.patientId);
        
        if (!s.isValid) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient ? patient.name : (s.blockName || 'Compromisso'),
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: s.blockedReason || 'desconhecido'
            });
            continue;
        }
        
        // Validate shift/turn filter
        const [hour] = s.time.split(':').map(Number);
        if (tipo === 'HOJE_MANHA' && hour >= 12) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'fora do turno (Sessão da tarde)'
            });
            continue;
        }
        
        if (tipo === 'HOJE_TARDE' && hour < 12) {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'fora do turno (Sessão da manhã)'
            });
            continue;
        }
        
        candidates.push(s);
    }
    
    // 3. Group by patientId to pick the earliest time
    const selectedMap = new Map();
    for (const s of candidates) {
        if (!selectedMap.has(s.patientId) || s.time < selectedMap.get(s.patientId).time) {
            selectedMap.set(s.patientId, s);
        }
    }
    
    // 4. Construct reminders and diagnostics for candidate sessions
    for (const s of candidates) {
        const patient = patients.find(p => p.id === s.patientId);
        const isSent = selectedMap.get(s.patientId).id === s.id;
        
        if (isSent) {
            const phone = formatPhoneNumber(patient.whatsapp);
            const greeting = tipo === 'HOJE_TARDE' ? 'Boa tarde' : 'Bom dia';
            const timeFormatted = s.time.endsWith(':00') ? s.time.split(':')[0] + 'h' : s.time + 'h';
            
            let message = '';
            if (tipo === 'AMANHA') {
                message = `${greeting}! Olá, ${patient.guardianName.trim()}, tudo bem?\n\nPassando para lembrar você da sessão de *${patient.name.trim()}* amanhã, às *${s.time.trim()}*.\n\nAguardo sua confirmação,\nAté logo!`;
            } else {
                message = `${greeting}!\nAguardo vocês hoje às *${timeFormatted}*!\nAté logo! 🙏🏼`;
            }
            
            reminders.push({
                id: s.id,
                patientId: s.patientId,
                patientName: patient.name,
                guardianName: patient.guardianName,
                whatsapp: patient.whatsapp,
                phone,
                time: s.time,
                timeFormatted,
                message,
                isVirtual: s.isVirtual,
                type: s.type
            });
        } else {
            diagnostics.push({
                id: s.id,
                time: s.time,
                patientName: patient.name,
                type: s.type,
                isVirtual: s.isVirtual,
                isValid: false,
                blockedReason: 'conflito/deduplicação (Dupla)'
            });
        }
    }
    
    return {
        dateStr,
        isHoliday: false,
        reminders,
        diagnostics
    };
}

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
            
            const patientsSnapshot = await db.collection(`users/${userId}/patients`).get();
            const patients = [];
            
            patientsSnapshot.forEach(p => {
                patients.push({ id: p.id, ...p.data() });
            });

            const sessionsSnapshot = await db.collection(`users/${userId}/sessions`)
                .where('date', '==', dateStr)
                .get();
            
            const todasSessoesHoje = sessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const plan = getWhatsappReminderPlan({
                runDateStr: today.toISOString().split('T')[0],
                tipo,
                patients,
                sessions: todasSessoesHoje,
                settings
            });

            if (plan.isHoliday) {
                console.log(`[BLOQUEIO] Data ${plan.dateStr} é feriado (${plan.holidayName}). Disparos cancelados para ${tipo}.`);
                continue;
            }

            console.log(`[INFO] ${plan.dateStr} (${tipo}): Encontradas ${plan.reminders.length} mensagens únicas para enviar.`);

            for (const r of plan.reminders) {
                console.log(`[ENVIO] Enviando para ${r.guardianName} (${r.phone})...`);
                try {
                    await client.sendMessage(r.phone, r.message);
                    console.log(`✅ Sucesso!`);
                } catch (e) {
                    console.error(`❌ Erro ao enviar para ${r.phone}:`, e.message);
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
