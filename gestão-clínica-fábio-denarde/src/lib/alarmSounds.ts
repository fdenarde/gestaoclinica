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

interface SoundConfig {
  id: string;
  name: string;
  filename: string;
  category: 'suave' | 'medio' | 'forte';
  label: string;
  order: number;
}

const SOUNDS_CONFIG: SoundConfig[] = [
  { id: 'nokia_classic', name: 'Clássico Nokia', filename: 'nokia_classic.wav', category: 'forte', label: 'Nokia', order: 0 },
  { id: 'nokia_tune', name: 'Nokia Tune', filename: 'nokia_tune.wav', category: 'forte', label: 'Nokia Tune', order: 1 },
  { id: 'motorola_classic', name: 'Motorola Clássico', filename: 'motorola_classic.wav', category: 'forte', label: 'Motorola', order: 2 },
  { id: 'digital_alarm', name: 'Alarme Digital', filename: 'digital_alarm.wav', category: 'medio', label: 'Digital', order: 3 },
  { id: 'old_phone', name: 'Telefone Antigo', filename: 'old_phone.wav', category: 'medio', label: 'Telefone', order: 4 },
  { id: 'beep_alarm', name: 'Bipe Alarme', filename: 'beep_alarm.wav', category: 'medio', label: 'Bipe', order: 5 },
  { id: 'morning_alarm', name: 'Alarme Matinal', filename: 'morning_alarm.wav', category: 'suave', label: 'Matinal', order: 6 },
  { id: 'urgent_alarm', name: 'Alarme Urgente', filename: 'urgent_alarm.wav', category: 'forte', label: 'Urgente', order: 7 },
  { id: 'school_bell', name: 'Campainha Escola', filename: 'school_bell.wav', category: 'forte', label: 'Campainha', order: 8 },
  { id: 'rooster', name: 'Galo Cantando', filename: 'rooster.wav', category: 'suave', label: 'Galo', order: 9 },
];

function configToMeta(cfg: SoundConfig, url: string): AlarmSoundMeta {
  return { id: cfg.id, name: cfg.name, filename: cfg.filename, category: cfg.category, label: cfg.label, url };
}

export function getDefaultSounds(): AlarmSoundMeta[] {
  return SOUNDS_CONFIG.map(cfg => configToMeta(cfg, `${import.meta.env.BASE_URL}sounds/${cfg.filename}`));
}

let cachedSounds: AlarmSoundMeta[] | null = null;

function sortByConfig(list: AlarmSoundMeta[]): AlarmSoundMeta[] {
  return list.sort((a, b) => {
    const cfgA = SOUNDS_CONFIG.find(s => s.id === a.id);
    const cfgB = SOUNDS_CONFIG.find(s => s.id === b.id);
    return (cfgA?.order ?? 99) - (cfgB?.order ?? 99);
  });
}

export async function loadAlarmSounds(force = false): Promise<AlarmSoundMeta[]> {
  if (cachedSounds && !force) return cachedSounds;

  const defaultSounds = getDefaultSounds();

  let snap;
  try {
    const col = collection(db, 'alarm_sounds');
    snap = await getDocs(col);
  } catch (err) {
    console.warn('Firestore indisponível, usando sons locais:', err);
    cachedSounds = defaultSounds;
    return defaultSounds;
  }

  if (!snap.empty) {
    const list: AlarmSoundMeta[] = [];
    snap.forEach(d => list.push(d.data() as AlarmSoundMeta));
    cachedSounds = sortByConfig(list);
    return cachedSounds;
  }

  const list: AlarmSoundMeta[] = [];
  let anyUploadSucceeded = false;

  for (const cfg of SOUNDS_CONFIG) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sounds/${cfg.filename}`);
      if (!response.ok) {
        console.warn(`Arquivo local não encontrado: ${cfg.filename}, usando fallback`);
        list.push(configToMeta(cfg, `${import.meta.env.BASE_URL}sounds/${cfg.filename}`));
        continue;
      }

      const blob = await response.blob();

      const storageRef = ref(storage, `sounds/alarms/${cfg.filename}`);
      let url: string;
      try {
        await uploadBytes(storageRef, blob);
        url = await getDownloadURL(storageRef);
        anyUploadSucceeded = true;
      } catch (storageErr) {
        console.warn(`Upload para Storage falhou (${cfg.filename}), usando URL local:`, storageErr);
        url = `${import.meta.env.BASE_URL}sounds/${cfg.filename}`;
      }

      const meta = configToMeta(cfg, url);
      list.push(meta);

      if (anyUploadSucceeded && url.startsWith('http')) {
        try {
          const col = collection(db, 'alarm_sounds');
          await setDoc(doc(col, cfg.id), meta);
        } catch (fsErr) {
          console.warn(`Falha ao salvar no Firestore (${cfg.id}):`, fsErr);
        }
      }
    } catch (err) {
      console.warn(`Erro ao processar ${cfg.filename}, usando fallback local:`, err);
      list.push(configToMeta(cfg, `${import.meta.env.BASE_URL}sounds/${cfg.filename}`));
    }
  }

  if (list.length === 0) {
    console.warn('Nenhum som carregado, usando defaults locais');
    cachedSounds = defaultSounds;
    return defaultSounds;
  }

  cachedSounds = sortByConfig(list);
  return cachedSounds;
}
