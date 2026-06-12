export const CLINIC_INFO = {
  name: "Fábio Denarde",
  specialty: "Neuropsicopedagogo",
  title: "Neuropsicopedagogia",
  email: "contato@fabiodenarde.com.br",
  whatsapp: "27 99999-0000",
  address: "Rua das Flores, 123, Centro, Vitória - ES"
};

export const AVAILABLE_DAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const WEEKDAY_TIMES = [
  '07:00',
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
];

export const SCHEDULE_CONFIG: Record<string, string[]> = {
  'segunda': WEEKDAY_TIMES,
  'terça': WEEKDAY_TIMES,
  'quarta': WEEKDAY_TIMES,
  'quinta': WEEKDAY_TIMES,
  'sexta': WEEKDAY_TIMES,
  'sábado': ['07:00', '08:00', '09:00', '10:00', '11:00', '14:00'],
};

export const AVAILABLE_TIMES = Array.from(new Set(Object.values(SCHEDULE_CONFIG).flat())).sort();
