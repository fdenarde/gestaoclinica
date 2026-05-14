import { useEffect, useRef, useState, useCallback } from 'react';
import { PersonalAppointment, AlarmSound, AlarmAdvance } from '../types';
import { differenceInMinutes, parseISO, isBefore, addMinutes, format } from 'date-fns';

// Tabela de mapeamento para avanço em minutos
const advanceToMinutes = (advance?: AlarmAdvance): number => {
  switch (advance) {
    case 'Na hora': return 0;
    case '5 min': return 5;
    case '10 min': return 10;
    case '15 min': return 15;
    case '30 min': return 30;
    case '1 hora': return 60;
    default: return 0;
  }
};

// Gerador de sons simples usando Web Audio API
const playSound = (type: AlarmSound) => {
  if (type === 'Silencioso') return;

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const playBeep = (freq: number, type: OscillatorType, duration: number, startTime: number) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + startTime); // Volume
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start(audioCtx.currentTime + startTime);
    osc.stop(audioCtx.currentTime + startTime + duration);
  };

  switch (type) {
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
      for (let i = 0; i < 5; i++) {
        playBeep(1000, 'square', 0.1, i * 0.2);
      }
      break;
  }
};

export function useAlarms(appointments: PersonalAppointment[]) {
  // Guarda IDs dos compromissos já alertados hoje para não repetir infinitamente
  const triggeredAlarms = useRef<Set<string>>(new Set());
  const [permission, setPermission] = useState<NotificationPermission>(Notification.permission);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      setPermission(perm);
    }
  }, []);

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    const checkAlarms = () => {
      const now = new Date();
      
      appointments.forEach(app => {
        if (!app.alarmEnabled || app.isDone) return;
        
        // Assume date is YYYY-MM-DD and time is HH:MM
        // If recurrence is weekly or monthly, we should ideally check against the next occurrence.
        // For simplicity, we check if the time matches today if it falls on the recurrent day.
        
        // This simple check assumes the appointment happens today.
        // A more robust implementation would compute the exact Date object for the current/next occurrence.
        // We will build a basic occurrence checker here.
        
        const [year, month, day] = app.date.split('-').map(Number);
        const [hour, minute] = app.time.split(':').map(Number);
        
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

        // Build today's occurrence time
        const todayOccurrence = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
        
        const advanceMins = advanceToMinutes(app.alarmAdvance);
        const triggerTime = addMinutes(todayOccurrence, -advanceMins);
        
        // Se já passou o tempo de disparar, mas não passou de 5 minutos do horário do compromisso em si
        // Disparamos o alarme (margem de tolerância)
        const diffToTrigger = differenceInMinutes(now, triggerTime);
        const diffToEvent = differenceInMinutes(now, todayOccurrence);

        // Se está na hora do alarme (ou passou até 2 minutos do alarme) e ainda não passou o evento
        if (diffToTrigger >= 0 && diffToTrigger <= 2 && diffToEvent <= 0) {
          const alarmKey = `${app.id}-${now.toDateString()}`;
          
          if (!triggeredAlarms.current.has(alarmKey)) {
            triggeredAlarms.current.add(alarmKey);
            
            // Tocar som
            if (app.alarmSound) {
              playSound(app.alarmSound);
            }
            
            // Disparar Notificação
            if (permission === 'granted') {
              new Notification(`Lembrete: ${app.type}`, {
                body: app.notes ? app.notes : `Começa em ${app.alarmAdvance || 'breve'}`,
                icon: '/vite.svg' // placeholder icon
              });
            }
          }
        }
      });
    };

    const interval = setInterval(checkAlarms, 30000); // Check every 30 seconds
    checkAlarms(); // Check immediately on mount
    
    return () => clearInterval(interval);
  }, [appointments, permission]);

  return { requestPermission, permission };
}
