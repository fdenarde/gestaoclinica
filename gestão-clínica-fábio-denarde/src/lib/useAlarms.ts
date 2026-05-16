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
let globalCompressor: DynamicsCompressorNode | null = null;
let globalMasterGain: GainNode | null = null;
let globalOscillators: OscillatorNode[] = [];
let globalLoopInterval: ReturnType<typeof setInterval> | null = null;
let globalFadeInInterval: ReturnType<typeof setInterval> | null = null;
let globalStereoDir = 0; // alterna 0=left, 1=right

function ensureAudioContext(): AudioContext | null {
  if (globalAudioCtx && globalAudioCtx.state !== 'closed') return globalAudioCtx;
  try {
    globalAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
  return globalAudioCtx;
}

function buildChain(ctx: AudioContext) {
  // DynamicsCompressorNode — evita distorção em volume alto
  if (!globalCompressor) {
    globalCompressor = ctx.createDynamicsCompressor();
    globalCompressor.threshold.value = -24;
    globalCompressor.knee.value = 12;
    globalCompressor.ratio.value = 12;
    globalCompressor.attack.value = 0.003;
    globalCompressor.release.value = 0.25;
  }
  // Master gain
  if (!globalMasterGain) {
    globalMasterGain = ctx.createGain();
    globalMasterGain.gain.value = 0;
  }
  globalCompressor.connect(globalMasterGain);
  globalMasterGain.connect(ctx.destination);
}

function setVolume(vol: number) {
  if (globalMasterGain) {
    const t = globalAudioCtx?.currentTime ?? 0;
    globalMasterGain.gain.cancelScheduledValues(t);
    globalMasterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1, vol / 100)), t);
  }
}

function startFadeIn(targetVol: number, durationSec = 30) {
  if (!globalMasterGain || !globalAudioCtx) return;
  const ctx = globalAudioCtx;
  const now = ctx.currentTime;
  globalMasterGain.gain.cancelScheduledValues(now);
  globalMasterGain.gain.setValueAtTime(0.01, now);
  globalMasterGain.gain.linearRampToValueAtTime(Math.max(0.01, targetVol / 100), now + durationSec);
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate(pattern);
    }
  } catch {}
}

function stopAllSounds() {
  if (globalLoopInterval) { clearInterval(globalLoopInterval); globalLoopInterval = null; }
  if (globalFadeInInterval) { clearInterval(globalFadeInInterval); globalFadeInInterval = null; }
  globalOscillators.forEach(osc => { try { osc.stop(); } catch {} });
  globalOscillators = [];
  if (globalAudioCtx && globalAudioCtx.state !== 'closed') {
    try { globalAudioCtx.close(); } catch {}
  }
  globalAudioCtx = null;
  globalCompressor = null;
  globalMasterGain = null;
  vibrate(0);
}

async function resumeAudio(): Promise<boolean> {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { return false; }
  }
  return ctx.state === 'running';
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

// ── Preview (toca 2s, uma vez) ──
export async function previewSound(type: AlarmSound | string, volume: number = 80) {
  stopAllSounds();
  const ok = await resumeAudio();
  if (!ok) return;
  const ctx = globalAudioCtx!;
  buildChain(ctx);
  setVolume(volume);

  const normalized = normalizeSound(type);
  const now = ctx.currentTime;

  function beep(freq: number, oscType: OscillatorType, start: number, len: number, panVal: number = 0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now + start);
    g.gain.setValueAtTime(0.35, now + start);
    g.gain.exponentialRampToValueAtTime(0.001, now + start + len);
    pan.pan.setValueAtTime(panVal, now);
    osc.connect(g);
    g.connect(pan);
    pan.connect(globalCompressor!);
    osc.start(now + start);
    osc.stop(now + start + len);
    globalOscillators.push(osc);
  }

  playPattern(normalized, beep, 2, false);
}

// ── Alarme (loop contínuo) ──
export async function playAlarmSound(type: AlarmSound | string, volume: number = 80, fadeIn: boolean = false) {
  stopAllSounds();
  const ok = await resumeAudio();
  if (!ok) return;
  const ctx = globalAudioCtx!;
  buildChain(ctx);

  if (fadeIn) {
    startFadeIn(volume, 30);
  } else {
    setVolume(volume);
  }

  // Vibração: padrão alternado 500ms
  vibrate([500, 200, 500, 200, 500]);

  const normalized = normalizeSound(type);
  globalStereoDir = 0;

  function playOneCycle() {
    if (!globalAudioCtx || globalAudioCtx.state === 'closed') return;
    const now = globalAudioCtx.currentTime;

    function beep(freq: number, oscType: OscillatorType, start: number, len: number, panVal: number = 0) {
      if (!globalAudioCtx) return;
      const osc = globalAudioCtx.createOscillator();
      const g = globalAudioCtx.createGain();
      const pan = globalAudioCtx.createStereoPanner();
      osc.type = oscType;
      osc.frequency.setValueAtTime(freq, now + start);
      g.gain.setValueAtTime(0.35, now + start);
      g.gain.exponentialRampToValueAtTime(0.001, now + start + len);
      pan.pan.setValueAtTime(panVal, now);
      osc.connect(g);
      g.connect(pan);
      pan.connect(globalCompressor!);
      osc.start(now + start);
      osc.stop(now + start + len);
      globalOscillators.push(osc);
    }

    playPattern(normalized, beep, 1000, true);
  }

  playOneCycle();

  const cycleDuration = getPatternDuration(normalized);
  globalLoopInterval = setInterval(() => {
    globalOscillators.forEach(osc => { try { osc.stop(); } catch {} });
    globalOscillators = [];
    playOneCycle();
    // Vibração a cada ciclo
    vibrate(300);
  }, cycleDuration);
}

// ── Padrões de som (frequências 1000–4000 Hz) ──
type BeepFn = (freq: number, oscType: OscillatorType, start: number, len: number, panVal?: number) => void;

function playPattern(name: string, beep: BeepFn, maxDuration: number, stereo: boolean) {
  const panL = stereo ? -0.7 : 0;
  const panR = stereo ? 0.7 : 0;

  switch (name) {
    // ── Suaves ──
    case 'Sino suave': {
      beep(1200, 'sine', 0, 0.3, panL);
      if (maxDuration > 0.3) beep(1600, 'sine', 0.2, 0.5, panR);
      break;
    }
    case 'Notificação padrão': {
      beep(1100, 'sine', 0, 0.15, panL);
      if (maxDuration > 0.15) beep(1400, 'sine', 0.15, 0.25, panR);
      break;
    }
    case 'Melodia relaxante': {
      beep(1200, 'sine', 0, 0.4, panL);
      if (maxDuration > 0.3) beep(1500, 'sine', 0.3, 0.4, panR);
      if (maxDuration > 0.6) beep(1800, 'sine', 0.6, 0.6, panL);
      break;
    }
    case 'Marimba': {
      const notes = [1318, 1174, 987, 880, 1046, 1174, 1318, 1568];
      notes.forEach((f, i) => {
        const t = i * 0.18;
        if (t + 0.16 > maxDuration) return;
        beep(f, 'sine', t, 0.16, i % 2 === 0 ? panL : panR);
      });
      break;
    }

    // ── Médios ──
    case 'Bipe curto': {
      for (let i = 0; i < 20; i++) {
        const t = i * 0.4;
        if (t + 0.1 > maxDuration) break;
        beep(1400, 'square', t, 0.1, i % 2 === 0 ? panL : panR);
      }
      break;
    }
    case 'Toque duplo': {
      for (let i = 0; i < 10; i++) {
        const t = i * 0.7;
        if (t + 0.5 > maxDuration) break;
        beep(1600, 'sine', t, 0.12, panL);
        beep(1800, 'sine', t + 0.2, 0.12, panR);
      }
      break;
    }
    case 'Digital repetitivo': {
      for (let i = 0; i < 16; i++) {
        const t = i * 0.25;
        if (t + 0.2 > maxDuration) break;
        beep(1800, 'square', t, 0.08, panL);
        beep(2200, 'square', t + 0.08, 0.08, panR);
      }
      break;
    }
    case 'Toque de telefone': {
      for (let i = 0; i < 6; i++) {
        const t = i * 0.8;
        if (t + 0.6 > maxDuration) break;
        beep(1200, 'sine', t, 0.3, panL);
        beep(1500, 'sine', t + 0.1, 0.3, panR);
        beep(1200, 'sine', t + 0.4, 0.2, panL);
      }
      break;
    }

    // ── Fortes ──
    case 'Alerta urgente': {
      for (let i = 0; i < 12; i++) {
        const t = i * 0.15;
        if (t + 0.12 > maxDuration) break;
        beep(2000, 'square', t, 0.12, panL);
        beep(2500, 'square', t + 0.06, 0.12, panR);
      }
      break;
    }
    case 'Sirene': {
      for (let i = 0; i < 16; i++) {
        const t = i * 0.2;
        if (t + 0.18 > maxDuration) break;
        const freq = 1000 + (i % 8) * 300;
        beep(freq, 'sawtooth', t, 0.18, i % 2 === 0 ? panL : panR);
      }
      break;
    }
    case 'Alarme pulsante': {
      for (let i = 0; i < 10; i++) {
        const t = i * 0.5;
        if (t + 0.4 > maxDuration) break;
        beep(1800, 'square', t, 0.15, panL);
        beep(2400, 'square', t + 0.1, 0.15, panR);
        beep(3000, 'square', t + 0.25, 0.1, panL);
      }
      break;
    }
    case 'Pulse forte': {
      for (let i = 0; i < 8; i++) {
        const t = i * 1.0;
        if (t + 0.8 > maxDuration) break;
        beep(1200, 'square', t, 0.4, panL);
        beep(1500, 'square', t + 0.1, 0.3, panR);
        beep(1800, 'square', t + 0.5, 0.2, panL);
      }
      break;
    }
    case 'Urgência crescente': {
      for (let i = 0; i < 30; i++) {
        const t = i * (i < 10 ? 0.4 : i < 20 ? 0.25 : 0.12);
        if (t + 0.1 > maxDuration) break;
        beep(1500 + i * 50, 'square', t, 0.08, i % 2 === 0 ? panL : panR);
      }
      break;
    }
    case 'Campainha escola': {
      for (let i = 0; i < 3; i++) {
        const t = i * 1.5;
        if (t + 1.2 > maxDuration) break;
        beep(2000, 'sine', t, 0.6, panL);
        beep(2500, 'sine', t + 0.1, 0.5, panR);
        beep(3000, 'sine', t + 0.4, 0.4, panL);
      }
      break;
    }
    case 'Alerta militar': {
      for (let i = 0; i < 8; i++) {
        const t = i * 0.3;
        if (t + 0.25 > maxDuration) break;
        beep(1200, 'square', t, 0.1, panL);
        beep(1200, 'square', t + 0.12, 0.1, panL);
        beep(1800, 'square', t + 0.18, 0.1, panR);
      }
      break;
    }
    case 'Clássico Nokia': {
      const nokiaNotes = [1468, 1234, 987, 1108, 987, 1234, 1468, 1234, 987, 1108, 987, 880, 987, 1108, 1234, 1468];
      nokiaNotes.forEach((f, i) => {
        const t = i * 0.12;
        if (t + 0.11 > maxDuration) return;
        beep(f, 'square', t, 0.11, i % 2 === 0 ? panL : panR);
      });
      break;
    }
  }
}

function getPatternDuration(name: string): number {
  switch (name) {
    case 'Sino suave': return 1200;
    case 'Notificação padrão': return 800;
    case 'Melodia relaxante': return 1500;
    case 'Marimba': return 2000;
    case 'Bipe curto': return 4000;
    case 'Toque duplo': return 3600;
    case 'Digital repetitivo': return 2100;
    case 'Toque de telefone': return 5000;
    case 'Alerta urgente': return 2000;
    case 'Sirene': return 3500;
    case 'Alarme pulsante': return 5000;
    case 'Pulse forte': return 6000;
    case 'Urgência crescente': return 4500;
    case 'Campainha escola': return 5000;
    case 'Alerta militar': return 2600;
    case 'Clássico Nokia': return 2500;
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
            playAlarmSound(app.alarmSound || 'Notificação padrão', app.alarmVolume ?? 80, app.alarmFadeIn ?? false);
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
    };
    const interval = setInterval(checkAlarms, 30000);
    checkAlarms();
    return () => clearInterval(interval);
  }, [appointments, permission, stopAlarm]);

  return { requestPermission, permission, activeAlarmId, activeAlarmLabel, stopAlarm, setVolume };
}
