export type AlarmSoundCategory = 'forte' | 'muito_forte';
export type AlarmIntensity = 'Forte' | 'Muito forte';

export interface AlarmSoundMeta {
  id: string;
  name: string;
  category: AlarmSoundCategory;
  label: string;
  description: string;
  intensity: AlarmIntensity;
}

const SOUNDS_CONFIG: AlarmSoundMeta[] = [
  {
    id: 'mobile_strong',
    name: 'Alarme Celular Forte',
    category: 'muito_forte',
    label: 'Celular Forte',
    description: 'Toque agudo e repetitivo, parecido com alarme de smartphone.',
    intensity: 'Muito forte',
  },
  {
    id: 'classic_clock',
    name: 'Despertador Clássico',
    category: 'forte',
    label: 'Despertador',
    description: 'Sequência rápida de bipes no estilo despertador tradicional.',
    intensity: 'Forte',
  },
  {
    id: 'short_siren',
    name: 'Sirene Curta',
    category: 'muito_forte',
    label: 'Sirene',
    description: 'Alternância de frequências com sensação de sirene curta.',
    intensity: 'Muito forte',
  },
  {
    id: 'urgent_pulse',
    name: 'Pulso Urgente',
    category: 'muito_forte',
    label: 'Pulso Urgente',
    description: 'Pulsos fortes e secos para chamar atenção rapidamente.',
    intensity: 'Muito forte',
  },
  {
    id: 'continuous_alert',
    name: 'Alerta Contínuo',
    category: 'forte',
    label: 'Contínuo',
    description: 'Alerta insistente e estável para compromissos importantes.',
    intensity: 'Forte',
  },
];

export const DEFAULT_ALARM_SOUND_ID = SOUNDS_CONFIG[0].id;

export function getDefaultSounds(): AlarmSoundMeta[] {
  return [...SOUNDS_CONFIG];
}

export function getFallbackAlarmSoundId(soundId?: string): string {
  if (soundId && SOUNDS_CONFIG.some(sound => sound.id === soundId)) return soundId;
  return DEFAULT_ALARM_SOUND_ID;
}

export async function loadAlarmSounds(): Promise<AlarmSoundMeta[]> {
  return getDefaultSounds();
}
