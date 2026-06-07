import { useCallback, useEffect, useRef, useState } from 'react';
import { addMinutes } from 'date-fns';
import { Howl, Howler } from 'howler';
import { PersonalAppointment } from '../types';
import {
  alarmAdvanceToMinutes,
  getAlarmSoundById,
} from './alarmSounds';

export const ALARM_CHECK_INTERVAL_MS = 30_000;
export const ALARM_POST_EVENT_GRACE_MS = 90_000;

const MIN_CHECK_DELAY_MS = 250;
const PREVIEW_MAX_DURATION_MS = 8_000;

interface AlarmPlayback {
  howl: Howl;
  stopTimer: ReturnType<typeof setTimeout> | null;
  playId: number | null;
}

export interface AlarmTiming {
  app: PersonalAppointment;
  alarmKey: string;
  occurrenceTime: Date;
  triggerTime: Date;
  latestTriggerTime: Date;
  advanceMinutes: number;
}

export interface AlarmEvaluation {
  dueAlarms: AlarmTiming[];
  nextTriggerMs: number | null;
}

let currentPlayback: AlarmPlayback | null = null;
let previewPlayback: AlarmPlayback | null = null;

const pad2 = (value: number) => String(value).padStart(2, '0');
const clampVolume = (volume: number) => Math.min(0.95, Math.max(0.05, volume / 100));

function getHowlerContext(): AudioContext | undefined {
  return (Howler as unknown as { ctx?: AudioContext }).ctx;
}

function sameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localTimeKey(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseAppointmentDateTime(app: PersonalAppointment) {
  const dateParts = app.date.split('-').map(Number);
  const timeParts = app.time.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) return null;

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if ([year, month, day, hour, minute].some(value => !Number.isFinite(value))) return null;
  if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const firstOccurrence = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    firstOccurrence.getFullYear() !== year ||
    firstOccurrence.getMonth() !== month - 1 ||
    firstOccurrence.getDate() !== day
  ) {
    return null;
  }

  return { firstOccurrence, hour, minute };
}

export function getAlarmTimingForNow(app: PersonalAppointment, now: Date): AlarmTiming | null {
  if (!app.alarmEnabled || app.isDone) return null;

  const parsed = parseAppointmentDateTime(app);
  if (!parsed) return null;

  const { firstOccurrence, hour, minute } = parsed;
  const occurrenceTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (occurrenceTime.getTime() < firstOccurrence.getTime()) return null;

  const recurrence = app.recurrence || 'Não repetir';
  if (recurrence === 'Não repetir' && !sameLocalDate(firstOccurrence, now)) return null;
  if (recurrence === 'Toda semana' && firstOccurrence.getDay() !== now.getDay()) return null;
  if (recurrence === 'Todo mês' && firstOccurrence.getDate() !== now.getDate()) return null;
  if (!['Não repetir', 'Toda semana', 'Todo mês'].includes(recurrence)) return null;

  const advanceMinutes = alarmAdvanceToMinutes(app.alarmAdvance);
  const triggerTime = addMinutes(occurrenceTime, -advanceMinutes);
  const latestTriggerTime = new Date(occurrenceTime.getTime() + ALARM_POST_EVENT_GRACE_MS);
  const alarmKey = [
    app.id,
    localDateKey(occurrenceTime),
    localTimeKey(occurrenceTime),
    advanceMinutes,
  ].join('|');

  return { app, alarmKey, occurrenceTime, triggerTime, latestTriggerTime, advanceMinutes };
}

export function evaluateAlarmsForNow(
  appointments: PersonalAppointment[],
  now: Date,
  triggeredKeys: ReadonlySet<string> = new Set(),
): AlarmEvaluation {
  const dueAlarms: AlarmTiming[] = [];
  let nextTriggerMs: number | null = null;
  const nowMs = now.getTime();

  appointments.forEach(app => {
    const timing = getAlarmTimingForNow(app, now);
    if (!timing) return;

    const msUntilTrigger = timing.triggerTime.getTime() - nowMs;
    if (msUntilTrigger > 0) {
      if (nextTriggerMs === null || msUntilTrigger < nextTriggerMs) nextTriggerMs = msUntilTrigger;
      return;
    }

    if (nowMs <= timing.latestTriggerTime.getTime() && !triggeredKeys.has(timing.alarmKey)) {
      dueAlarms.push(timing);
    }
  });

  return { dueAlarms, nextTriggerMs };
}

function getNextCheckDelay(nextTriggerMs: number | null): number {
  if (nextTriggerMs === null) return ALARM_CHECK_INTERVAL_MS;
  return Math.max(MIN_CHECK_DELAY_MS, Math.min(ALARM_CHECK_INTERVAL_MS, nextTriggerMs));
}

export async function prepareAlarmAudio() {
  if (typeof window === 'undefined') return false;

  try {
    Howler.mute(false);
    const ctx = getHowlerContext();
    if (ctx?.state === 'suspended') await ctx.resume();
    return true;
  } catch (err) {
    console.warn('[Alarme] Não foi possível preparar o áudio:', err);
    return false;
  }
}

function stopPlayback(playback: AlarmPlayback | null) {
  if (!playback) return;
  if (playback.stopTimer) clearTimeout(playback.stopTimer);
  try { playback.howl.stop(); } catch {}
  try { playback.howl.unload(); } catch {}
}

function stopAllSounds() {
  stopPlayback(previewPlayback);
  previewPlayback = null;
  stopPlayback(currentPlayback);
  currentPlayback = null;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate(0);
    }
  } catch {}
}

function vibrateAlarm(loop: boolean) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate(loop ? [450, 130, 450, 130, 650] : [250, 90, 250]);
    }
  } catch {}
}

async function playAlarmSound(
  soundId: string,
  volume = 80,
  fadeIn = false,
  loop = true,
  mode: 'current' | 'preview' = 'current',
) {
  if (typeof window === 'undefined') return false;

  await prepareAlarmAudio();

  if (mode === 'current') {
    stopPlayback(previewPlayback);
    previewPlayback = null;
    stopPlayback(currentPlayback);
    currentPlayback = null;
  } else {
    stopPlayback(previewPlayback);
    previewPlayback = null;
  }

  const sound = getAlarmSoundById(soundId);
  const targetVolume = clampVolume(volume);
  const initialVolume = fadeIn && loop ? Math.max(0.05, targetVolume * 0.2) : targetVolume;
  const howl = new Howl({
    src: [sound.src],
    html5: true,
    loop,
    preload: true,
    volume: initialVolume,
  });
  const playback: AlarmPlayback = { howl, stopTimer: null, playId: null };

  if (mode === 'current') currentPlayback = playback;
  else previewPlayback = playback;

  const cleanupIfPreview = () => {
    if (mode === 'preview' && previewPlayback === playback) {
      stopPlayback(playback);
      previewPlayback = null;
    }
  };

  const start = () => {
    try {
      const playId = howl.play();
      playback.playId = typeof playId === 'number' ? playId : null;
      if (fadeIn && loop && playback.playId !== null) {
        howl.fade(initialVolume, targetVolume, 30_000, playback.playId);
      }
      if (!loop) playback.stopTimer = setTimeout(cleanupIfPreview, PREVIEW_MAX_DURATION_MS);
      vibrateAlarm(loop);
    } catch (err) {
      console.warn('[Alarme] Não foi possível tocar o som:', err);
    }
  };

  howl.once('load', start);
  howl.once('loaderror', (_id, err) => {
    console.warn(`[Alarme] Erro ao carregar som "${sound.id}":`, err);
  });
  howl.once('playerror', (_id, err) => {
    console.warn(`[Alarme] Reprodução bloqueada para "${sound.id}", tentando desbloquear:`, err);
    const ctx = getHowlerContext();
    if (ctx?.state === 'suspended') {
      ctx.resume().then(start).catch(() => {});
    }
  });

  if (howl.state() === 'loaded') start();
  return true;
}

export async function previewSound(soundId: string, volume = 80) {
  await playAlarmSound(soundId, volume, false, false, 'preview');
}

export function useAlarms(appointments: PersonalAppointment[]) {
  const triggeredAlarms = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification !== 'undefined') return Notification.permission;
    return 'denied' as NotificationPermission;
  });
  const [activeAlarmId, setActiveAlarmId] = useState<string | null>(null);
  const [activeAlarmLabel, setActiveAlarmLabel] = useState('');

  const requestPermission = useCallback(async () => {
    await prepareAlarmAudio();
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { setPermission('granted'); return; }
    if (Notification.permission === 'denied') return;
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
    } catch {}
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
    const clearScheduledCheck = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const scheduleNextCheck = (nextTriggerMs: number | null) => {
      clearScheduledCheck();
      timerRef.current = setTimeout(checkAlarms, getNextCheckDelay(nextTriggerMs));
    };

    const triggerAlarm = (timing: AlarmTiming) => {
      triggeredAlarms.current.add(timing.alarmKey);
      const sound = getAlarmSoundById(timing.app.alarmSound);

      void playAlarmSound(
        sound.id,
        timing.app.alarmVolume ?? 80,
        timing.app.alarmFadeIn ?? false,
        true,
        'current',
      );

      setActiveAlarmId(timing.app.id);
      setActiveAlarmLabel(timing.app.type);

      if (permission === 'granted') {
        try {
          const notif = new Notification(`Lembrete: ${timing.app.type}`, {
            body: timing.app.notes || `Horário: ${localTimeKey(timing.occurrenceTime)} (${timing.app.alarmAdvance || 'No horário'})`,
            icon: '/vite.svg',
            tag: timing.alarmKey,
          });
          notif.onclick = () => { stopAlarm(); notif.close(); };
        } catch {}
      }
    };

    const checkAlarms = () => {
      try {
        const evaluation = evaluateAlarmsForNow(appointments, new Date(), triggeredAlarms.current);
        evaluation.dueAlarms.forEach(triggerAlarm);
        scheduleNextCheck(evaluation.nextTriggerMs);
      } catch (e) {
        console.error('[Alarme] ERRO no checkAlarms:', e);
        scheduleNextCheck(null);
      }
    };

    checkAlarms();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkAlarms();
    };
    const handleFocus = () => checkAlarms();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearScheduledCheck();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [appointments, permission, stopAlarm]);

  return { requestPermission, permission, activeAlarmId, activeAlarmLabel, stopAlarm };
}
