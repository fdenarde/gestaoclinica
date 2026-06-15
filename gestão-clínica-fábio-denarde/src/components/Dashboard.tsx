import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, SessionStatus, PaymentModal, Session, Reposition } from '../types';
import { Users, Calendar, DollarSign, Clock, AlertTriangle, Info, CheckCircle, Check, X, MessageCircle } from 'lucide-react';
import { formatCurrency, getStatusColor, cn, calculateAge, getSessionsForDate, normalizeTime, ProcessedSession } from '../lib/utils';
import { format, isAfter, subDays, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { showToast } from './Common/Toast';
import { getWhatsappReminderPlan } from '../lib/whatsappReminderPlan.js';
import { getSessionCycleLabel, getSessionCycleNumber } from '../lib/sessionSequence';
import { isPendingExternalRegistrationStatus } from '../lib/externalRegistration';
import { calculatePackageFinancialSummary } from '../lib/financePackages';
import AccessRequestsAdminCard from './Auth/AccessRequestsAdminCard';

interface DashboardProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => Promise<void>;
  onNavigateToPatient?: (patientId: string) => void;
  isPrimaryAdmin?: boolean;
}

export default function Dashboard({ state, onUpdate, onNavigateToPatient, isPrimaryAdmin = false }: DashboardProps) {
  const virtualActionLocksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const key of virtualActionLocksRef.current) {
      const [patientId, date, time] = key.split('|');
      const persisted = state.sessions.some(session =>
        session.patientId === patientId &&
        session.date === date &&
        normalizeTime(session.time) === time
      );
      if (persisted) virtualActionLocksRef.current.delete(key);
    }
  }, [state.sessions]);

  const markAsRealized = async (session: Session) => {
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.REALIZADA } : s
    );
    const updatedRepositions = state.repositions.filter(r => !(r.originalSessionId === session.id && r.status === 'Pendente'));

    try {
      await onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
      showToast('Presença registrada.');
    } catch (error) {
      console.error('Falha ao registrar presença pelo Dashboard:', error);
      showToast('Não foi possível registrar a presença.', 'error');
    }
  };

  const markAsMissed = async (session: Session) => {
    const consumesPackage = window.confirm(
      'Esta falta deve consumir uma das 10 sessões do pacote?\n\nOK = Sim, consumir a sessão.\nCancelar = Não consumir a sessão.'
    );
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }

    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA, consumesPackage } : s
    );
    
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };

    try {
      await onUpdate({
        sessions: updatedSessions,
        repositions: [...state.repositions, newReposition]
      });
      showToast('Falta registrada. Reposição pendente criada.');
    } catch (error) {
      console.error('Falha ao registrar falta pelo Dashboard:', error);
      showToast('Não foi possível registrar a falta.', 'error');
    }
  };

  const markAsMissedProf = async (session: Session) => {
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }

    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA_PROF } : s
    );
    
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };

    try {
      await onUpdate({
        sessions: updatedSessions,
        repositions: [...state.repositions, newReposition]
      });
      showToast('Sua falta registrada. Reposição pendente criada.');
    } catch (error) {
      console.error('Falha ao registrar falta do profissional pelo Dashboard:', error);
      showToast('Não foi possível registrar a falta do profissional.', 'error');
    }
  };

  const createRealFromVirtual = (virtualSession: ProcessedSession, newStatus: SessionStatus): { session: Session; reposition?: Reposition } | null => {
    const patient = state.patients.find(p => p.id === virtualSession.patientId);
    if (!patient || patient.status !== 'Ativo' || virtualSession.isBlocked) return null;

    const alreadyExists = state.sessions.some(s =>
      s.patientId === virtualSession.patientId &&
      s.date === virtualSession.date &&
      normalizeTime(s.time) === normalizeTime(virtualSession.time)
    );
    if (alreadyExists) return null;

    const previewSession: Session = {
      id: virtualSession.id,
      patientId: virtualSession.patientId,
      date: virtualSession.date,
      time: normalizeTime(virtualSession.time),
      type: virtualSession.type,
      status: newStatus,
      notes: virtualSession.notes || '',
      packageNumber: 0,
      isFixedSchedule: true,
      source: 'fixed',
      consumesPackage: newStatus === SessionStatus.FALTA
        ? window.confirm('Esta falta deve consumir uma das 10 sessões do pacote?\n\nOK = Sim.\nCancelar = Não.')
        : false
    };

    const nextSessionNumber = getSessionCycleNumber([...state.sessions, previewSession], previewSession);
    const newReal: Session = {
      ...previewSession,
      id: Math.random().toString(36).substr(2, 9),
      packageNumber: nextSessionNumber
    };

    let reposition: Reposition | undefined;
    if (newStatus === SessionStatus.FALTA || newStatus === SessionStatus.FALTA_PROF) {
      reposition = {
        id: Math.random().toString(36).substr(2, 9),
        patientId: patient.id,
        originalSessionId: newReal.id,
        status: 'Pendente'
      };
    }

    return { session: newReal, reposition };
  };

  const getVirtualActionKey = (session: ProcessedSession) =>
    `${session.patientId}|${session.date}|${normalizeTime(session.time)}`;

  const persistVirtualAction = async (
    session: ProcessedSession,
    newStatus: SessionStatus,
    successMessage: string,
  ): Promise<boolean> => {
    const actionKey = getVirtualActionKey(session);
    if (virtualActionLocksRef.current.has(actionKey)) {
      showToast('Este atendimento já está sendo registrado. Aguarde a atualização da Agenda.', 'error');
      return false;
    }

    const result = createRealFromVirtual(session, newStatus);
    if (!result) {
      showToast('A sessão fixa já foi registrada ou não está mais disponível. Atualize a tela e confira a Agenda.', 'error');
      return false;
    }

    virtualActionLocksRef.current.add(actionKey);
    try {
      await onUpdate({
        sessions: [...state.sessions, result.session],
        ...(result.reposition
          ? { repositions: [...state.repositions, result.reposition] }
          : {}),
      });
      showToast(successMessage);
      return true;
    } catch (error) {
      virtualActionLocksRef.current.delete(actionKey);
      console.error('Falha ao registrar atendimento fixo/virtual pelo Dashboard:', error);
      showToast('Não foi possível registrar o atendimento. Nenhuma confirmação foi gravada. Tente novamente.', 'error');
      return false;
    }
  };

  const handleMarkAsRealized = async (session: ProcessedSession) => {
    if (!session.isVirtual) {
      await markAsRealized(session);
      return;
    }

    await persistVirtualAction(session, SessionStatus.REALIZADA, 'Presença registrada.');
  };

  const handleMarkAsMissed = async (session: ProcessedSession) => {
    if (!session.isVirtual) {
      await markAsMissed(session);
      return;
    }

    await persistVirtualAction(session, SessionStatus.FALTA, 'Falta registrada. Reposição pendente criada.');
  };

  const handleMarkAsMissedProf = async (session: ProcessedSession) => {
    if (!session.isVirtual) {
      await markAsMissedProf(session);
      return;
    }

    await persistVirtualAction(session, SessionStatus.FALTA_PROF, 'Sua falta registrada. Reposição pendente criada.');
  };

  const attendanceRate = useMemo(() => {
    const concluded = state.sessions.filter(s => 
      s.status === SessionStatus.REALIZADA || 
      s.status === SessionStatus.REPOSICAO || 
      s.status === SessionStatus.FALTA
    );
    if (concluded.length === 0) return 100;
    const attended = concluded.filter(s => s.status !== SessionStatus.FALTA).length;
    return Math.round((attended / concluded.length) * 100);
  }, [state.sessions]);

  const birthdays = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    return state.patients.filter(p => {
      if (!p.birthDate) return false;
      const m = parseInt(p.birthDate.split('-')[1], 10) - 1;
      return m === currentMonth;
    }).sort((a, b) => {
      const dayA = parseInt(a.birthDate.split('-')[2], 10);
      const dayB = parseInt(b.birthDate.split('-')[2], 10);
      return dayA - dayB;
    });
  }, [state.patients]);

  const metrics = useMemo(() => {
    const activePatients = state.patients.filter(p => p.status === 'Ativo').length;
    
    // Sessions this week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    const weeklySessions = state.sessions.filter(s => {
      const d = new Date(s.date);
      return d >= startOfWeek && d <= endOfWeek;
    }).length;

    // Monthly income
    const monthlyPayments = state.payments.filter(p => {
      const d = new Date(p.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((sum, p) => sum + p.amount, 0);

    // Pending repositions
    const pendingRepositions = state.repositions.filter(r => r.status === 'Pendente').length;

    return { activePatients, weeklySessions, monthlyPayments, pendingRepositions };
  }, [state]);

  type AlertItem = { message: string; patientId?: string };
  const alerts = useMemo(() => {
    const high: AlertItem[] = [];
    const medium: AlertItem[] = [];
    const low: AlertItem[] = [];

    state.patients.forEach(patient => {
      const financialSummary = calculatePackageFinancialSummary(patient, state.sessions, state.payments, new Date());
      const count = financialSummary.completedSessionsInCurrentPackage;

      // Regra financeira: o aviso usa o mesmo pacote e os mesmos pagamentos exibidos na aba Pagamentos.
      // O rótulo da parcela não é usado isoladamente, porque pagamentos antigos ou cadastrados com
      // outra descrição não podem gerar uma cobrança falsa no pacote atual.
      if (patient.paymentModal === PaymentModal.PARCELADO && financialSummary.pendingGross > 0) {
        const firstInstallmentCovered = financialSummary.paidGross >= 500;

        if (count >= 6) {
          const message = firstInstallmentCovered
            ? `Pagamento em atraso: ${patient.name} - 2ª parcela ainda pendente após a ${count}ª sessão.`
            : `Pagamento em atraso: ${patient.name} possui ${formatCurrency(financialSummary.pendingGross)} pendentes no pacote atual após a ${count}ª sessão.`;
          high.push({ message, patientId: patient.id });
        } else if (count === 4 || count === 5) {
          const message = firstInstallmentCovered
            ? `${patient.name} chegou à sessão ${count} - lembrar de cobrar 2ª parcela na sessão 5.`
            : `${patient.name} chegou à sessão ${count} com ${formatCurrency(financialSummary.pendingGross)} pendentes no pacote atual.`;
          medium.push({ message, patientId: patient.id });
        }
      }

      // Rule: Package end suggestion
      if (count >= 8 && count <= 10) {
        medium.push({ message: `Pacote de ${patient.name} chegando ao fim (${count}/10) - sugerir renovação.`, patientId: patient.id });
      }

      // Rule: Inactivity
      const lastSession = [...state.sessions]
        .filter(s => s.patientId === patient.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      
      if (lastSession && differenceInDays(new Date(), new Date(lastSession.date)) > 14) {
        medium.push({ message: `${patient.name} sem sessão agendada há mais de 14 dias.`, patientId: patient.id });
      }

      // Rule: Consecutive Absences
      const sortedSessions = [...state.sessions]
        .filter(s => s.patientId === patient.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      if (sortedSessions.length >= 2 && sortedSessions[0].status === SessionStatus.FALTA && sortedSessions[1].status === SessionStatus.FALTA) {
        high.push({ message: `Atenção: ${patient.name} faltou às últimas 2 sessões consecutivas.`, patientId: patient.id });
      }
    });

    // Rule: End of month report reminder
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (today.getDate() >= lastDayOfMonth - 3) {
      low.push({ message: `O mês está terminando. Não esqueça de gerar os relatórios financeiros e de agenda.` });
    }

    // Rule: Multiple pending repositions for one patient
    const pendingByPatient: Record<string, number> = {};
    state.repositions.filter(r => r.status === 'Pendente').forEach(r => {
      pendingByPatient[r.patientId] = (pendingByPatient[r.patientId] || 0) + 1;
    });
    Object.entries(pendingByPatient).forEach(([pId, count]) => {
      if (count >= 3) {
        const pName = state.patients.find(p => p.id === pId)?.name || 'Atendente';
        high.push({ message: `${pName} tem ${count} reposições pendentes. Sugerido agendar semana de reforço.`, patientId: pId });
      }
    });

    // Rule: Old pending reposition
    state.repositions.filter(r => r.status === 'Pendente').forEach(r => {
      const originalSession = state.sessions.find(s => s.id === r.originalSessionId);
      if (originalSession && differenceInDays(new Date(), new Date(originalSession.date)) > 30) {
        high.push({ message: `Reposição pendente para ${state.patients.find(p => p.id === r.patientId)?.name} sem data há mais de 30 dias.`, patientId: r.patientId });
      }
    });

    return { high, medium, low };
  }, [state]);

  const todaySessions = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return getSessionsForDate({
      dateStr: today,
      patients: state.patients,
      sessions: state.sessions,
      settings: state.settings
    })
      .filter(s => !s.isBlocked)
      .map(s => ({
        ...s,
        patient: state.patients.find(p => p.id === s.patientId)
      }))
      .filter(s => s.patient && s.patient.status !== 'Concluído')
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [state.patients, state.sessions, state.settings]);

  const operationalPanel = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const todayPlanned = todaySessions.filter(s => s.status === SessionStatus.AGENDADA).length;
    const todayRealized = todaySessions.filter(s => s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO).length;
    const todayAbsences = todaySessions.filter(s => s.status === SessionStatus.FALTA || s.status === SessionStatus.FALTA_PROF).length;
    const pendingRepositions = state.repositions.filter(r => r.status === 'Pendente');
    const pendingExternalForms = (state.externalRegistrationForms || []).filter(form =>
      isPendingExternalRegistrationStatus(form.status)
    );
    const patientsNearRenewal = state.patients
      .filter(patient => patient.status === 'Ativo')
      .map(patient => {
        const realized = state.sessions.filter(s =>
          s.patientId === patient.id &&
          (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)
        ).length;
        const packageCount = realized === 0 ? 0 : (realized % 10 === 0 ? 10 : realized % 10);
        return { patient, packageCount };
      })
      .filter(item => item.packageCount >= 8)
      .sort((a, b) => b.packageCount - a.packageCount);
    const morningPlan = getWhatsappReminderPlan({
      runDateStr: today,
      tipo: 'HOJE_MANHA',
      patients: state.patients,
      sessions: state.sessions,
      settings: state.settings
    });
    const afternoonPlan = getWhatsappReminderPlan({
      runDateStr: today,
      tipo: 'HOJE_TARDE',
      patients: state.patients,
      sessions: state.sessions,
      settings: state.settings
    });
    const tomorrowPlan = getWhatsappReminderPlan({
      runDateStr: today,
      tipo: 'AMANHA',
      patients: state.patients,
      sessions: state.sessions,
      settings: state.settings
    });
    const whatsappTodayCount = morningPlan.reminders.length + afternoonPlan.reminders.length;
    const whatsappBlockedCount = morningPlan.diagnostics.length + afternoonPlan.diagnostics.length + tomorrowPlan.diagnostics.length;
    const whatsappTooltip = [
      'Monitor WhatsApp calculado pelo plano atual, sem enviar mensagens.',
      `Hoje/manhã: ${morningPlan.reminders.length} envio(s) previsto(s), ${morningPlan.diagnostics.length} bloqueio(s)/ignorado(s).`,
      `Hoje/tarde: ${afternoonPlan.reminders.length} envio(s) previsto(s), ${afternoonPlan.diagnostics.length} bloqueio(s)/ignorado(s).`,
      `Véspera: ${tomorrowPlan.reminders.length} envio(s) previsto(s), ${tomorrowPlan.diagnostics.length} bloqueio(s)/ignorado(s).`,
      morningPlan.isHoliday || afternoonPlan.isHoliday || tomorrowPlan.isHoliday
        ? 'Há feriado/recesso em pelo menos uma rotina calculada.'
        : 'Nenhum feriado/recesso bloqueando as rotinas calculadas.'
    ].join('\n');
    return {
      todayPlanned,
      todayRealized,
      todayAbsences,
      pendingRepositions,
      pendingExternalForms,
      patientsNearRenewal,
      whatsappTodayCount,
      whatsappMorningCount: morningPlan.reminders.length,
      whatsappAfternoonCount: afternoonPlan.reminders.length,
      whatsappTomorrowCount: tomorrowPlan.reminders.length,
      whatsappBlockedCount,
      whatsappHoliday: morningPlan.isHoliday || afternoonPlan.isHoliday || tomorrowPlan.isHoliday,
      whatsappTooltip
    };
  }, [state, todaySessions]);

  return (
    <div className="flex flex-col gap-6 py-6">
      {isPrimaryAdmin && <AccessRequestsAdminCard patients={state.patients} />}

      {/* Birthdays Alert */}
      {birthdays.length > 0 && (
        <div className="bg-status-blue-bg border-l-4 border-status-blue-text p-4 flex flex-col gap-3 rounded-r-lg shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-white p-2 rounded-full shadow-sm flex items-center justify-center">
              <span className="text-xl">🎂</span>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-status-blue-text tracking-[0.2em]">Aniversariantes do Mês</p>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 pl-12 md:pl-[52px]">
            {birthdays.map(p => {
              const parts = p.birthDate.split('-');
              const day = parts[2];
              const month = parts[1];
              const currentAge = calculateAge(p.birthDate);
              const phone = p.whatsapp ? p.whatsapp.replace(/\D/g, '') : '';
              
              // Se o aniversário ainda não passou este mês, a idade a completar é idade atual + 1, senão é a idade atual (já fez aniversário)
              const ageToComplete = new Date().getDate() <= parseInt(day, 10) && typeof currentAge === 'number' 
                ? currentAge + 1 
                : currentAge;

              const message = `Olá, ${p.guardianName.trim()}! Gostaríamos de desejar um feliz aniversário para ${p.name.trim()} que está completando ${ageToComplete} anos! 🎉🎂 Um grande abraço de toda a equipe!`;
              const whatsappLink = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;

              return (
                <div key={p.id} className="flex items-center justify-between bg-white/60 p-3 rounded-lg border border-status-blue-text/10 hover:shadow-sm transition-all">
                  <p className="text-sm font-bold text-clinic-text flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
                    {p.name} 
                    <span className="text-xs font-medium text-clinic-text-muted">
                      — {day}/{month} (completando {ageToComplete} anos)
                    </span>
                  </p>
                  {phone ? (
                    <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-white text-status-blue-text font-black text-[10px] uppercase tracking-widest rounded shadow-sm hover:bg-status-blue-text hover:text-white transition-all text-center">
                      Enviar Parabéns
                    </a>
                  ) : (
                    <span className="text-[10px] text-clinic-text-faint uppercase font-bold">Sem número</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Atendentes Ativos', value: metrics.activePatients, icon: Users, sub: 'atendimentos' },
          { label: 'Sessões na Semana', value: metrics.weeklySessions, icon: Calendar, sub: 'agendamentos' },
          { label: 'Assiduidade', value: `${attendanceRate}%`, icon: CheckCircle, sub: 'presença vs faltas' },
          { label: 'Recebido no Mês', value: formatCurrency(metrics.monthlyPayments), icon: DollarSign, sub: 'receita mensal' },
        ].map((item, idx) => (
          <div key={idx} className="bg-clinic-surface p-4 rounded-xl border border-clinic-border shadow-clinic flex flex-col hover:scale-[1.02] transition-transform">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[10px] uppercase font-black text-clinic-text-faint">{item.label}</p>
              <item.icon size={14} className="text-clinic-primary opacity-40" />
            </div>
            <p className="text-2xl font-bold text-clinic-text">{item.value}</p>
            <p className="text-[10px] text-clinic-text-muted mt-1 uppercase font-bold tracking-tight opacity-60">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Painel operacional */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-clinic-surface border border-clinic-border rounded-xl p-5 shadow-clinic">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-clinic-text">Hoje na Clínica</h3>
            <Calendar size={18} className="text-clinic-primary" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-clinic-bg rounded-lg p-3 text-center border border-clinic-border/60">
              <p className="text-2xl font-bold text-clinic-text">{operationalPanel.todayPlanned}</p>
              <p className="text-[10px] font-black uppercase text-clinic-text-faint">Agendadas</p>
            </div>
            <div className="bg-status-green-bg rounded-lg p-3 text-center border border-status-green-text/20">
              <p className="text-2xl font-bold text-status-green-text">{operationalPanel.todayRealized}</p>
              <p className="text-[10px] font-black uppercase text-status-green-text">Realizadas</p>
            </div>
            <div className="bg-status-red-bg rounded-lg p-3 text-center border border-status-red-text/20">
              <p className="text-2xl font-bold text-status-red-text">{operationalPanel.todayAbsences}</p>
              <p className="text-[10px] font-black uppercase text-status-red-text">Faltas</p>
            </div>
          </div>
        </div>

        <div className="bg-clinic-surface border border-clinic-border rounded-xl p-5 shadow-clinic">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-clinic-text">Pendências</h3>
            <AlertTriangle size={18} className="text-status-orange-text" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-clinic-bg rounded-lg px-3 py-2 border border-clinic-border/60">
              <span className="text-xs font-bold text-clinic-text-muted uppercase">Formulários recebidos</span>
              <span className={cn("text-sm font-black", operationalPanel.pendingExternalForms.length > 0 ? "text-status-orange-text" : "text-status-green-text")}>
                {operationalPanel.pendingExternalForms.length}
              </span>
            </div>
            <div className="flex justify-between items-center bg-clinic-bg rounded-lg px-3 py-2 border border-clinic-border/60">
              <span className="text-xs font-bold text-clinic-text-muted uppercase">Reposições pendentes</span>
              <span className={cn("text-sm font-black", operationalPanel.pendingRepositions.length > 0 ? "text-status-orange-text" : "text-status-green-text")}>
                {operationalPanel.pendingRepositions.length}
              </span>
            </div>
            <div className="flex justify-between items-center bg-clinic-bg rounded-lg px-3 py-2 border border-clinic-border/60">
              <span className="text-xs font-bold text-clinic-text-muted uppercase">Pacotes para renovar</span>
              <span className={cn("text-sm font-black", operationalPanel.patientsNearRenewal.length > 0 ? "text-status-orange-text" : "text-status-green-text")}>
                {operationalPanel.patientsNearRenewal.length}
              </span>
            </div>
            {operationalPanel.patientsNearRenewal.slice(0, 2).map(({ patient, packageCount }) => (
              <button
                key={patient.id}
                onClick={() => onNavigateToPatient?.(patient.id)}
                className="w-full text-left text-xs font-bold text-clinic-primary hover:underline"
              >
                {patient.name}: {packageCount}/10 sessões
              </button>
            ))}
          </div>
        </div>

        <div
          className="bg-clinic-surface border border-clinic-border rounded-xl p-5 shadow-clinic"
          title={operationalPanel.whatsappTooltip}
          aria-label={operationalPanel.whatsappTooltip}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-clinic-text">WhatsApp</h3>
            <MessageCircle size={18} className="text-status-green-text" title={operationalPanel.whatsappTooltip} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div
              className="bg-status-green-bg rounded-lg p-3 text-center border border-status-green-text/20"
              title={`Mensagens do dia previstas: ${operationalPanel.whatsappTodayCount}\nManhã: ${operationalPanel.whatsappMorningCount}\nTarde: ${operationalPanel.whatsappAfternoonCount}`}
            >
              <p className="text-2xl font-bold text-status-green-text">{operationalPanel.whatsappTodayCount}</p>
              <p className="text-[10px] font-black uppercase text-status-green-text">Hoje</p>
            </div>
            <div
              className="bg-status-blue-bg rounded-lg p-3 text-center border border-status-blue-text/20"
              title={`Mensagens de véspera previstas para o próximo dia útil calculado: ${operationalPanel.whatsappTomorrowCount}`}
            >
              <p className="text-2xl font-bold text-status-blue-text">{operationalPanel.whatsappTomorrowCount}</p>
              <p className="text-[10px] font-black uppercase text-status-blue-text">Véspera</p>
            </div>
            <div
              className="bg-clinic-bg rounded-lg p-3 text-center border border-clinic-border/60"
              title={`Bloqueios/ignorados no plano calculado: ${operationalPanel.whatsappBlockedCount}\nInclui feriado, cancelamento, falta de WhatsApp, paciente inativo, fora do turno ou deduplicação.`}
            >
              <p className="text-2xl font-bold text-clinic-text">{operationalPanel.whatsappBlockedCount}</p>
              <p className="text-[10px] font-black uppercase text-clinic-text-faint">Bloqueios</p>
            </div>
          </div>
          {operationalPanel.whatsappHoliday && (
            <p className="text-[11px] font-bold text-status-orange-text mt-3 bg-status-orange-bg border border-status-orange-text/20 rounded-lg px-3 py-2">
              Há bloqueio por feriado/recesso em alguma rotina calculada.
            </p>
          )}
        </div>
      </section>

      {/* Alertas Automáticos */}
      {(alerts.high.length > 0 || alerts.medium.length > 0 || alerts.low.length > 0) && (
        <section className="flex flex-col gap-3 shrink-0">
          {alerts.high.map((alert, i) => (
            <div key={`h-${i}`} className="bg-status-red-bg border-l-4 border-status-red-text p-4 flex justify-between items-center rounded-r-lg shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-status-red-text font-black text-[10px] tracking-tighter uppercase">Alerta Crítico</span>
                <span className="text-clinic-text text-sm font-medium">{alert.message}</span>
              </div>
              {alert.patientId && onNavigateToPatient && (
                <button onClick={() => onNavigateToPatient(alert.patientId!)} className="text-status-red-text font-bold text-xs underline decoration-2 underline-offset-2 hover:opacity-70 transition-opacity">Resolver</button>
              )}
            </div>
          ))}
          {alerts.medium.map((alert, i) => (
            <div key={`m-${i}`} className="bg-status-orange-bg border-l-4 border-status-orange-text p-4 flex justify-between items-center rounded-r-lg shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-status-orange-text font-black text-[10px] tracking-tighter uppercase">Atenção</span>
                <span className="text-clinic-text text-sm font-medium">{alert.message}</span>
              </div>
              {alert.patientId && onNavigateToPatient && (
                <button onClick={() => onNavigateToPatient(alert.patientId!)} className="text-status-orange-text font-bold text-xs underline decoration-2 underline-offset-2 hover:opacity-70 transition-opacity">Visualizar</button>
              )}
            </div>
          ))}
          {alerts.low.map((alert, i) => (
            <div key={`l-${i}`} className="bg-clinic-bg/50 border-l-4 border-clinic-text-faint p-4 flex justify-between items-center rounded-r-lg shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-clinic-text-faint font-black text-[10px] tracking-tighter uppercase">Aviso</span>
                <span className="text-clinic-text text-sm font-medium">{alert.message}</span>
              </div>
              {alert.patientId && onNavigateToPatient && (
                <button onClick={() => onNavigateToPatient(alert.patientId!)} className="text-clinic-text-muted font-bold text-xs underline decoration-2 underline-offset-2 hover:opacity-70 transition-opacity">Verificar</button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Lists Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* Próximas Sessões */}
        <div className="bg-clinic-surface rounded-2xl border border-clinic-border p-6 flex flex-col shadow-clinic overflow-hidden">
          <h3 className="text-xl font-bold mb-4 border-b border-clinic-border pb-2">Próximas Sessões — Hoje</h3>
          <div className="flex flex-col gap-3 overflow-y-auto">
            {todaySessions.length > 0 ? (
              todaySessions.map(session => (
                <div key={session.id} className={cn(
                  "flex items-center gap-4 p-3 border rounded-lg hover:shadow-sm transition-all group relative",
                  session.status === SessionStatus.REALIZADA ? 'bg-blue-500/10 border-blue-400 border-dashed' :
                  session.status === SessionStatus.FALTA ? 'bg-red-500/10 border-red-500/20' :
                  session.status === SessionStatus.FALTA_PROF ? 'bg-orange-500/10 border-orange-500/20' :
                  'bg-white border-clinic-border'
                )}>
                  <div className="text-clinic-header font-black text-lg w-16">{session.time}</div>
                  <div className="flex-1">
                    <p className="font-bold text-clinic-text tracking-tight">{session.patient?.name}</p>
                    <p className="text-xs text-clinic-text-muted">{getSessionCycleLabel(state.sessions, session) || 'Sessão sem número definido'}</p>
                  </div>
                  
                  {session.status === SessionStatus.AGENDADA ? (
                    <div className="flex gap-1">
                      <button 
                        onClick={() => handleMarkAsRealized(session)}
                        className="p-1.5 text-status-green-text bg-status-green-bg hover:bg-green-200 rounded-lg transition-colors"
                        title="Marcar Presença"
                      >
                        <Check size={16} />
                      </button>
                      <button 
                        onClick={() => handleMarkAsMissed(session)}
                        className="p-1.5 text-status-red-text bg-status-red-bg hover:bg-red-200 rounded-lg transition-colors"
                        title="Marcar Falta Atendente"
                      >
                        <AlertTriangle size={16} />
                      </button>
                      <button 
                        onClick={() => handleMarkAsMissedProf(session)}
                        className="p-1.5 text-status-orange-text bg-status-orange-bg hover:bg-orange-200 rounded-lg transition-colors"
                        title="Minha Falta"
                      >
                        <AlertTriangle size={16} />
                      </button>
                    </div>
                  ) : (
                    <span className={cn(
                      "px-3 py-1 text-[10px] font-black rounded-full uppercase tracking-widest",
                      getStatusColor(session.status)
                    )}>
                      {session.status}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="h-40 flex flex-col items-center justify-center text-clinic-text-faint opacity-50 italic">
                <Info size={32} className="mb-2" />
                <p className="text-sm">Nenhuma sessão marcada para hoje.</p>
              </div>
            )}
          </div>
        </div>

        {/* Progresso de Atendentes */}
        <div className="bg-clinic-surface rounded-2xl border border-clinic-border p-6 flex flex-col shadow-clinic overflow-hidden">
          <h3 className="text-xl font-bold mb-4 border-b border-clinic-border pb-2">Progresso dos Atendentes</h3>
          <div className="flex flex-col gap-5 overflow-y-auto pr-2 custom-scrollbar">
            {state.patients.filter(p => p.status === 'Ativo').slice(0, 10).map(patient => {
              const getRealizedCount = (patientId: string) => state.sessions.filter(s => s.patientId === patientId && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).length;
              const totalRealized = getRealizedCount(patient.id);
              const count = totalRealized % 10 || (totalRealized > 0 ? 10 : 0);
              const percentage = (count / 10) * 100;
              return (
                <div key={patient.id} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-bold text-clinic-text tracking-tight">{patient.name}</p>
                    <span className="text-xs font-black text-clinic-text-faint">{count}/10</span>
                  </div>
                  <div className="w-full bg-clinic-nav-bg h-2.5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      className={cn(
                        "h-full rounded-full transition-all duration-1000",
                        percentage >= 90 ? "bg-status-green-text" : percentage >= 50 ? "bg-status-orange-text" : "bg-clinic-primary"
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
