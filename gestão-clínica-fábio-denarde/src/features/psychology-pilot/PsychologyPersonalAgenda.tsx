import React, { useMemo } from 'react';
import PersonalAgenda from '../../components/PersonalAgenda';
import { useAlarms } from '../../lib/useAlarms';
import type { AppState, PersonalAppointment } from '../../types';
import {
  fromPsychologyPersonalAppointment,
  toPsychologyPersonalAppointment,
  type PsychologyPersonalCommitment,
  type PsychologyScope,
} from './psychologyDomain';

interface PsychologyPersonalAgendaProps {
  commitments: PsychologyPersonalCommitment[];
  scope: PsychologyScope;
  onPersist: (commitments: PsychologyPersonalCommitment[]) => boolean;
}

/** Reusa o motor maduro da Agenda Pessoal sem importar o domínio clínico da Neuro. */
export default function PsychologyPersonalAgenda({ commitments, scope, onPersist }: PsychologyPersonalAgendaProps) {
  const appointments = useMemo(() => commitments.map(toPsychologyPersonalAppointment), [commitments]);
  const alarmState = useAlarms(appointments);
  const state = useMemo(() => ({ personalAppointments: appointments } as AppState), [appointments]);

  const handleUpdate = async (patch: Partial<AppState>): Promise<boolean> => {
    if (!patch.personalAppointments) return true;
    const existingById = new Map(commitments.map(item => [item.id, item]));
    const next = (patch.personalAppointments as PersonalAppointment[]).map(item =>
      fromPsychologyPersonalAppointment(item, scope, existingById.get(item.id)),
    );
    return onPersist(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Esta agenda organiza sua rotina. Ela não é uma sessão clínica.</p>
      {alarmState.activeAlarmId && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900" role="status">
          <span><strong>Lembrete local:</strong> {alarmState.activeAlarmLabel}</span>
          <button type="button" onClick={alarmState.stopAlarm} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white">Parar alarme</button>
        </div>
      )}
      <PersonalAgenda
        state={state}
        onUpdate={handleUpdate}
        activeAlarmId={alarmState.activeAlarmId}
        activeAlarmLabel={alarmState.activeAlarmLabel}
        stopAlarm={alarmState.stopAlarm}
        variant="psychology"
      />
    </div>
  );
}
