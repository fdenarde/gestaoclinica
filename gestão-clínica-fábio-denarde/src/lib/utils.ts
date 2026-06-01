import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, addDays, parseISO, getDay } from 'date-fns';
import { Session, Patient, ClinicSettings } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function calculateAge(birthDate: string | undefined | null): number | string {
  if (!birthDate) return '--';
  // Use split to avoid UTC timezone offsets shifting the date backwards
  const parts = birthDate.split('-');
  if (parts.length !== 3) return '--';
  
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  
  const now = new Date();
  let age = now.getFullYear() - y;
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  
  if (currentMonth < m || (currentMonth === m && currentDay < d)) {
    age--;
  }
  return age;
}

export function safeFormatDate(dateStr: string | undefined | null, formatStr: string = 'dd/MM/yyyy'): string {
  if (!dateStr) return '--';
  // Treat YYYY-MM-DD as local time noon to avoid timezone shift to previous day
  const parseStr = dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr;
  const d = new Date(parseStr);
  if (isNaN(d.getTime())) return '--';
  
  try {
    return format(d, formatStr);
  } catch(e) {
    return '--';
  }
}


export function getStatusColor(status: string) {
  switch (status) {
    case 'Realizada':
    case 'Quitado':
      return 'bg-status-green-bg text-status-green-text';
    case 'Falta.Prof':
    case 'Parcial':
    case 'Pendente':
    case 'Laranja':
      return 'bg-status-orange-bg text-status-orange-text';
    case 'Falta':
    case 'Atraso':
    case 'Vermelho':
      return 'bg-status-red-bg text-status-red-text';
    case 'Reposição':
    case 'Info':
    case 'Azul':
      return 'bg-status-blue-bg text-status-blue-text';
    case 'Cancelada':
      return 'bg-gray-100 text-gray-400';
    default:
      return 'bg-clinic-surface text-clinic-text-muted';
  }
}

export function generateHolidaysForYear(year: number): { date: string, name: string }[] {
  // Fixed National Holidays
  const fixedHolidays = [
    { month: 1, day: 1, name: 'Confraternização Universal' },
    { month: 4, day: 21, name: 'Tiradentes' },
    { month: 5, day: 1, name: 'Dia do Trabalho' },
    { month: 9, day: 7, name: 'Independência do Brasil' },
    { month: 10, day: 12, name: 'Nossa Senhora Aparecida' },
    { month: 10, day: 28, name: 'Dia do Servidor Público' },
    { month: 11, day: 2, name: 'Finados' },
    { month: 11, day: 15, name: 'Proclamação da República' },
    { month: 11, day: 20, name: 'Consciência Negra' },
    { month: 12, day: 24, name: 'Véspera de Natal' },
    { month: 12, day: 25, name: 'Natal' },
    { month: 12, day: 31, name: 'Véspera de Ano Novo' },
    // Fixed Vila Velha / ES Holidays
    { month: 5, day: 23, name: 'Aniversário de Vila Velha / Colonização do Solo ES' }
  ];

  // Calculate Easter (Computus)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;

  const easterDate = new Date(year, easterMonth - 1, easterDay);

  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const formatDate = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const movableHolidays = [
    { date: formatDate(addDays(easterDate, -48)), name: 'Carnaval (Segunda)' },
    { date: formatDate(addDays(easterDate, -47)), name: 'Carnaval (Terça)' },
    { date: formatDate(addDays(easterDate, -46)), name: 'Quarta-feira de Cinzas' },
    { date: formatDate(addDays(easterDate, -2)), name: 'Sexta-feira Santa (Paixão de Cristo)' },
    { date: formatDate(addDays(easterDate, 8)), name: 'Nossa Senhora da Penha (Feriado Estadual/Municipal)' },
    { date: formatDate(addDays(easterDate, 60)), name: 'Corpus Christi' },
    { date: formatDate(addDays(easterDate, 61)), name: 'Emenda de Corpus Christi (Sexta)' }
  ];

  const fixedFormatted = fixedHolidays.map(h => ({
    date: `${year}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
    name: h.name
  }));

  return [...fixedFormatted, ...movableHolidays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Unified schedule and time helpers
export function normalizeStr(s: string): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function isValidTime(timeStr: string): boolean {
  if (!timeStr) return false;
  return /^([0-1]?[0-9]|2[0-3]):(00|30)$/.test(timeStr.trim());
}

export function normalizeTime(timeStr: string): string {
  if (!isValidTime(timeStr)) return timeStr;
  const [hour, min] = timeStr.trim().split(':').map(Number);
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function addOneHour(timeStr: string): string {
  if (!timeStr) return '';
  const [hour, min] = timeStr.split(':').map(Number);
  const newHour = (hour + 1) % 24;
  return `${String(newHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const DAYS_MAP: Record<string, number> = {
  'domingo': 0, 'segunda': 1, 'terça': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6,
  'terca': 2, 'quarta-feira': 3, 'quinta-feira': 4, 'sexta-feira': 5, 'sabado': 6
};

export function getDayOfWeekIndex(dayName: string): number {
  const norm = normalizeStr(dayName);
  return DAYS_MAP[norm] ?? 1;
}

export function schedulesOverlap(
  day1: string, time1: string, double1: boolean,
  day2: string, time2: string, double2: boolean
): boolean {
  if (normalizeStr(day1) !== normalizeStr(day2)) return false;
  
  const t1_1 = normalizeTime(time1);
  const t1_2 = double1 ? addOneHour(t1_1) : null;
  
  const t2_1 = normalizeTime(time2);
  const t2_2 = double2 ? addOneHour(t2_1) : null;
  
  const slots1 = [t1_1, t1_2].filter(Boolean);
  const slots2 = [t2_1, t2_2].filter(Boolean);
  
  return slots1.some(s => slots2.includes(s));
}

export function getNextValidDates(
  dayName: string,
  startDateStr: string,
  count: number,
  holidays: { date: string }[]
): string[] {
  const targetDay = getDayOfWeekIndex(dayName);
  const dates: string[] = [];
  let current = parseISO(startDateStr);
  
  // Align current to the targetDay
  const currentDay = getDay(current);
  const diff = (targetDay - currentDay + 7) % 7;
  current = addDays(current, diff);

  while (dates.length < count) {
    const dateStr = format(current, 'yyyy-MM-dd');
    const isHoliday = holidays.some(h => h.date === dateStr);
    if (!isHoliday) {
      dates.push(dateStr);
    }
    current = addDays(current, 7);
  }
  return dates;
}

export interface ProcessedSession extends Session {
  isVirtual: boolean;
  isValid: boolean;
  blockedReason?: string;
}

export function getSessionsForDate({
  dateStr,
  patients,
  sessions,
  settings
}: {
  dateStr: string;
  patients: Patient[];
  sessions: Session[];
  settings: ClinicSettings;
}): ProcessedSession[] {
  const processed: ProcessedSession[] = [];
  
  // Parse target day of week in Portuguese
  const dateObj = new Date(dateStr + 'T12:00:00');
  const dayIndex = dateObj.getDay();
  const dayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dayKey = dayNames[dayIndex];
  
  // Check if holiday
  const holiday = settings.holidays?.find(h => h.date === dateStr);
  
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
    
    let blockedReason: string | undefined;
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
      blockedReason
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
          const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : undefined;
          processed.push({
            id: `virtual-${p.id}-${dateStr}-${time1}`,
            patientId: p.id,
            date: dateStr,
            time: time1,
            type: p.doubleSession ? 'Sessão dupla (2 × 50 min)' as any : 'Sessão simples (50 min)' as any,
            status: 'Agendada' as any,
            notes: '',
            packageNumber: 0,
            isVirtual: true,
            isValid: !blockedReason,
            blockedReason
          });
        }
        
        if (p.doubleSession) {
          const time2 = addOneHour(p.fixedTime);
          const hasManual2 = dbSessions.some(
            s => s.patientId === p.id && normalizeTime(s.time) === normalizeTime(time2)
          );
          if (!hasManual2) {
            const blockedReason = (!p.whatsapp || !p.whatsapp.trim()) ? 'paciente sem WhatsApp' : undefined;
            processed.push({
              id: `virtual-${p.id}-${dateStr}-${time2}`,
              patientId: p.id,
              date: dateStr,
              time: time2,
              type: 'Sessão dupla (2 × 50 min)' as any,
              status: 'Agendada' as any,
              notes: '',
              packageNumber: 0,
              isVirtual: true,
              isValid: !blockedReason,
              blockedReason
            });
          }
        }
      }
    }
  }
  
  processed.sort((a, b) => a.time.localeCompare(b.time));
  return processed;
}

export interface WhatsappReminder {
  id: string;
  patientId: string;
  patientName: string;
  guardianName: string;
  whatsapp: string;
  phone: string;
  time: string;
  timeFormatted: string;
  message: string;
  isVirtual: boolean;
  type: string;
}

export interface DiagnosticItem {
  id: string;
  time: string;
  patientName: string;
  type: string;
  isVirtual: boolean;
  isValid: boolean;
  blockedReason: string;
}

export interface WhatsappReminderPlan {
  dateStr: string;
  isHoliday: boolean;
  holidayName?: string;
  reminders: WhatsappReminder[];
  diagnostics: DiagnosticItem[];
}

export function getWhatsappReminderPlan({
  runDateStr,
  tipo,
  patients,
  sessions,
  settings
}: {
  runDateStr: string;
  tipo: 'AMANHA' | 'HOJE_MANHA' | 'HOJE_TARDE';
  patients: Patient[];
  sessions: Session[];
  settings: ClinicSettings;
}): WhatsappReminderPlan {
  // 1. Calculate target date
  let dateStr = runDateStr;
  if (tipo === 'AMANHA') {
    const d = new Date(runDateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    dateStr = format(d, 'yyyy-MM-dd');
  }
  
  const holiday = settings.holidays?.find(h => h.date === dateStr);
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
  
  const reminders: WhatsappReminder[] = [];
  const diagnostics: DiagnosticItem[] = [];
  
  // Standard phone format helper
  const formatPhoneNumber = (phoneStr: string) => {
    let clean = phoneStr.replace(/\D/g, '');
    if (!clean.startsWith('55')) {
      clean = '55' + clean;
    }
    return `${clean}@c.us`;
  };
  
  // Candidate sessions after shift/turn filtering
  const candidates: typeof daySessions = [];
  
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
        patientName: patient!.name,
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
        patientName: patient!.name,
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
  const selectedMap = new Map<string, typeof daySessions[0]>();
  for (const s of candidates) {
    if (!selectedMap.has(s.patientId) || s.time < selectedMap.get(s.patientId)!.time) {
      selectedMap.set(s.patientId, s);
    }
  }
  
  // 4. Construct reminders and diagnostics for candidate sessions
  for (const s of candidates) {
    const patient = patients.find(p => p.id === s.patientId)!;
    const isSent = selectedMap.get(s.patientId)!.id === s.id;
    
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


