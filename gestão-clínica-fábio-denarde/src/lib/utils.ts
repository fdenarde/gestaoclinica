import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, addDays, parseISO, getDay } from 'date-fns';

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
