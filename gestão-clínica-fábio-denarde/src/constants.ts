export const CLINIC_INFO = {
  name: "Fábio Denarde",
  specialty: "Neuropsicopedagogo",
  title: "Neuropsicopedagogia",
  email: "contato@fabiodenarde.com.br",
  whatsapp: "27 99999-0000",
  address: "Rua das Flores, 123, Centro, Vitória - ES"
};

export const AVAILABLE_DAYS = ['terça', 'quinta', 'sexta', 'sábado'] as const;

export const SCHEDULE_CONFIG: Record<string, string[]> = {
  'terça': ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
  'quinta': ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
  'sexta': ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
  'sábado': ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00'],
};

export const AVAILABLE_TIMES = Array.from(new Set(Object.values(SCHEDULE_CONFIG).flat())).sort();
