import type { AlarmAdvance } from '../types';

export type AlarmSoundCategory = 'forte' | 'muito_forte';
export type AlarmIntensity = 'Forte' | 'Muito forte';

export interface AlarmSoundMeta {
  id: string;
  name: string;
  category: AlarmSoundCategory;
  label: string;
  description: string;
  intensity: AlarmIntensity;
  fileName: string;
  src: string;
}

export interface AlarmAdvanceOption {
  value: AlarmAdvance;
  label: string;
  minutes: number;
}

const getBaseUrl = () => {
  const viteEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return viteEnv?.BASE_URL || '/';
};

const ALARM_SOUND_BASE_PATH = `${getBaseUrl()}sounds/alarmes-novos/`;

const buildSoundSrc = (fileName: string) => `${ALARM_SOUND_BASE_PATH}${fileName}`;

export const ALARM_ADVANCE_OPTIONS: AlarmAdvanceOption[] = [
  { value: 'Na hora', label: 'No horário', minutes: 0 },
  { value: '5 min', label: '5 min antes', minutes: 5 },
  { value: '10 min', label: '10 min antes', minutes: 10 },
  { value: '15 min', label: '15 min antes', minutes: 15 },
  { value: '20 min', label: '20 min antes', minutes: 20 },
  { value: '25 min', label: '25 min antes', minutes: 25 },
  { value: '30 min', label: '30 min antes', minutes: 30 },
  { value: '35 min', label: '35 min antes', minutes: 35 },
  { value: '40 min', label: '40 min antes', minutes: 40 },
  { value: '45 min', label: '45 min antes', minutes: 45 },
  { value: '50 min', label: '50 min antes', minutes: 50 },
  { value: '55 min', label: '55 min antes', minutes: 55 },
  { value: '1 hora', label: '1 hora antes', minutes: 60 },
  { value: '1h30', label: '1h30 antes', minutes: 90 },
  { value: '2 horas', label: '2 horas antes', minutes: 120 },
];

const LEGACY_ADVANCE_LABELS: Record<string, number> = {
  'No horário': 0,
  '5 minutos antes': 5,
  '15 minutos antes': 15,
  '30 minutos antes': 30,
  '1 hora antes': 60,
};

const SOUNDS_CONFIG: AlarmSoundMeta[] = [
  {
    id: 'bip_digital_moderno',
    name: 'Bip de Alarme Digital Moderno',
    category: 'forte',
    label: 'Bip Moderno',
    description: 'Bip digital claro e moderno para lembretes rápidos.',
    intensity: 'Forte',
    fileName: 'ElevenLabs_Bip_de_alarme_digital_moderno.mp3',
    src: buildSoundSrc('ElevenLabs_Bip_de_alarme_digital_moderno.mp3'),
  },
  {
    id: 'despertador_digital',
    name: 'Bip de Despertador Digital',
    category: 'forte',
    label: 'Despertador',
    description: 'Som de despertador digital com presença constante.',
    intensity: 'Forte',
    fileName: 'ElevenLabs_Bip_de_despertador_digital.mp3',
    src: buildSoundSrc('ElevenLabs_Bip_de_despertador_digital.mp3'),
  },
  {
    id: 'alarme_madrugadores',
    name: 'Toque Para Madrugadores',
    category: 'muito_forte',
    label: 'Madrugadores',
    description: 'Toque mais chamativo para compromissos difíceis de perder.',
    intensity: 'Muito forte',
    fileName: 'ElevenLabs_Toque_de_alarme_para_madrugadores.mp3',
    src: buildSoundSrc('ElevenLabs_Toque_de_alarme_para_madrugadores.mp3'),
  },
  {
    id: 'alarm_clock_freesound',
    name: 'Alarm Clock',
    category: 'muito_forte',
    label: 'Clock',
    description: 'Alarme clássico de relógio, direto e insistente.',
    intensity: 'Muito forte',
    fileName: 'freesound_community-alarm-clock-90867.mp3',
    src: buildSoundSrc('freesound_community-alarm-clock-90867.mp3'),
  },
  {
    id: 'greece_eas_alarm',
    name: 'Greece EAS Alarm',
    category: 'muito_forte',
    label: 'EAS',
    description: 'Alerta forte em estilo sirene de emergência.',
    intensity: 'Muito forte',
    fileName: 'jeremayjimenez-greece-eas-alarm-451404.mp3',
    src: buildSoundSrc('jeremayjimenez-greece-eas-alarm-451404.mp3'),
  },
  {
    id: 'ringtone_013',
    name: 'Ringtone 013',
    category: 'forte',
    label: 'Ringtone 013',
    description: 'Toque de celular com boa presença sem soar agressivo.',
    intensity: 'Forte',
    fileName: 'universfield-ringtone-013-133355.mp3',
    src: buildSoundSrc('universfield-ringtone-013-133355.mp3'),
  },
  {
    id: 'ringtone_014',
    name: 'Ringtone 014',
    category: 'forte',
    label: 'Ringtone 014',
    description: 'Toque de celular limpo para avisos cotidianos.',
    intensity: 'Forte',
    fileName: 'universfield-ringtone-014-133357.mp3',
    src: buildSoundSrc('universfield-ringtone-014-133357.mp3'),
  },
  {
    id: 'ringtone_042',
    name: 'Ringtone 042',
    category: 'muito_forte',
    label: 'Ringtone 042',
    description: 'Toque mais intenso para alarmes que precisam chamar atenção.',
    intensity: 'Muito forte',
    fileName: 'universfield-ringtone-042-487904.mp3',
    src: buildSoundSrc('universfield-ringtone-042-487904.mp3'),
  },
];

export const DEFAULT_ALARM_SOUND_ID = SOUNDS_CONFIG[0].id;

export function getDefaultSounds(): AlarmSoundMeta[] {
  return [...SOUNDS_CONFIG];
}

export function getAlarmSoundById(soundId?: string): AlarmSoundMeta {
  return SOUNDS_CONFIG.find(sound => sound.id === soundId) || SOUNDS_CONFIG[0];
}

export function getFallbackAlarmSoundId(soundId?: string): string {
  return getAlarmSoundById(soundId).id;
}

export function alarmAdvanceToMinutes(advance?: string): number {
  if (!advance) return 0;
  const configured = ALARM_ADVANCE_OPTIONS.find(option => option.value === advance);
  if (configured) return configured.minutes;
  return LEGACY_ADVANCE_LABELS[advance] ?? 0;
}

export async function loadAlarmSounds(): Promise<AlarmSoundMeta[]> {
  return getDefaultSounds();
}
