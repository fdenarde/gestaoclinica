import React, { useMemo } from 'react';
import { AppState, SessionStatus, PaymentModal, Session, Reposition } from '../types';
import { Users, Calendar, DollarSign, Clock, AlertTriangle, Info, CheckCircle, Check, X } from 'lucide-react';
import { formatCurrency, getStatusColor, cn, calculateAge } from '../lib/utils';
import { format, isAfter, subDays, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { showToast } from './Common/Toast';

interface DashboardProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
  onNavigateToPatient?: (patientId: string) => void;
}

export default function Dashboard({ state, onUpdate, onNavigateToPatient }: DashboardProps) {

  const markAsRealized = (session: Session) => {
    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.REALIZADA } : s
    );
    const updatedRepositions = state.repositions.filter(r => !(r.originalSessionId === session.id && r.status === 'Pendente'));
    
    onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
    showToast(`Presença registrada.`);
  };

  const markAsMissed = (session: Session) => {
    if (state.repositions.some(r => r.originalSessionId === session.id && r.status === 'Pendente')) {
      showToast('Esta sessão já possui uma falta com reposição pendente.', 'error');
      return;
    }

    const updatedSessions = state.sessions.map(s => 
      s.id === session.id ? { ...s, status: SessionStatus.FALTA } : s
    );
    
    const newReposition: Reposition = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: session.patientId,
      originalSessionId: session.id,
      status: 'Pendente'
    };

    onUpdate({ 
      sessions: updatedSessions,
      repositions: [...state.repositions, newReposition]
    });
    showToast(`Falta registrada. Reposição pendente criada.`);
  };

  const markAsMissedProf = (session: Session) => {
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

    onUpdate({ 
      sessions: updatedSessions,
      repositions: [...state.repositions, newReposition]
    });
    showToast(`Sua falta registrada. Reposição pendente criada.`);
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
      const patientSessions = state.sessions.filter(s => s.patientId === patient.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO));
      const count = patientSessions.length % 10 || (patientSessions.length > 0 ? 10 : 0);
      const patientPayments = state.payments.filter(p => p.patientId === patient.id);

      // Rule: Parcelado - check 2nd payment after session 6
      if (patient.paymentModal === PaymentModal.PARCELADO) {
        const hasSecondPayment = patientPayments.some(p => p.installment === '2ª parcela');
        if (count >= 6 && !hasSecondPayment) {
          high.push({ message: `Pagamento em atraso: ${patient.name} - 2ª parcela não paga após a 6ª sessão.`, patientId: patient.id });
        } else if (count === 4 || count === 5) {
          medium.push({ message: `${patient.name} chegando à sessão ${count} - lembrar de cobrar 2ª parcela na sessão 5.`, patientId: patient.id });
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
    return state.sessions
      .filter(s => s.date === today)
      .map(s => ({
        ...s,
        patient: state.patients.find(p => p.id === s.patientId)
      }))
      .filter(s => s.patient && s.patient.status !== 'Concluído')
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [state]);

  return (
    <div className="flex flex-col gap-6 py-6">
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
          <h3 className="font-serif text-xl font-bold mb-4 border-b border-clinic-border pb-2">Próximas Sessões — Hoje</h3>
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
                    <p className="text-xs text-clinic-text-muted">Sessão {session.packageNumber} de 10</p>
                  </div>
                  
                  {session.status === SessionStatus.AGENDADA ? (
                    <div className="flex gap-1">
                      <button 
                        onClick={() => markAsRealized(session as any)}
                        className="p-1.5 text-status-green-text bg-status-green-bg hover:bg-green-200 rounded-lg transition-colors"
                        title="Marcar Presença"
                      >
                        <Check size={16} />
                      </button>
                      <button 
                        onClick={() => markAsMissed(session as any)}
                        className="p-1.5 text-status-red-text bg-status-red-bg hover:bg-red-200 rounded-lg transition-colors"
                        title="Marcar Falta Atendente"
                      >
                        <AlertTriangle size={16} />
                      </button>
                      <button 
                        onClick={() => markAsMissedProf(session as any)}
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
          <h3 className="font-serif text-xl font-bold mb-4 border-b border-clinic-border pb-2">Progresso dos Atendentes</h3>
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
