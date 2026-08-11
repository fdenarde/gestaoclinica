import { findWhatsappReminderSuppression } from './whatsappReminderSuppressions.js';
import { maskPhoneShort, normalizeBrazilianWhatsappPhone } from './whatsappPhone.js';
import { isWhatsappAutomationBlocked } from '../../shared/whatsappSessionAutomation.js';

export function formatPhoneNumber(phoneStr) {
  return normalizeBrazilianWhatsappPhone(phoneStr).chatId;
}

function normalizeStr(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return timeStr;
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

function addOneHour(timeStr) {
  if (!timeStr) return '';
  const [hour, min] = timeStr.split(':').map(Number);
  const newHour = (hour + 1) % 24;
  return `${String(newHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function formatDateStr(date) {
  return date.toISOString().split('T')[0];
}

function sameName(a, b) {
  return normalizeStr(a) && normalizeStr(a) === normalizeStr(b);
}

export function getSelectedReminderContact(patient) {
  const responsibleName = String(patient?.guardianName || '').trim();
  let relationship = 'não informado';
  let source = 'patient.whatsapp';

  if (sameName(responsibleName, patient?.motherName)) {
    relationship = 'Mãe';
    source = 'patient.whatsapp:motherName-match';
  } else if (sameName(responsibleName, patient?.fatherName)) {
    relationship = 'Pai';
    source = 'patient.whatsapp:fatherName-match';
  } else if (sameName(responsibleName, patient?.otherResponsibleName)) {
    relationship = patient?.otherResponsibleKinship || 'outro responsável';
    source = 'patient.whatsapp:otherResponsible-match';
  }

  return {
    responsibleName,
    guardianName: responsibleName,
    responsibleRelationship: relationship,
    responsiblePhoneSource: source,
    whatsapp: patient?.whatsapp || '',
    phoneMasked: maskPhoneShort(patient?.whatsapp || ''),
  };
}

export function formatLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getFixedScheduleForDate(patient, dateStr, referenceDateStr = formatLocalDateStr(new Date())) {
  const history = patient.fixedScheduleHistory || [];
  const historicalSchedule = history.find(item =>
    item.effectiveFrom &&
    item.effectiveTo &&
    item.effectiveFrom <= dateStr &&
    dateStr <= item.effectiveTo
  );

  if (historicalSchedule) {
    return {
      fixedDay: historicalSchedule.fixedDay || '',
      fixedTime: historicalSchedule.fixedTime || '',
      doubleSession: !!historicalSchedule.doubleSession
    };
  }

  if (!patient.fixedScheduleEffectiveFrom && history.length === 0 && dateStr < referenceDateStr) {
    return null;
  }

  const effectiveFrom = patient.fixedScheduleEffectiveFrom || patient.startDate || '';
  if (effectiveFrom && dateStr < effectiveFrom) {
    return null;
  }

  return {
    fixedDay: patient.fixedDay || '',
    fixedTime: patient.fixedTime || '',
    doubleSession: !!patient.doubleSession
  };
}

export function getSessionsForDate({
  dateStr,
  patients,
  sessions,
  settings,
  referenceDateStr = formatLocalDateStr(new Date())
}) {
  const processed = [];

  const dateObj = new Date(`${dateStr}T12:00:00`);
  const dayIndex = dateObj.getDay();
  const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dayKey = dayNames[dayIndex];

  const holiday = (settings.holidays || []).find(h => h.date === dateStr);

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
    } else if (s.status !== 'Agendada') {
      blockedReason = 'status inválido';
    } else if (!patient.whatsapp || !patient.whatsapp.trim()) {
      blockedReason = 'responsável sem WhatsApp válido';
    } else {
      try {
        normalizeBrazilianWhatsappPhone(patient.whatsapp);
      } catch {
        blockedReason = 'responsável sem WhatsApp válido';
      }
    }

    processed.push({
      ...s,
      isVirtual: false,
      isValid: !blockedReason,
      blockedReason: blockedReason || undefined
    });
  }

  if (!holiday) {
    for (const p of patients) {
      if (p.status !== 'Ativo') continue;

      const fixedSchedule = getFixedScheduleForDate(p, dateStr, referenceDateStr);
      if (!fixedSchedule?.fixedDay || !fixedSchedule.fixedTime) continue;

      const fixedDayNorm = normalizeStr(fixedSchedule.fixedDay).replace('-feira', '');
      const targetDayNorm = normalizeStr(dayKey).replace('-feira', '');

      if (fixedDayNorm === targetDayNorm && fixedSchedule.fixedTime) {
        const time1 = fixedSchedule.fixedTime;
        const hasManual1 = dbSessions.some(
          s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time1)
        );
        if (!hasManual1) {
          let blockedReason = null;
          if (!p.whatsapp || !p.whatsapp.trim()) {
            blockedReason = 'responsável sem WhatsApp válido';
          } else {
            try {
              normalizeBrazilianWhatsappPhone(p.whatsapp);
            } catch {
              blockedReason = 'responsável sem WhatsApp válido';
            }
          }
          processed.push({
            id: `virtual-${p.id}-${dateStr}-${time1}`,
            patientId: p.id,
            date: dateStr,
            time: time1,
            type: fixedSchedule.doubleSession ? 'Sessão dupla (2 × 50 min)' : 'Sessão simples (50 min)',
            status: 'Agendada',
            notes: '',
            packageNumber: 0,
            isVirtual: true,
            isValid: !blockedReason,
            blockedReason: blockedReason || undefined
          });
        }

        if (fixedSchedule.doubleSession) {
          const time2 = addOneHour(fixedSchedule.fixedTime);
          const hasManual2 = dbSessions.some(
            s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time2)
          );
          if (!hasManual2) {
            let blockedReason = null;
            if (!p.whatsapp || !p.whatsapp.trim()) {
              blockedReason = 'responsável sem WhatsApp válido';
            } else {
              try {
                normalizeBrazilianWhatsappPhone(p.whatsapp);
              } catch {
                blockedReason = 'responsável sem WhatsApp válido';
              }
            }
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

export function getWhatsappReminderPlan({
  runDateStr,
  tipo,
  patients,
  sessions,
  settings,
  suppressions = [],
  referenceDateStr = formatLocalDateStr(new Date())
}) {
  const scheduledTimeByType = {
    HOJE_MANHA: '06:30',
    AMANHA: '09:00',
    HOJE_TARDE: '12:30'
  };
  let dateStr = runDateStr;
  if (tipo === 'AMANHA') {
    const d = new Date(`${runDateStr}T12:00:00`);
    d.setDate(d.getDate() + 1);
    dateStr = formatDateStr(d);
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

  const daySessions = getSessionsForDate({
    dateStr,
    patients,
    sessions,
    settings,
    referenceDateStr
  });
  const reminders = [];
  const diagnostics = [];
  const candidates = [];

  for (const s of daySessions) {
    const patient = patients.find(p => p.id === s.patientId);

    if (!s.isValid) {
      diagnostics.push({
        id: s.id,
        time: s.time,
        patientName: patient ? patient.name : (s.blockName || 'Compromisso'),
        guardianName: patient?.guardianName || '',
        responsibleName: patient?.guardianName || '',
        responsibleRelationship: patient ? getSelectedReminderContact(patient).responsibleRelationship : 'não informado',
        phoneMasked: patient?.whatsapp ? maskPhoneShort(patient.whatsapp) : '(sem telefone)',
        type: s.type,
        isVirtual: s.isVirtual,
        isValid: false,
        blockedReason: s.blockedReason || 'desconhecido'
      });
      continue;
    }

    const [hour] = s.time.split(':').map(Number);
    if (tipo === 'HOJE_MANHA' && hour >= 12) {
      diagnostics.push({
        id: s.id,
        time: s.time,
        patientName: patient.name,
        guardianName: patient.guardianName,
        responsibleName: patient.guardianName,
        responsibleRelationship: getSelectedReminderContact(patient).responsibleRelationship,
        phoneMasked: maskPhoneShort(patient.whatsapp),
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
        guardianName: patient.guardianName,
        responsibleName: patient.guardianName,
        responsibleRelationship: getSelectedReminderContact(patient).responsibleRelationship,
        phoneMasked: maskPhoneShort(patient.whatsapp),
        type: s.type,
        isVirtual: s.isVirtual,
        isValid: false,
        blockedReason: 'fora do turno (Sessão da manhã)'
      });
      continue;
    }

    candidates.push(s);
  }

  const selectedMap = new Map();
  for (const s of candidates) {
    if (!selectedMap.has(s.patientId) || s.time < selectedMap.get(s.patientId).time) {
      selectedMap.set(s.patientId, s);
    }
  }

  for (const s of candidates) {
    const patient = patients.find(p => p.id === s.patientId);
    const isSent = selectedMap.get(s.patientId).id === s.id;

    if (isSent) {
      if (isWhatsappAutomationBlocked(s, { reminderType: tipo, phase: 'plan' })) {
        diagnostics.push({
          id: s.id,
          patientId: s.patientId,
          time: s.time,
          patientName: patient.name,
          guardianName: patient.guardianName,
          responsibleName: patient.guardianName,
          responsibleRelationship: getSelectedReminderContact(patient).responsibleRelationship,
          phoneMasked: maskPhoneShort(patient.whatsapp),
          whatsapp: patient.whatsapp,
          type: s.type,
          isVirtual: s.isVirtual,
          isValid: false,
          blockedReason: 'mensagem automática bloqueada na Agenda',
          isSessionAutomationBlocked: true,
          reminderType: tipo,
        });
        continue;
      }

      const suppression = findWhatsappReminderSuppression({
        suppressions,
        patient,
        session: s,
        runDateStr,
        scheduledTime: scheduledTimeByType[tipo],
        dateStr,
        tipo
      });
      if (suppression) {
        diagnostics.push({
          id: s.id,
          patientId: s.patientId,
          time: s.time,
          patientName: patient.name,
          guardianName: patient.guardianName,
          responsibleName: patient.guardianName,
          responsibleRelationship: getSelectedReminderContact(patient).responsibleRelationship,
          phoneMasked: maskPhoneShort(patient.whatsapp),
          whatsapp: patient.whatsapp,
          type: s.type,
          isVirtual: s.isVirtual,
          isValid: false,
          blockedReason: suppression.reason,
          suppressionId: suppression.id,
          isSuppressed: true
        });
        continue;
      }

      const contact = getSelectedReminderContact(patient);
      const phone = formatPhoneNumber(patient.whatsapp);
      const greeting = tipo === 'HOJE_TARDE' ? 'Boa tarde' : 'Bom dia';
      const timeFormatted = s.time.endsWith(':00') ? `${s.time.split(':')[0]}h` : `${s.time}h`;

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
        guardianName: contact.guardianName,
        responsibleId: patient.responsibleId || patient.guardianId || patient.responsibleUid || '',
        responsibleName: contact.responsibleName,
        responsibleRelationship: contact.responsibleRelationship,
        responsiblePhoneSource: contact.responsiblePhoneSource,
        whatsapp: patient.whatsapp,
        phone,
        phoneMasked: contact.phoneMasked,
        time: s.time,
        timeFormatted,
        message,
        isVirtual: s.isVirtual,
        type: s.type,
        reminderType: tipo,
        sessionAutomationControl: s.whatsappAutomationControl || null,
      });
    } else {
      diagnostics.push({
        id: s.id,
        time: s.time,
        patientName: patient.name,
        guardianName: patient.guardianName,
        responsibleName: patient.guardianName,
        responsibleRelationship: getSelectedReminderContact(patient).responsibleRelationship,
        phoneMasked: maskPhoneShort(patient.whatsapp),
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
