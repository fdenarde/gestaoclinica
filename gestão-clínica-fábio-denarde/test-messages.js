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

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = getFirestore('ai-studio-587970e5-0653-44a5-93a3-be1a74301eda');

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
    
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayIndex = dateObj.getDay();
    const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const dayKey = dayNames[dayIndex];
    
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
        const settingsMap = {};
        settingsSnapshot.forEach(s => {
            const data = s.data();
            const userId = s.ref.parent.parent.id;
            holidaysMap[userId] = data.holidays || [];
            settingsMap[userId] = data;
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
            const firstUserId = Object.keys(settingsMap)[0];
            const settings = firstUserId ? settingsMap[firstUserId] : { holidays: [] };
            const isHoliday = settings.holidays?.find(h => h.date === dia.date);
            
            if (isHoliday) {
                console.log(`\n📅 ${dia.label} (${dia.date})`);
                console.log(`   🚫 [FERIADO/RECESSO] ${isHoliday.name.trim()} - Mensagens automáticas suspensas.`);
                continue;
            }

            console.log(`\n📅 ${dia.label} (${dia.date})`);
            
            // Buscar todas as sessões manuais para esta data
            const sessionsSnapshot = await db.collectionGroup('sessions')
                .where('date', '==', dia.date)
                .get();

            const todasSessoesHoje = sessionsSnapshot.docs.map(doc => doc.data());
            
            const daySessions = getSessionsForDate({
                dateStr: dia.date,
                patients,
                sessions: todasSessoesHoje,
                settings
            });

            // Group identically to server.js
            const disparosUnicos = new Map();
            for (const s of daySessions) {
                if (!s.isValid) continue;
                const patient = patientsMap[s.patientId];
                if (!patient || !patient.whatsapp) continue;
                if (!disparosUnicos.has(patient.id) || s.time < disparosUnicos.get(patient.id).s.time) {
                    disparosUnicos.set(patient.id, { s, patient });
                }
            }

            if (daySessions.length === 0) {
                console.log("   (Sem agendamentos)");
            } else {
                daySessions.forEach(s => {
                    const patient = patientsMap[s.patientId];
                    const label = s.isVirtual ? '[FIXO]' : '[MANUAL]';
                    if (s.isValid) {
                        const isSent = disparosUnicos.get(s.patientId)?.s.id === s.id;
                        const [hour] = s.time.split(':').map(Number);
                        const alarmeHoje = hour < 12 ? '06:30' : '12:30';
                        if (isSent) {
                            console.log(`   ✅ ${label} ${patient.name} (${patient.guardianName}) - ${s.time}`);
                            console.log(`      └─ Confirmação: ${alarmeHoje} do próprio dia`);
                        } else {
                            console.log(`   🚫 ${label} ${patient.name} (${s.time}) - Bloqueado: conflito/deduplicação (Dupla)`);
                        }
                    } else {
                        const name = patient ? patient.name : (s.blockName || 'Compromisso');
                        console.log(`   🚫 ${label} ${name} (${s.time}) - Bloqueado: ${s.blockedReason}`);
                    }
                });
            }
        }

        console.log("\n=========================================");
    } catch (error) {
        console.error("Erro no relatório:", error);
    }
}

gerarRelatorioSemanal();
