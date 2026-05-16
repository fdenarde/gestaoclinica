import { useEffect, useRef, useState, useCallback } from 'react';
import { PersonalAppointment } from '../types';
import { differenceInSeconds, addMinutes } from 'date-fns';
import { Howl } from 'howler';
import { loadAlarmSounds, AlarmSoundMeta } from './alarmSounds';

const advanceToMinutes = (advance?: string): number => {
  switch (advance) {
    case 'Na hora': case 'No horário': return 0;
    case '5 min': case '5 minutos antes': return 5;
    case '10 min': return 10;
    case '15 min': case '15 minutos antes': return 15;
    case '20 min': return 20;
    case '25 min': return 25;
    case '30 min': case '30 minutos antes': return 30;
    case '35 min': return 35;
    case '40 min': return 40;
    case '45 min': return 45;
    case '50 min': return 50;
    case '55 min': return 55;
    case '1 hora': case '1 hora antes': return 60;
    case '1h30': return 90;
    case '2 horas': return 120;
    default: return 0;
  }
};

let currentHowl: Howl | null = null;
let previewHowl: Howl | null = null;
let fadeInInterval: ReturnType<typeof setInterval> | null = null;
let stereoInterval: ReturnType<typeof setInterval> | null = null;

function stopAllSounds() {
  if (fadeInInterval) { clearInterval(fadeInInterval); fadeInInterval = null; }
  if (stereoInterval) { clearInterval(stereoInterval); stereoInterval = null; }
  if (previewHowl) { previewHowl.unload(); previewHowl = null; }
  if (currentHowl) { currentHowl.unload(); currentHowl = null; }
  try { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) (navigator as any).vibrate(0); } catch {}
}

function playAlarmSound(url: string, volume: number = 80, fadeIn: boolean = false) {
  stopAllSounds();

  const initialVol = fadeIn ? 0.2 : volume / 100;

  currentHowl = new Howl({
    src: [url],
    loop: true,
    volume: initialVol,
    html5: true,
    onend: () => { /* loop handles this */ },
    onload: () => {
      if (fadeIn && currentHowl) {
        const targetVol = volume / 100;
        const steps = 60;
        const stepSize = (targetVol - 0.2) / steps;
        let step = 0;
        fadeInInterval = setInterval(() => {
          step++;
          const newVol = 0.2 + stepSize * step;
          if (newVol >= targetVol || !currentHowl) {
            if (currentHowl) currentHowl.volume(targetVol);
            if (fadeInInterval) { clearInterval(fadeInInterval); fadeInInterval = null; }
            return;
          }
          currentHowl.volume(newVol);
        }, 500);
      }
    },
  });

  currentHowl.play();
  currentHowl.stereo(-0.5);

  let stereoLeft = true;
  stereoInterval = setInterval(() => {
    if (!currentHowl) { clearInterval(stereoInterval); stereoInterval = null; return; }
    stereoLeft = !stereoLeft;
    currentHowl.stereo(stereoLeft ? -0.5 : 0.5);
  }, 800);

  // Vibração
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate([500, 200, 500, 200, 500]);
    }
  } catch {}
}

export async function previewSound(soundId: string, volume: number = 80) {
  if (previewHowl) { previewHowl.unload(); previewHowl = null; }

  const sounds = await loadAlarmSounds();
  const meta = sounds.find(s => s.id === soundId);
  if (!meta) return;

  previewHowl = new Howl({
    src: [meta.url],
    loop: false,
    volume: volume / 100,
    html5: true,
  });

  previewHowl.play();

  setTimeout(() => {
    if (previewHowl) { previewHowl.unload(); previewHowl = null; }
  }, 3500);
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
    if (Notification.permission === 'granted') { setPermission('granted'); return; }
    if (Notification.permission === 'denied') return;
    try { const perm = await Notification.requestPermission(); setPermission(perm); } catch {}
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
        try { const perm = await Notification.requestPermission(); setPermission(perm); } catch {}
      } else {
        setPermission(Notification.permission);
      }
    };
    init();
  }, []);

  useEffect(() => {
    const soundsRef = { current: [] as AlarmSoundMeta[] };
    let nextTimeout: ReturnType<typeof setTimeout> | null = null;

    const initSounds = async () => {
      soundsRef.current = await loadAlarmSounds();
      console.log('[Alarme] Sons carregados:', soundsRef.current.length);
    };
    initSounds();

    const scheduleNextCheck = (nextTriggerMs: number | null) => {
      if (nextTimeout) clearTimeout(nextTimeout);
      if (nextTriggerMs === null || nextTriggerMs <= 0) return;
      // Agenda o próximo check para 5 segundos antes do trigger (margem de segurança)
      const delay = Math.max(1000, nextTriggerMs - 5000);
      console.log(`[Alarme] Próximo check agendado para daqui ${Math.round(delay / 1000)}s (trigger em ${Math.round(nextTriggerMs / 1000)}s)`);
      nextTimeout = setTimeout(checkAlarms, delay);
    };

    const checkAlarms = () => {
      if (soundsRef.current.length === 0) {
        console.log('[Alarme] Sons ainda não carregados, tentando novamente...');
        loadAlarmSounds(true).then(s => { soundsRef.current = s; }).catch(() => {});
        scheduleNextCheck(30000);
        return;
      }
      const now = new Date();
      console.log(`[Alarme] Verificando ${appointments.length} compromissos às ${now.toLocaleTimeString('pt-BR')}`);

      let triggeredCount = 0;
      let nextTriggerMs: number | null = null;

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
        const secToTrigger = differenceInSeconds(now, triggerTime);
        const secToEvent = differenceInSeconds(now, todayOccurrence);

        // Coleta o próximo trigger futuro
        if (secToTrigger < 0) {
          const msToTrigger = Math.abs(secToTrigger) * 1000;
          if (nextTriggerMs === null || msToTrigger < nextTriggerMs) {
            nextTriggerMs = msToTrigger;
          }
        }

        const inTriggerWindow = secToTrigger >= 0 && secToTrigger <= 120;
        const notTooLate = advanceMins === 0 ? secToEvent <= 60 : secToEvent <= 0;

        if (inTriggerWindow && notTooLate) {
          console.log(`[Alarme] ⏰ ${app.type}: trigger=${triggerTime.toLocaleTimeString('pt-BR')} evento=${todayOccurrence.toLocaleTimeString('pt-BR')} secToTrigger=${secToTrigger} secToEvent=${secToEvent} advance=${advanceMins}min`);
          const alarmKey = `${app.id}-${now.toDateString()}`;
          if (!triggeredAlarms.current.has(alarmKey)) {
            triggeredAlarms.current.add(alarmKey);
            triggeredCount++;

            const soundId = app.alarmSound || 'nokia_classic';
            const meta = soundsRef.current.find(s => s.id === soundId);
            console.log(`[Alarme] DISPARANDO: ${app.type} (som: ${soundId}, volume: ${app.alarmVolume}, fadeIn: ${app.alarmFadeIn})`);
            if (meta) {
              playAlarmSound(meta.url, app.alarmVolume ?? 80, app.alarmFadeIn ?? false);
            }

            setActiveAlarmId(app.id);
            setActiveAlarmLabel(app.type);

            if (permission === 'granted') {
              try {
                const notif = new Notification(`Lembrete: ${app.type}`, {
                  body: app.notes || `Começa em ${app.alarmAdvance || 'breve'}`,
                  icon: '/vite.svg',
                  tag: alarmKey,
                });
                notif.onclick = () => { stopAlarm(); notif.close(); };
              } catch {}
            }
          }
        }
      });

      if (triggeredCount === 0 && nextTriggerMs === null) {
        console.log('[Alarme] Nenhum alarme pendente para hoje');
      }

      // Agenda o próximo check preciso, ou fallback 30s
      scheduleNextCheck(nextTriggerMs ?? 30000);
    };

    const interval = setInterval(checkAlarms, 60000);
    checkAlarms();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Alarme] Aba visível novamente, re-verificando...');
        checkAlarms();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      if (nextTimeout) clearTimeout(nextTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [appointments, permission, stopAlarm]);

  return { requestPermission, permission, activeAlarmId, activeAlarmLabel, stopAlarm };
}
