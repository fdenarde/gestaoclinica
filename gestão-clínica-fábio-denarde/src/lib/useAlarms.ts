import { useEffect, useRef, useState, useCallback } from 'react';
import { PersonalAppointment } from '../types';
import { differenceInSeconds, addMinutes } from 'date-fns';
import { loadAlarmSounds, AlarmSoundMeta, DEFAULT_ALARM_SOUND_ID, getFallbackAlarmSoundId } from './alarmSounds';

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

type OscillatorKind = OscillatorType;

interface ToneStep {
  frequency: number;
  duration: number;
  gap: number;
  type?: OscillatorKind;
}

interface AlarmTonePattern {
  steps: ToneStep[];
  repeatPause: number;
  vibrate: number[];
}

const TONE_PATTERNS: Record<string, AlarmTonePattern> = {
  mobile_strong: {
    steps: [
      { frequency: 1040, duration: 180, gap: 70, type: 'square' },
      { frequency: 1320, duration: 180, gap: 70, type: 'square' },
      { frequency: 1040, duration: 180, gap: 70, type: 'square' },
      { frequency: 1560, duration: 220, gap: 140, type: 'square' },
    ],
    repeatPause: 180,
    vibrate: [450, 130, 450, 130, 650],
  },
  classic_clock: {
    steps: [
      { frequency: 880, duration: 260, gap: 90, type: 'triangle' },
      { frequency: 880, duration: 260, gap: 90, type: 'triangle' },
      { frequency: 988, duration: 260, gap: 90, type: 'triangle' },
      { frequency: 988, duration: 260, gap: 140, type: 'triangle' },
    ],
    repeatPause: 220,
    vibrate: [300, 120, 300, 120, 300],
  },
  short_siren: {
    steps: [
      { frequency: 720, duration: 220, gap: 40, type: 'sawtooth' },
      { frequency: 1280, duration: 220, gap: 40, type: 'sawtooth' },
      { frequency: 760, duration: 220, gap: 40, type: 'sawtooth' },
      { frequency: 1420, duration: 260, gap: 120, type: 'sawtooth' },
    ],
    repeatPause: 120,
    vibrate: [550, 80, 550, 80, 550],
  },
  urgent_pulse: {
    steps: [
      { frequency: 1180, duration: 120, gap: 60, type: 'square' },
      { frequency: 1180, duration: 120, gap: 60, type: 'square' },
      { frequency: 1180, duration: 120, gap: 60, type: 'square' },
      { frequency: 1500, duration: 300, gap: 160, type: 'square' },
    ],
    repeatPause: 160,
    vibrate: [180, 80, 180, 80, 180, 80, 500],
  },
  continuous_alert: {
    steps: [
      { frequency: 980, duration: 380, gap: 70, type: 'square' },
      { frequency: 1120, duration: 380, gap: 70, type: 'square' },
      { frequency: 980, duration: 380, gap: 120, type: 'square' },
    ],
    repeatPause: 140,
    vibrate: [650, 180, 650],
  },
};

interface SynthPlayback {
  ctx: AudioContext;
  masterGain: GainNode;
  timers: ReturnType<typeof setTimeout>[];
  nodes: OscillatorNode[];
  stopped: boolean;
}

let audioContext: AudioContext | null = null;
let currentPlayback: SynthPlayback | null = null;
let previewPlayback: SynthPlayback | null = null;

const clampVolume = (volume: number) => Math.min(0.95, Math.max(0.05, volume / 100));

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

export async function prepareAlarmAudio() {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    return true;
  } catch (err) {
    console.warn('[Alarme] Não foi possível preparar o áudio:', err);
    return false;
  }
}

function stopPlayback(playback: SynthPlayback | null) {
  if (!playback) return;
  playback.stopped = true;
  playback.timers.forEach(timer => clearTimeout(timer));
  playback.timers = [];
  playback.nodes.forEach(node => {
    try { node.stop(); } catch {}
    try { node.disconnect(); } catch {}
  });
  playback.nodes = [];
  try { playback.masterGain.disconnect(); } catch {}
}

function stopAllSounds() {
  stopPlayback(previewPlayback);
  previewPlayback = null;
  stopPlayback(currentPlayback);
  currentPlayback = null;
  try { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) (navigator as any).vibrate(0); } catch {}
}

function playToneStep(playback: SynthPlayback, step: ToneStep, channelPan = 0) {
  if (playback.stopped) return;

  const ctx = playback.ctx;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

  oscillator.type = step.type || 'square';
  oscillator.frequency.setValueAtTime(step.frequency, ctx.currentTime);

  const now = ctx.currentTime;
  const durationSec = step.duration / 1000;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.85, now + 0.018);
  gain.gain.setValueAtTime(0.85, Math.max(now + 0.02, now + durationSec - 0.035));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  if (panner) {
    panner.pan.setValueAtTime(channelPan, now);
    oscillator.connect(gain).connect(panner).connect(playback.masterGain);
  } else {
    oscillator.connect(gain).connect(playback.masterGain);
  }

  playback.nodes.push(oscillator);
  oscillator.start(now);
  oscillator.stop(now + durationSec);

  oscillator.onended = () => {
    playback.nodes = playback.nodes.filter(node => node !== oscillator);
    try { oscillator.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
    try { panner?.disconnect(); } catch {}
  };
}

async function playSyntheticAlarm(soundId: string, volume = 80, fadeIn = false, loop = true, mode: 'current' | 'preview' = 'current') {
  const ctx = getAudioContext();
  if (!ctx) return;

  try { if (ctx.state === 'suspended') await ctx.resume(); } catch {}

  if (mode === 'current') {
    stopPlayback(currentPlayback);
    currentPlayback = null;
  } else {
    stopPlayback(previewPlayback);
    previewPlayback = null;
  }

  const resolvedSoundId = getFallbackAlarmSoundId(soundId);
  const pattern = TONE_PATTERNS[resolvedSoundId] || TONE_PATTERNS[DEFAULT_ALARM_SOUND_ID];
  const targetVolume = clampVolume(volume);
  const initialVolume = fadeIn ? Math.max(0.04, targetVolume * 0.2) : targetVolume;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(initialVolume, ctx.currentTime);
  if (fadeIn) {
    masterGain.gain.linearRampToValueAtTime(targetVolume, ctx.currentTime + 30);
  }
  masterGain.connect(ctx.destination);

  const playback: SynthPlayback = { ctx, masterGain, timers: [], nodes: [], stopped: false };
  if (mode === 'current') currentPlayback = playback;
  else previewPlayback = playback;

  let stereoLeft = true;
  const cycleDuration = pattern.steps.reduce((total, step) => total + step.duration + step.gap, 0) + pattern.repeatPause;

  const playCycle = () => {
    if (playback.stopped) return;
    let elapsed = 0;

    pattern.steps.forEach(step => {
      const timer = setTimeout(() => {
        stereoLeft = !stereoLeft;
        playToneStep(playback, step, stereoLeft ? -0.25 : 0.25);
      }, elapsed);
      playback.timers.push(timer);
      elapsed += step.duration + step.gap;
    });

    if (loop) {
      const nextCycleTimer = setTimeout(playCycle, cycleDuration);
      playback.timers.push(nextCycleTimer);
    } else {
      const cleanupTimer = setTimeout(() => {
        stopPlayback(playback);
        if (mode === 'preview' && previewPlayback === playback) previewPlayback = null;
        if (mode === 'current' && currentPlayback === playback) currentPlayback = null;
      }, cycleDuration + 150);
      playback.timers.push(cleanupTimer);
    }
  };

  playCycle();

  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate(loop ? pattern.vibrate : pattern.vibrate.slice(0, 5));
    }
  } catch {}
}

export async function previewSound(soundId: string, volume = 80) {
  await playSyntheticAlarm(soundId, volume, false, false, 'preview');
}

export function useAlarms(appointments: PersonalAppointment[]) {
  console.log('[Alarme] Hook useAlarms chamado com', appointments.length, 'compromissos');
  const triggeredAlarms = useRef<Set<string>>(new Set());
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
    console.log('[Alarme] useEffect iniciado com', appointments.length, 'compromissos');
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
      const delay = Math.max(1000, nextTriggerMs - 5000);
      console.log(`[Alarme] Próximo check agendado para daqui ${Math.round(delay / 1000)}s (trigger em ${Math.round(nextTriggerMs / 1000)}s)`);
      nextTimeout = setTimeout(checkAlarms, delay);
    };

    const checkAlarms = () => {
      try {
      if (soundsRef.current.length === 0) {
        console.log('[Alarme] Sons ainda não carregados, tentando novamente...');
        loadAlarmSounds().then(s => { soundsRef.current = s; }).catch(() => {});
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

        const secondsSinceTrigger = differenceInSeconds(now, triggerTime);

        console.log(`[Alarme] ${app.type}: trigger=${triggerTime.toLocaleTimeString('pt-BR')} evento=${todayOccurrence.toLocaleTimeString('pt-BR')} secSinceTrigger=${secondsSinceTrigger} advance=${advanceMins}min`);

        if (secondsSinceTrigger < 0) {
          const msUntilTrigger = Math.abs(secondsSinceTrigger) * 1000;
          if (nextTriggerMs === null || msUntilTrigger < nextTriggerMs) {
            nextTriggerMs = msUntilTrigger;
          }
          return;
        }

        if (secondsSinceTrigger <= 90) {
          const alarmKey = `${app.id}-${now.toDateString()}`;
          if (!triggeredAlarms.current.has(alarmKey)) {
            triggeredAlarms.current.add(alarmKey);
            triggeredCount++;

            const soundId = getFallbackAlarmSoundId(app.alarmSound);
            const meta = soundsRef.current.find(s => s.id === soundId) || soundsRef.current[0];
            console.log(`[Alarme] 🔔 DISPARANDO: ${app.type} (som: ${soundId}, volume: ${app.alarmVolume}, fadeIn: ${app.alarmFadeIn})`);
            if (meta) {
              void playSyntheticAlarm(meta.id, app.alarmVolume ?? 80, app.alarmFadeIn ?? false, true, 'current');
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

      scheduleNextCheck(nextTriggerMs ?? 30000);
      } catch (e) {
        console.error('[Alarme] ERRO no checkAlarms:', e);
        scheduleNextCheck(30000);
      }
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
