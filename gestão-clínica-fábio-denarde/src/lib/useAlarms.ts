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

// ── Áudio global ──
let globalAudioCtx: AudioContext | null = null;
let globalOscillators: OscillatorNode[] = [];
let globalLoopInterval: ReturnType<typeof setInterval> | null = null;
let globalGainNode: GainNode | null = null;

function ensureAudioContext(): AudioContext | null {
  if (globalAudioCtx && globalAudioCtx.state !== 'closed') return globalAudioCtx;
  try {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
  return globalAudioCtx;
}

async function resumeAudio(): Promise<boolean> {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { return false; }
  }
  return ctx.state === 'running';
}

function setVolume(vol: number) {
  if (globalGainNode) {
    globalGainNode.gain.value = Math.max(0, Math.min(1, vol / 100));
  }
}

function stopAllSounds() {
  if (globalLoopInterval) {
    clearInterval(globalLoopInterval);
    globalLoopInterval = null;
  }
  globalOscillators.forEach(osc => {
    try { osc.stop(); } catch {}
  });
  globalOscillators = [];
  if (globalAudioCtx && globalAudioCtx.state !== 'closed') {
    try { globalAudioCtx.close(); } catch {}
  }
  globalAudioCtx = null;
  globalGainNode = null;
}

// ── Normaliza nomes legacy ──
function normalizeSound(type: string): string {
  switch (type) {
    case 'Ding': return 'Notificação padrão';
    case 'Bell': return 'Sino suave';
    case 'Chime': return 'Melodia relaxante';
    case 'Digital': return 'Alerta urgente';
    default: return type;
  }
}

// ── Som de preview (toca uma vez, 2 segundos, depois para) ──
export async function previewSound(type: AlarmSound | string, volume: number = 80) {
  stopAllSounds();
  const ok = await resumeAudio();
  if (!ok) return;
  const ctx = globalAudioCtx!;

  globalGainNode = ctx.createGain();
  globalGainNode.gain.value = Math.max(0, Math.min(1, volume / 100));
  globalGainNode.connect(ctx.destination);

  const now = ctx.currentTime;
  const dur = 2;
  const normalized = normalizeSound(type);

  function beep(freq: number, oscType: OscillatorType, start: number, len: number) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now + start);
    g.gain.setValueAtTime(0.4, now + start);
    g.gain.exponentialRampToValueAtTime(0.001, now + start + len);
    osc.connect(g);
    g.connect(globalGainNode!);
    osc.start(now + start);
    osc.stop(now + start + len);
    globalOscillators.push(osc);
  }

  playPattern(normalized, beep, dur);
}

// ── Som de alarme (loop contínuo até parar) ──
export async function playAlarmSound(type: AlarmSound | string, volume: number = 80) {
  stopAllSounds();
  const ok = await resumeAudio();
  if (!ok) return;
  const ctx = globalAudioCtx!;

  globalGainNode = ctx.createGain();
  globalGainNode.gain.value = Math.max(0, Math.min(1, volume / 100));
  globalGainNode.connect(ctx.destination);

  const normalized = normalizeSound(type);

  function playOneCycle() {
    if (!globalAudioCtx || globalAudioCtx.state === 'closed') return;
    const now = globalAudioCtx.currentTime;

    function beep(freq: number, oscType: OscillatorType, start: number, len: number) {
      if (!globalAudioCtx) return;
      const osc = globalAudioCtx.createOscillator();
      const g = globalAudioCtx.createGain();
      osc.type = oscType;
      osc.frequency.setValueAtTime(freq, now + start);
      g.gain.setValueAtTime(0.4, now + start);
      g.gain.exponentialRampToValueAtTime(0.001, now + start + len);
      osc.connect(g);
      g.connect(globalGainNode!);
      osc.start(now + start);
      osc.stop(now + start + len);
      globalOscillators.push(osc);
    }

    playPattern(normalized, beep, 1000);
  }

  // Primeiro ciclo imediato, depois repete
  playOneCycle();

  const cycleDuration = getPatternDuration(normalized);
  globalLoopInterval = setInterval(() => {
    // Limpa osciladores do ciclo anterior
    globalOscillators.forEach(osc => {
      try { osc.stop(); } catch {}
    });
    globalOscillators = [];
    playOneCycle();
  }, cycleDuration);
}

// ── Padrões de som ──
type BeepFn = (freq: number, oscType: OscillatorType, start: number, len: number) => void;

function playPattern(name: string, beep: BeepFn, maxDuration: number) {
  switch (name) {
    case 'Sino suave': {
      if (maxDuration > 0.3) { beep(880, 'sine', 0, 0.3); beep(1100, 'sine', 0.2, 0.4); }
      break;
    }
    case 'Notificação padrão': {
      if (maxDuration > 0.2) { beep(600, 'sine', 0, 0.15); beep(800, 'sine', 0.15, 0.25); }
      break;
    }
    case 'Melodia relaxante': {
      beep(440, 'sine', 0, 0.4);
      if (maxDuration > 0.3) beep(554, 'sine', 0.3, 0.4);
      if (maxDuration > 0.6) beep(659, 'sine', 0.6, 0.6);
      break;
    }
    case 'Alerta urgente': {
      for (let i = 0; i < 12; i++) {
        const t = i * 0.15;
        if (t + 0.12 > maxDuration) break;
        beep(1000, 'square', t, 0.12);
        beep(1200, 'square', t + 0.06, 0.12);
      }
      break;
    }
    case 'Bipe curto': {
      for (let i = 0; i < 20; i++) {
        const t = i * 0.4;
        if (t + 0.1 > maxDuration) break;
        beep(800, 'square', t, 0.1);
      }
      break;
    }
    case 'Sirene': {
      for (let i = 0; i < 16; i++) {
        const t = i * 0.2;
        if (t + 0.18 > maxDuration) break;
        const freq = 400 + (i % 8) * 120;
        beep(freq, 'sawtooth', t, 0.18);
      }
      break;
    }
    case 'Alarme pulsante': {
      for (let i = 0; i < 10; i++) {
        const t = i * 0.5;
        if (t + 0.4 > maxDuration) break;
        beep(600, 'square', t, 0.15);
        beep(900, 'square', t + 0.1, 0.15);
        beep(1200, 'square', t + 0.25, 0.1);
      }
      break;
    }
    case 'Toque de telefone': {
      for (let i = 0; i < 6; i++) {
        const t = i * 0.8;
        if (t + 0.6 > maxDuration) break;
        beep(440, 'sine', t, 0.3);
        beep(550, 'sine', t + 0.1, 0.3);
        beep(440, 'sine', t + 0.4, 0.2);
      }
      break;
    }
  }
}

// ── Duração de cada ciclo (ms) ──
function getPatternDuration(name: string): number {
  switch (name) {
    case 'Sino suave': return 1200;
    case 'Notificação padrão': return 800;
    case 'Melodia relaxante': return 1500;
    case 'Alerta urgente': return 2000;
    case 'Bipe curto': return 4000;
    case 'Sirene': return 3500;
    case 'Alarme pulsante': return 5000;
    case 'Toque de telefone': return 5000;
    default: return 2000;
  }
}

// ── Hook ──
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

            playAlarmSound(app.alarmSound || 'Notificação padrão', app.alarmVolume ?? 80);

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

  return { requestPermission, permission, activeAlarmId, activeAlarmLabel, stopAlarm, setVolume };
}
