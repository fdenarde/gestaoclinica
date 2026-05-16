import { db, storage } from '../firebase';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export interface AlarmSoundMeta {
  id: string;
  name: string;
  filename: string;
  category: 'suave' | 'medio' | 'forte';
  label: string;
  url: string;
}

const SOUNDS_CONFIG = [
  { id: 'nokia_classic', name: 'Clássico Nokia', filename: 'nokia_classic.wav', category: 'forte' as const, label: 'Nokia', order: 0 },
  { id: 'nokia_tune', name: 'Nokia Tune', filename: 'nokia_tune.wav', category: 'forte' as const, label: 'Nokia Tune', order: 1 },
  { id: 'motorola_classic', name: 'Motorola Clássico', filename: 'motorola_classic.wav', category: 'forte' as const, label: 'Motorola', order: 2 },
  { id: 'digital_alarm', name: 'Alarme Digital', filename: 'digital_alarm.wav', category: 'medio' as const, label: 'Digital', order: 3 },
  { id: 'old_phone', name: 'Telefone Antigo', filename: 'old_phone.wav', category: 'medio' as const, label: 'Telefone', order: 4 },
  { id: 'beep_alarm', name: 'Bipe Alarme', filename: 'beep_alarm.wav', category: 'medio' as const, label: 'Bipe', order: 5 },
  { id: 'morning_alarm', name: 'Alarme Matinal', filename: 'morning_alarm.wav', category: 'suave' as const, label: 'Matinal', order: 6 },
  { id: 'urgent_alarm', name: 'Alarme Urgente', filename: 'urgent_alarm.wav', category: 'forte' as const, label: 'Urgente', order: 7 },
  { id: 'school_bell', name: 'Campainha Escola', filename: 'school_bell.wav', category: 'forte' as const, label: 'Campainha', order: 8 },
  { id: 'rooster', name: 'Galo Cantando', filename: 'rooster.wav', category: 'suave' as const, label: 'Galo', order: 9 },
];

export function getDefaultSounds() {
  return SOUNDS_CONFIG;
}

let cachedSounds: AlarmSoundMeta[] | null = null;

export async function loadAlarmSounds(force = false): Promise<AlarmSoundMeta[]> {
  if (cachedSounds && !force) return cachedSounds;

  const col = collection(db, 'alarm_sounds');
  const snap = await getDocs(col);

  if (!snap.empty) {
    const list: AlarmSoundMeta[] = [];
    snap.forEach(d => list.push(d.data() as AlarmSoundMeta));
    list.sort((a, b) => {
      const cfgA = SOUNDS_CONFIG.find(s => s.id === a.id);
      const cfgB = SOUNDS_CONFIG.find(s => s.id === b.id);
      return (cfgA?.order ?? 99) - (cfgB?.order ?? 99);
    });
    cachedSounds = list;
    return list;
  }

  // Primeira execução: fazer upload dos arquivos para Storage
  const list: AlarmSoundMeta[] = [];

  for (const cfg of SOUNDS_CONFIG) {
    try {
      const response = await fetch(`/sounds/${cfg.filename}`);
      if (!response.ok) {
        console.warn(`Arquivo não encontrado: ${cfg.filename}`);
        continue;
      }
      const blob = await response.blob();

      const storageRef = ref(storage, `sounds/alarms/${cfg.filename}`);
      await uploadBytes(storageRef, blob);

      const url = await getDownloadURL(storageRef);

      const meta: AlarmSoundMeta = {
        id: cfg.id,
        name: cfg.name,
        filename: cfg.filename,
        category: cfg.category,
        label: cfg.label,
        url,
      };

      await setDoc(doc(col, cfg.id), meta);
      list.push(meta);
    } catch (err) {
      console.error(`Erro ao processar ${cfg.filename}:`, err);
    }
  }

  list.sort((a, b) => {
    const cfgA = SOUNDS_CONFIG.find(s => s.id === a.id);
    const cfgB = SOUNDS_CONFIG.find(s => s.id === b.id);
    return (cfgA?.order ?? 99) - (cfgB?.order ?? 99);
  });

  cachedSounds = list;
  return list;
}
