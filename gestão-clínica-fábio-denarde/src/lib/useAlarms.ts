import { useEffect, useRef, useState, useCallback } from 'react';
import { PersonalAppointment, AlarmSound, AlarmAdvance } from '../types';
import { differenceInMinutes, addMinutes } from 'date-fns';

const advanceToMinutes = (advance?: string): number => {
  switch (advance) {
    case 'Na hora':
    case 'No horário': return 0;
    case '5 min':
    case '5 minutos antes': return 5;
    case '10 min': return 10;
    case '15 min':
    case '15 minutos antes': return 15;
    case '30 min':
    case '30 minutos antes': return 30;
    case '1 hora':
    case '1 hora antes': return 60;
    default: return 0;
  }
};

let globalAudioCtx: AudioContext | null = null;
let globalOscillators: OscillatorNode[] = [];

function stopAllSounds() {
  globalOscillators.forEach(osc => {
    try { osc.stop(); } catch {}
  });
  globalOscillators = [];
  if (globalAudioCtx && globalAudioCtx.state !== 'closed') {
    try { globalAudioCtx.close(); } catch {}
  }
  globalAudioCtx = null;
}

async function playSound(type: AlarmSound | string) {
  if (type === 'Silencioso' || type === 'Silent') return;

  const normalized = normalizeSound(type);

  stopAllSounds();

  try {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return;
  }

  if (globalAudioCtx.state === 'suspended') {
    await globalAudioCtx.resume();
  }

  const now = globalAudioCtx.currentTime;

  const playBeep = (freq: number, oscType: OscillatorType, duration: number, startTime: number) => {
    if (!globalAudioCtx) return;
    const osc = globalAudioCtx.createOscillator();
    const gainNode = globalAudioCtx.createGain();

    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now + startTime);

    gainNode.gain.setValueAtTime(0.5, now + startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + startTime + duration);

    osc.connect(gainNode);
    gainNode.connect(globalAudioCtx.destination);

    osc.start(now + startTime);
    osc.stop(now + startTime + duration);
    globalOscillators.push(osc);
  };

  switch (normalized) {
    case 'Sino suave':
      playBeep(880, 'sine', 1, 0);
      playBeep(1100, 'sine', 1.5, 0.2);
      break;
    case 'Notificação padrão':
      playBeep(600, 'sine', 0.2, 0);
      playBeep(800, 'sine', 0.4, 0.2);
      break;
    case 'Melodia relaxante':
      playBeep(440, 'sine', 0.5, 0);
      playBeep(554, 'sine', 0.5, 0.3);
      playBeep(659, 'sine', 1, 0.6);
      break;
    case 'Alerta urgente':
      for (let i = 0; i < 8; i++) {
        playBeep(1000, 'square', 0.2, i * 0.25);
        playBeep(1200, 'square', 0.2, i * 0.25 + 0.1);
      }
      break;
  }
}

function normalizeSound(type: string): string {
  switch (type) {
    case 'Ding': return 'Notificação padrão';
    case 'Bell': return 'Sino suave';
    case 'Chime': return 'Melodia relaxante';
    case 'Digital': return 'Alerta urgente';
    default: return type;
  }
}

export function useAlarms(appointments: PersonalAppointment[]) {
  const triggeredAlarms = useRef<Set<string>>(new Set());
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification !== 'undefined') return Notification.permission;
    return 'denied' as NotificationPermission;
  });
  const [activeAlarmId, setActiveAlarmId] = useState<string | null>(null);
  const [activeAlarmLabel, setActiveAlarmLabel] = useState('');

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      setPermission('granted');
      return;
    }
    if (Notification.permission === 'denied') return;
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
    } catch {
      // user dismissed or browser blocked
    }
  }, []);

  const stopAlarm = useCallback(() => {
    stopAllSounds();
    setActiveAlarmId(null);
    setActiveAlarmLabel('');
  }, []);

  useEffect(() => {
    const init = async () => {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          setPermission(perm);
        } catch {}
      } else {
        setPermission(Notification.permission);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const checkAlarms = () => {
      const now = new Date();

      appointments.forEach(app => {
        if (!app.alarmEnabled || app.isDone) return;

        const dateParts = app.date.split('-').map(Number);
        if (dateParts.length !== 3) return;
        const timeParts = app.time.split(':').map(Number);
        if (timeParts.length < 2) return;

        const [year, month, day] = dateParts;
        const [hour, minute] = timeParts;

        const firstOccurrence = new Date(year, month - 1, day, hour, minute);

        let shouldCheckToday = false;

        if (app.recurrence === 'Não repetir') {
          shouldCheckToday = firstOccurrence.toDateString() === now.toDateString();
        } else if (app.recurrence === 'Toda semana') {
          shouldCheckToday = firstOccurrence.getDay() === now.getDay() && now >= firstOccurrence;
        } else if (app.recurrence === 'Todo mês') {
          shouldCheckToday = firstOccurrence.getDate() === now.getDate() && now >= firstOccurrence;
        }

        if (!shouldCheckToday) return;

        const todayOccurrence = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);

        const advanceMins = advanceToMinutes(app.alarmAdvance);
        const triggerTime = addMinutes(todayOccurrence, -advanceMins);

        const diffToTrigger = differenceInMinutes(now, triggerTime);
        const diffToEvent = differenceInMinutes(now, todayOccurrence);

        if (diffToTrigger >= 0 && diffToTrigger <= 2 && diffToEvent <= 0) {
          const alarmKey = `${app.id}-${now.toDateString()}`;

          if (!triggeredAlarms.current.has(alarmKey)) {
            triggeredAlarms.current.add(alarmKey);

            playSound(app.alarmSound || 'Notificação padrão');

            setActiveAlarmId(app.id);
            setActiveAlarmLabel(app.type);

            if (permission === 'granted') {
              try {
                const notif = new Notification(`Lembrete: ${app.type}`, {
                  body: app.notes || `Começa em ${app.alarmAdvance || 'breve'}`,
                  icon: '/vite.svg',
                  tag: alarmKey,
                });
                notif.onclick = () => {
                  stopAlarm();
                  notif.close();
                };
              } catch {}
            }
          }
        }
      });
    };

    const interval = setInterval(checkAlarms, 30000);
    checkAlarms();

    return () => clearInterval(interval);
  }, [appointments, permission, stopAlarm]);

  return { requestPermission, permission, activeAlarmId, activeAlarmLabel, stopAlarm };
}
