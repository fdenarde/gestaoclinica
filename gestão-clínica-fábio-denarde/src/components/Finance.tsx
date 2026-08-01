import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Payment, Expense, PaymentModal } from '../types';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, Calendar as CalendarIcon, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, DollarSign, HandCoins, History, Info, Link, Minus, Plus, Search, ShieldCheck, Sparkles, TimerReset, Trash2, TrendingUp, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency, cn, safeFormatDate } from '../lib/utils';
import { addDays, format, isWithinInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { calculatePackageFinancialSummary, FinancialStatus, PACKAGE_GROSS_VALUE, PARTNER_SHARE_RATE, SESSIONS_PER_PACKAGE, type PackageFinancialSummary } from '../lib/financePackages';
import { createPaymentOperationKey, preparePaymentCreation, preparePaymentVoid } from '../../shared/paymentOperations.js';
import { isExpenseActive, isExpenseRealized, isPaymentActive, isPaymentReceived } from '../../shared/packagePayments.js';
import type { PackageToleranceReasonCode } from '../types/packageTolerance';
import {
  DEFAULT_TOLERANCE_MAX_SESSIONS,
  PACKAGE_TOLERANCE_REASON_OPTIONS,
  endPackageTolerance,
  endPackageToleranceAfterPayment,
  getPackageToleranceOffer,
  latestTolerance,
  savePackageTolerance,
} from '../lib/packageTolerance';

interface FinanceProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => boolean | void | Promise<boolean | void>;
  currentUserName: string;
}

type MetricBadgeTone = 'green' | 'orange' | 'red' | 'blue';
type StatusFilter = 'Todos' | FinancialStatus | 'Com pagamento no período' | 'Sem pagamento no período';

type PaymentContext = {
  patientId: string;
  packageNumber: number;
  pendingGross: number;
} | null;

const badgeToneClasses: Record<MetricBadgeTone, string> = {
  green: 'bg-status-green-bg text-status-green-text border border-status-green-text/15',
  orange: 'bg-status-orange-bg text-status-orange-text border border-status-orange-text/15',
  red: 'bg-status-red-bg text-status-red-text border border-status-red-text/15',
  blue: 'bg-status-blue-bg text-status-blue-text border border-status-blue-text/15',
};

function AnimatedCurrencyValue({ value, className }: { value: number; className?: string }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const startValue = displayValue;
    const delta = value - startValue;

    if (delta === 0) return;

    let frameId = 0;
    const startedAt = performance.now();
    const duration = 550;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startValue + delta * eased);
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return <span className={className}>{formatCurrency(displayValue)}</span>;
}

function MetricBadge({ label, tone }: { label: string; tone: MetricBadgeTone }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.04em]', badgeToneClasses[tone])}>
      <Sparkles size={12} />
      {label}
    </span>
  );
}

function MetricChip({
  icon,
  label,
  value,
  tone,
  align = 'left',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: MetricBadgeTone;
  align?: 'left' | 'right';
}) {
  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', badgeToneClasses[tone], align === 'right' && 'text-right')}>
      <div className={cn('mb-2 flex items-center gap-2 text-[13px] font-bold tracking-[0.06em]', align === 'right' && 'justify-end')}>
        {icon}
        <span>{label}</span>
      </div>
      <AnimatedCurrencyValue value={value} className="text-base font-black sm:text-lg" />
    </div>
  );
}

function CardHelp({ tooltip }: { tooltip: string }) {
  return (
    <span
      title={tooltip}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-clinic-border bg-clinic-bg/80 text-clinic-text-muted transition-colors hover:text-clinic-text"
      aria-label={tooltip}
    >
      <Info size={15} />
    </span>
  );
}

function ProgressPanel({
  label,
  percentage,
}: {
  label: string;
  percentage: number;
}) {
  return (
    <div className="rounded-2xl border border-clinic-border bg-clinic-bg/70 p-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold tracking-[0.04em] text-clinic-text-muted">
        <span>{label}</span>
        <span>{Math.round(percentage)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-clinic-border/70">
        <div className="h-full rounded-full bg-gradient-to-r from-status-green-text via-clinic-primary to-status-orange-text transition-all duration-500" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function CardLegend({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-clinic-border bg-clinic-bg/60 px-3 py-2 text-[13px] leading-relaxed text-clinic-text-muted">
      {children}
    </p>
  );
}

const statusClasses: Record<FinancialStatus, string> = {
  'QUITADO': 'bg-status-green-bg text-status-green-text border-status-green-text/20',
  'PARCIAL': 'bg-status-blue-bg text-status-blue-text border-status-blue-text/20',
  'EM ABERTO': 'bg-status-orange-bg text-status-orange-text border-status-orange-text/20',
  'ATRASADO': 'bg-status-red-bg text-status-red-text border-status-red-text/20',
  'EM TOLERÂNCIA': 'bg-status-blue-bg text-status-blue-text border-status-blue-text/20',
  'TOLERÂNCIA VENCIDA': 'bg-status-red-bg text-status-red-text border-status-red-text/20',
  'SEM MOVIMENTAÇÃO': 'bg-clinic-bg text-clinic-text-muted border-clinic-border',
};

const statusTooltips: Record<FinancialStatus, string> = {
  'QUITADO': 'Pacote atual totalmente pago. Pacotes anteriores não entram nesta validação.',
  'PARCIAL': 'Existe pagamento registrado no pacote atual, mas ainda falta completar o valor do pacote.',
  'EM ABERTO': 'Pacote atual iniciado ou agendado sem pagamento registrado para este pacote.',
  'ATRASADO': 'Pacote atual possui pendência vencida conforme a regra de vencimento do plano.',
  'EM TOLERÂNCIA': 'Pacote temporariamente autorizado, com pagamento ainda não confirmado.',
  'TOLERÂNCIA VENCIDA': 'O prazo ou o limite de sessões da autorização temporária foi atingido.',
  'SEM MOVIMENTAÇÃO': 'Não há sessões, pacote ou pagamento relevante para leitura atual.',
};

function FinancialStatusBadge({ status }: { status: FinancialStatus }) {
  return (
    <span
      title={statusTooltips[status]}
      className={cn('inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-black tracking-[0.06em] whitespace-nowrap', statusClasses[status])}
    >
      {status}
    </span>
  );
}

export default function Finance({ state, onUpdate, currentUserName }: FinanceProps) {
  const [viewMode, setViewMode] = useState<'Receitas' | 'Despesas'>('Receitas');
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Todos');
  const [paymentToVoid, setPaymentToVoid] = useState<string | null>(null);
  const [paymentVoidReason, setPaymentVoidReason] = useState('');
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [paymentContext, setPaymentContext] = useState<PaymentContext>(null);
  const [toleranceSummary, setToleranceSummary] = useState<PackageFinancialSummary | null>(null);
  const [tolerancePackageNumber, setTolerancePackageNumber] = useState(1);
  const [toleranceReasonCode, setToleranceReasonCode] = useState<PackageToleranceReasonCode>('requested_days');
  const [toleranceReasonText, setToleranceReasonText] = useState('');
  const [toleranceNotes, setToleranceNotes] = useState('');
  const [tolerancePromisedDate, setTolerancePromisedDate] = useState(format(addDays(new Date(), 5), 'yyyy-MM-dd'));
  const [toleranceExpiresAt, setToleranceExpiresAt] = useState(format(addDays(new Date(), 5), 'yyyy-MM-dd'));
  const [toleranceMaxSessions, setToleranceMaxSessions] = useState(DEFAULT_TOLERANCE_MAX_SESSIONS);
  const [isSavingTolerance, setIsSavingTolerance] = useState(false);

  // Period Filter State
  const [periodFilter, setPeriodFilter] = useState<'Semanal' | 'Mensal' | 'Anual' | 'Personalizado'>('Mensal');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  // Payment Form State
  const [patientId, setPatientId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [installment, setInstallment] = useState<'1ª parcela' | '2ª parcela' | 'Pagamento integral'>('Pagamento integral');
  const [method, setMethod] = useState<'Pix' | 'Dinheiro' | 'Transferência' | 'Outro'>('Pix');
  const [paymentOperationKey, setPaymentOperationKey] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const paymentWriteLockRef = useRef(false);

  // Expense Form State
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expenseCategory, setExpenseCategory] = useState<Expense['category']>('Outro');

  const interval = useMemo(() => {
    const now = new Date();
    if (periodFilter === 'Semanal') return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    if (periodFilter === 'Mensal') return { start: startOfMonth(now), end: endOfMonth(now) };
    if (periodFilter === 'Anual') return { start: startOfYear(now), end: endOfYear(now) };
    
    const start = new Date(customStartDate + 'T00:00:00');
    const end = new Date(customEndDate + 'T23:59:59');
    return { start, end };
  }, [periodFilter, customStartDate, customEndDate]);

  const intervalDisplay = useMemo(() => {
    if (periodFilter === 'Semanal') {
      return `${format(interval.start, 'dd/MM/yyyy')} a ${format(interval.end, 'dd/MM/yyyy')}`;
    }
    if (periodFilter === 'Mensal') {
      const mStr = format(interval.start, "MMMM yyyy", { locale: ptBR });
      return mStr.charAt(0).toUpperCase() + mStr.slice(1);
    }
    if (periodFilter === 'Anual') {
      return `Janeiro a Dezembro ${format(interval.start, 'yyyy')}`;
    }
    return `${format(interval.start, 'dd/MM/yyyy')} a ${format(interval.end, 'dd/MM/yyyy')}`;
  }, [interval, periodFilter]);

  const patientFinancials = useMemo(() => {
    const today = startOfDay(new Date());

    return state.patients
      .filter(patient => patient.status === 'Ativo' || state.payments.some(payment => payment.patientId === patient.id))
      .map(patient => calculatePackageFinancialSummary(patient, state.sessions, state.payments, today));
  }, [state.patients, state.sessions, state.payments]);

  const metrics = useMemo(() => {
    let recebidoNoPeriodo = 0;
    let previstoNoPeriodo = 0;
    let saldoEmAberto = 0;
    let saldoAtrasado = 0;
    let despesasNoPeriodo = 0;
  
    state.payments.filter(payment => isPaymentReceived(payment)).forEach(p => {
      if (isWithinInterval(parseISO(p.date), interval)) recebidoNoPeriodo += p.amount;
    });
    
    (state.expenses || []).filter(expense => isExpenseRealized(expense)).forEach(e => {
      if (isWithinInterval(parseISO(e.date), interval)) despesasNoPeriodo += e.amount;
    });
  
    patientFinancials.forEach(summary => {
      if (summary.pendingGross > 0) {
        previstoNoPeriodo += summary.pendingGross;
      }
      if (summary.overdueGross > 0) saldoAtrasado += summary.overdueGross;
      else if (summary.pendingGross > 0) saldoEmAberto += summary.pendingGross;
    });

    saldoEmAberto = saldoEmAberto * (1 - PARTNER_SHARE_RATE);
    saldoAtrasado = saldoAtrasado * (1 - PARTNER_SHARE_RATE);
  
    return { 
      recebidoNoPeriodo, 
      previstoNoPeriodo, 
      totalReceitas: recebidoNoPeriodo,
      saldoEmAberto, 
      saldoAtrasado,
      despesasNoPeriodo,
      lucroLiquido: recebidoNoPeriodo - despesasNoPeriodo
    };
  }, [patientFinancials, state.payments, state.expenses, interval]);

  const financeDashboard = useMemo(() => {
    const receitaProjetada = metrics.recebidoNoPeriodo + metrics.previstoNoPeriodo;
    const progressoRecebido = metrics.previstoNoPeriodo > 0 ? Math.min((metrics.recebidoNoPeriodo / metrics.previstoNoPeriodo) * 100, 100) : 0;

    const receitaBadge = receitaProjetada <= 0
      ? { label: 'Atenção', tone: 'orange' as MetricBadgeTone }
      : progressoRecebido !== null && progressoRecebido >= 75
        ? { label: 'Excelente', tone: 'green' as MetricBadgeTone }
        : progressoRecebido !== null && progressoRecebido >= 35
          ? { label: 'Atenção', tone: 'orange' as MetricBadgeTone }
          : { label: 'Baixa Receita', tone: 'red' as MetricBadgeTone };

    const saldoBadge = metrics.saldoAtrasado > 0
      ? { label: 'Atrasado', tone: 'red' as MetricBadgeTone }
      : metrics.saldoEmAberto > 0
        ? { label: 'Pendente', tone: 'orange' as MetricBadgeTone }
        : { label: 'Em Dia', tone: 'green' as MetricBadgeTone };

    return {
      receitaProjetada,
      progressoRecebido,
      receitaBadge,
      saldoBadge,
    };
  }, [metrics]);

  const revenueTitle = periodFilter === 'Personalizado' ? 'Receita Bruta do Período' : `Receita Bruta ${periodFilter}`;

  const patientList = useMemo(() => {
    return patientFinancials.filter(summary => summary.patient.status === 'Ativo').map(summary => {
      const paymentsInPeriod = summary.allPayments.filter(payment => isWithinInterval(parseISO(payment.date), interval));
      const valorJaPago = paymentsInPeriod.reduce((sum, payment) => sum + payment.amount, 0);
      const hasPaymentInPeriod = paymentsInPeriod.length > 0;

      return {
        ...summary,
        valorJaPago,
        valorPendente: summary.pendingGross,
        valorAtrasado: summary.overdueGross,
        hasPaymentInPeriod,
      };
    }).filter(item => {
        const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const matchesSearch = normalize(item.patient.name).includes(normalize(searchTerm));
        if (!matchesSearch) return false;
        if (statusFilter === 'Todos') return true;
        if (statusFilter === 'Com pagamento no período') return item.hasPaymentInPeriod;
        if (statusFilter === 'Sem pagamento no período') return !item.hasPaymentInPeriod;
        return item.status === statusFilter;
      })
      .sort((a,b) => {
        if (a.status === 'TOLERÂNCIA VENCIDA' && b.status !== 'TOLERÂNCIA VENCIDA') return -1;
        if (b.status === 'TOLERÂNCIA VENCIDA' && a.status !== 'TOLERÂNCIA VENCIDA') return 1;
        if (a.status === 'ATRASADO' && b.status !== 'ATRASADO') return -1;
        if (b.status === 'ATRASADO' && a.status !== 'ATRASADO') return 1;
        if (a.status === 'EM ABERTO' && b.status !== 'EM ABERTO') return -1;
        if (b.status === 'EM ABERTO' && a.status !== 'EM ABERTO') return 1;
        return a.patient.name.localeCompare(b.patient.name);
      });
  }, [patientFinancials, interval, searchTerm, statusFilter]);

  const groupedTransactions = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const inPeriod = state.payments.filter(payment => payment.date <= today).filter(p => isWithinInterval(parseISO(p.date), interval))
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
    const groups: Record<string, { total: number, count: number, items: Payment[] }> = {};
    inPeriod.forEach(p => {
      const monthStr = format(parseISO(p.date), "MMMM yyyy", { locale: ptBR });
      const key = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
      if (!groups[key]) groups[key] = { total: 0, count: 0, items: [] };
      if (isPaymentReceived(p)) groups[key].total += p.amount;
      groups[key].count += 1;
      groups[key].items.push(p);
    });
    return groups;
  }, [state.payments, interval]);

  const groupedExpenses = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const inPeriod = (state.expenses || []).filter(expense => expense.date <= today).filter(e => isWithinInterval(parseISO(e.date), interval))
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
    const groups: Record<string, { total: number, count: number, items: Expense[] }> = {};
    inPeriod.forEach(e => {
      const monthStr = format(parseISO(e.date), "MMMM yyyy", { locale: ptBR });
      const key = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
      if (!groups[key]) groups[key] = { total: 0, count: 0, items: [] };
      if (isExpenseRealized(e)) groups[key].total += e.amount;
      groups[key].count += 1;
      groups[key].items.push(e);
    });
    return groups;
  }, [state.expenses, interval]);

  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setPaymentContext(null);
    resetPaymentForm();
    setPaymentOperationKey('');
  };

  const openPaymentModal = (summary?: PackageFinancialSummary) => {
    resetPaymentForm();
    setPaymentOperationKey(createPaymentOperationKey());

    if (summary) {
      const targetPackageNumber = summary.hasNewPackageWithoutPayment && summary.pendingGross <= 0
        ? summary.packageNumber + 1
        : summary.packageNumber;
      const targetPaidGross = targetPackageNumber === summary.packageNumber ? summary.paidGross : 0;
      const targetPendingGross = targetPackageNumber === summary.packageNumber ? summary.pendingGross : PACKAGE_GROSS_VALUE;
      const isInstallmentPlan = summary.patient.paymentModal === PaymentModal.PARCELADO;
      const firstInstallmentTarget = PACKAGE_GROSS_VALUE / 2;
      const suggestedInstallment = isInstallmentPlan
        ? targetPaidGross < firstInstallmentTarget ? '1ª parcela' : '2ª parcela'
        : 'Pagamento integral';
      const suggestedAmount = isInstallmentPlan
        ? targetPaidGross < firstInstallmentTarget
          ? Math.max(firstInstallmentTarget - targetPaidGross, 0)
          : Math.max(PACKAGE_GROSS_VALUE - targetPaidGross, 0)
        : targetPendingGross;

      setPaymentContext({
        patientId: summary.patient.id,
        packageNumber: targetPackageNumber,
        pendingGross: targetPendingGross,
      });
      setPatientId(summary.patient.id);
      setAmount(suggestedAmount);
      setInstallment(suggestedInstallment);
    } else {
      setPaymentContext(null);
    }

    setIsPaymentModalOpen(true);
  };

  const openToleranceModal = (summary: PackageFinancialSummary) => {
    const offer = getPackageToleranceOffer(summary);
    if (!offer.canOffer || !offer.targetPackageNumber) {
      showToast('Este pacote não possui pagamento pendente elegível para tolerância.', 'error');
      return;
    }
    const targetPackageNumber = offer.targetPackageNumber;
    const existing = latestTolerance(summary.patient, targetPackageNumber);
    const defaultDate = format(addDays(new Date(), 5), 'yyyy-MM-dd');
    setToleranceSummary(summary);
    setTolerancePackageNumber(targetPackageNumber);
    setToleranceReasonCode(existing?.reasonCode || 'requested_days');
    setToleranceReasonText(existing?.reasonText || '');
    setToleranceNotes(existing?.notes || '');
    setTolerancePromisedDate(existing?.promisedPaymentDate || defaultDate);
    setToleranceExpiresAt(existing?.expiresAt || defaultDate);
    setToleranceMaxSessions(existing?.maxSessions || DEFAULT_TOLERANCE_MAX_SESSIONS);
  };

  const closeToleranceModal = () => {
    if (isSavingTolerance) return;
    setToleranceSummary(null);
  };

  const handleSaveTolerance = async () => {
    if (!toleranceSummary || isSavingTolerance) return;
    const patient = state.patients.find(item => item.id === toleranceSummary.patient.id);
    if (!patient) {
      showToast('Atendente não encontrado.', 'error');
      return;
    }
    if (!tolerancePromisedDate || !toleranceExpiresAt) {
      showToast('Informe a data prometida e o prazo final da tolerância.', 'error');
      return;
    }
    if (tolerancePromisedDate > toleranceExpiresAt) {
      showToast('A data prometida não pode ser posterior ao prazo final da tolerância.', 'error');
      return;
    }
    if (!window.confirm(
      `Liberar temporariamente o Pacote ${tolerancePackageNumber} de ${patient.name} até ${safeFormatDate(toleranceExpiresAt, 'dd/MM/yyyy')}, com limite de ${toleranceMaxSessions} sessão(ões)? O pagamento continuará pendente.`
    )) return;

    setIsSavingTolerance(true);
    try {
      const updatedPatient = savePackageTolerance(patient, {
        packageNumber: tolerancePackageNumber,
        reasonCode: toleranceReasonCode,
        reasonText: toleranceReasonText,
        notes: toleranceNotes,
        promisedPaymentDate: tolerancePromisedDate,
        expiresAt: toleranceExpiresAt,
        maxSessions: toleranceMaxSessions,
        actor: currentUserName || 'Profissional',
        now: new Date(),
      });
      const persisted = await onUpdate({
        patients: state.patients.map(item => item.id === patient.id ? updatedPatient : item),
      });
      if (persisted === false) {
        throw new Error('A tolerância não foi gravada. Nenhuma alteração foi confirmada no cadastro do atendente.');
      }
      showToast(`Pacote ${tolerancePackageNumber} liberado em tolerância. O pagamento continua pendente.`);
      setToleranceSummary(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar a tolerância.', 'error');
    } finally {
      setIsSavingTolerance(false);
    }
  };

  const handleEndTolerance = async () => {
    if (!toleranceSummary || isSavingTolerance) return;
    const patient = state.patients.find(item => item.id === toleranceSummary.patient.id);
    if (!patient) return;
    if (!window.confirm(`Encerrar a tolerância do Pacote ${tolerancePackageNumber} de ${patient.name}? O histórico será preservado.`)) return;
    setIsSavingTolerance(true);
    try {
      const updatedPatient = endPackageTolerance(patient, {
        packageNumber: tolerancePackageNumber,
        actor: currentUserName || 'Profissional',
        reason: 'manual',
        now: new Date(),
      });
      const persisted = await onUpdate({
        patients: state.patients.map(item => item.id === patient.id ? updatedPatient : item),
      });
      if (persisted === false) {
        throw new Error('O encerramento não foi gravado. A tolerância permanece inalterada.');
      }
      showToast('Tolerância encerrada. O histórico foi preservado.');
      setToleranceSummary(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível encerrar a tolerância.', 'error');
    } finally {
      setIsSavingTolerance(false);
    }
  };

  const handleSavePayment = async () => {
    if (paymentWriteLockRef.current) return;
    if (!patientId || amount <= 0) {
      showToast('Preencha os dados corretamente.', 'error');
      return;
    }

    const selectedSummary = patientFinancials.find(summary => summary.patient.id === patientId);
    const targetPackageNumber = paymentContext?.patientId === patientId
      ? paymentContext.packageNumber
      : selectedSummary?.hasNewPackageWithoutPayment && selectedSummary.pendingGross <= 0
        ? selectedSummary.packageNumber + 1
        : selectedSummary?.packageNumber || 1;
    const selectedPatient = state.patients.find(p => p.id === patientId);
    if (!selectedPatient) {
      showToast('Atendente não encontrado.', 'error');
      return;
    }
    const patientName = selectedPatient.name || 'Atendente';
    if (paymentContext && !window.confirm(
      `Confirmar pagamento real de ${formatCurrency(amount)} para ${patientName}, Pacote ${targetPackageNumber}, em ${safeFormatDate(date, 'dd/MM/yyyy')} via ${method}?`
    )) {
      return;
    }

    paymentWriteLockRef.current = true;
    setIsSavingPayment(true);
    try {
      const prepared = preparePaymentCreation({
        patient: selectedPatient,
        sessions: state.sessions,
        payments: state.payments,
        expenses: state.expenses || [],
        input: { patientId, amount, date, installment, method, packageNumber: targetPackageNumber },
        operationKey: paymentOperationKey || createPaymentOperationKey(),
        actor: currentUserName || 'Profissional',
        now: new Date().toISOString(),
      });
      const patientAfterPayment = endPackageToleranceAfterPayment(selectedPatient, {
        packageNumber: targetPackageNumber,
        actor: currentUserName || 'Profissional',
        now: new Date(),
      });
      await onUpdate({
        payments: prepared.payments,
        expenses: prepared.expenses,
        patients: state.patients.map(item => item.id === selectedPatient.id ? patientAfterPayment : item),
      });
      showToast(`Pagamento registrado! Repasse de ${formatCurrency(amount * PARTNER_SHARE_RATE)} gerado automaticamente.`);
      closePaymentModal();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar o pagamento.', 'error');
    } finally {
      paymentWriteLockRef.current = false;
      setIsSavingPayment(false);
    }
  };

  const handleVoidPayment = async () => {
    if (!paymentToVoid || paymentWriteLockRef.current) return;
    paymentWriteLockRef.current = true;
    setIsSavingPayment(true);
    try {
      const prepared = preparePaymentVoid({
        payments: state.payments,
        expenses: state.expenses || [],
        paymentId: paymentToVoid,
        reason: paymentVoidReason,
        actor: currentUserName || 'Profissional',
        now: new Date().toISOString(),
      });
      await onUpdate({ payments: prepared.payments, expenses: prepared.expenses });
      showToast('Receita e repasse cancelados, com histórico preservado.');
      setPaymentToVoid(null);
      setPaymentVoidReason('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível cancelar o pagamento.', 'error');
    } finally {
      paymentWriteLockRef.current = false;
      setIsSavingPayment(false);
    }
  };

  const handleSaveExpense = () => {
    if (!expenseDesc || expenseAmount <= 0) {
      showToast('Preencha os dados corretamente.', 'error');
      return;
    }
    const newExpense: Expense = {
      id: Math.random().toString(36).substr(2, 9),
      description: expenseDesc,
      amount: expenseAmount,
      date: expenseDate,
      category: expenseCategory
    };
    onUpdate({ expenses: [...(state.expenses || []), newExpense] });
    showToast('Despesa registada com sucesso!');
    setIsExpenseModalOpen(false);
    resetExpenseForm();
  };

  const resetPaymentForm = () => {
    setPatientId(''); setAmount(0); setDate(format(new Date(), 'yyyy-MM-dd'));
    setInstallment('Pagamento integral'); setMethod('Pix');
  };

  const resetExpenseForm = () => {
    setExpenseDesc(''); setExpenseAmount(0); setExpenseDate(format(new Date(), 'yyyy-MM-dd')); setExpenseCategory('Outro');
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      
      {/* Top Filter */}
      <div className="rounded-[20px] border border-clinic-border bg-clinic-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-clinic-primary/10 p-3 text-clinic-primary">
                <CalendarIcon size={18} />
              </div>
              <div>
                <p className="text-base font-black tracking-[0.06em] text-clinic-text">Painel Financeiro</p>
                <p className="text-sm text-clinic-text-muted">Acompanhe receitas, pendências e resultado líquido com leitura rápida.</p>
              </div>
            </div>
            <div className="inline-flex items-center rounded-full border border-clinic-border bg-clinic-bg px-3 py-1.5 text-[13px] font-bold tracking-[0.06em] text-clinic-text-muted">
              Período analisado: {intervalDisplay}
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
            <div className="flex bg-clinic-bg p-1 rounded-xl w-full md:w-auto">
            {['Semanal', 'Mensal', 'Anual', 'Personalizado'].map(f => (
              <button 
                key={f}
                onClick={() => setPeriodFilter(f as any)}
                className={cn(
                  "flex-1 md:flex-none px-5 py-2.5 rounded-lg text-sm font-bold tracking-[0.06em] transition-all", 
                  periodFilter === f ? 'bg-clinic-text text-white shadow-md' : 'text-clinic-text-muted hover:bg-white/70 hover:text-clinic-text'
                )}
              >
                {f}
              </button>
            ))}
            </div>
            {periodFilter === 'Personalizado' && (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center w-full md:w-auto">
                <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="px-3 py-2.5 bg-clinic-bg rounded-xl border border-clinic-border text-sm focus:ring-2 focus:ring-clinic-primary outline-none" />
                <span className="text-center text-clinic-text-faint text-sm font-semibold tracking-[0.04em]">até</span>
                <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="px-3 py-2.5 bg-clinic-bg rounded-xl border border-clinic-border text-sm focus:ring-2 focus:ring-clinic-primary outline-none" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          whileHover={{ y: -4, scale: 1.01 }}
          className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-clinic-border bg-clinic-surface p-6 shadow-clinic transition-shadow hover:shadow-xl"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-status-green-text/70"></div>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-start gap-3 text-clinic-text">
                <div className="shrink-0 rounded-2xl bg-status-green-bg p-3 text-status-green-text shadow-sm">
                  <TrendingUp size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-black tracking-[0.04em] text-clinic-text">{revenueTitle}</p>
                  <p className="text-sm text-clinic-text-muted">Total recebido no período selecionado</p>
                  <div className="mt-2">
                    <MetricBadge label={financeDashboard.receitaBadge.label} tone={financeDashboard.receitaBadge.tone} />
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-full border border-clinic-border bg-clinic-bg px-3 py-1.5 text-[13px] font-bold tracking-[0.04em] text-clinic-text-muted">
              {periodFilter}
            </div>
          </div>

          <div className="border-y border-clinic-border py-4">
            <AnimatedCurrencyValue value={metrics.totalReceitas} className="block text-[28px] font-black leading-none text-clinic-text sm:text-[32px] xl:text-[36px]" />
            <p className="mt-2 text-sm text-clinic-text-muted">Visão consolidada da receita bruta do período.</p>
            <CardLegend>Compara o recebido com o previsto para o período selecionado.</CardLegend>
          </div>

          <div className="mt-4">
            <ProgressPanel
              label="Recebido x Previsto"
              percentage={financeDashboard.progressoRecebido}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricChip icon={<CheckCircle2 size={14} />} label="Recebido" value={metrics.recebidoNoPeriodo} tone="green" />
            <MetricChip icon={<Clock3 size={14} />} label="Saldo atual pendente" value={metrics.previstoNoPeriodo} tone="orange" align="right" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06 }}
          whileHover={{ y: -4, scale: 1.01 }}
          className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-clinic-border bg-clinic-surface p-6 shadow-clinic transition-shadow hover:shadow-xl"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-status-orange-text/70"></div>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-start gap-3 text-clinic-text">
                <div className="shrink-0 rounded-2xl bg-status-orange-bg p-3 text-status-orange-text shadow-sm">
                  <HandCoins size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-black tracking-[0.04em] text-clinic-text">Saldo atual a receber</p>
                  <p className="text-sm text-clinic-text-muted">Pendências financeiras com destaque para atrasos</p>
                  <div className="mt-2">
                    <MetricBadge label={financeDashboard.saldoBadge.label} tone={financeDashboard.saldoBadge.tone} />
                  </div>
                </div>
              </div>
            </div>
            <CircleDollarSign className="shrink-0 text-status-orange-text/70" size={22} />
          </div>

          <div className="border-y border-clinic-border py-4">
            <AnimatedCurrencyValue value={metrics.saldoEmAberto + metrics.saldoAtrasado} className="block text-[28px] font-black leading-none text-clinic-text sm:text-[32px] xl:text-[36px]" />
            <p className="mt-2 text-sm text-clinic-text-muted">Saldo pendente dos pacotes atuais, independentemente do filtro de recebimentos.</p>
            <CardLegend>Separa valores pendentes entre em aberto e atrasados.</CardLegend>
          </div>

          <div className="mt-4">
            <ProgressPanel
              label="Recebido x Previsto"
              percentage={financeDashboard.progressoRecebido}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricChip icon={<Clock3 size={14} />} label="Em Aberto" value={metrics.saldoEmAberto} tone="orange" />
            <MetricChip icon={<AlertTriangle size={14} />} label="Atrasado" value={metrics.saldoAtrasado} tone="red" align="right" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
          whileHover={{ y: -4, scale: 1.01 }}
          className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-clinic-border bg-clinic-surface p-6 shadow-clinic transition-shadow hover:shadow-xl md:col-span-2 xl:col-span-1"
        >
          <div className="absolute inset-0 bg-clinic-primary/5 pointer-events-none"></div>
          <div className="absolute inset-x-0 top-0 h-1 bg-clinic-primary/70"></div>
          <div className="relative mb-5 flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-clinic-text">
                <div className="rounded-2xl bg-clinic-primary/10 p-3 text-clinic-primary shadow-sm">
                  <Wallet size={20} />
                </div>
                <div>
                  <p className="text-base font-black tracking-[0.06em] text-clinic-text">Lucro Líquido</p>
                  <p className="text-sm text-clinic-text-muted">Resultado após despesas registradas no período</p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Sparkles className="text-clinic-primary/70" size={22} />
              <CardHelp tooltip="Resultado calculado com base nas receitas recebidas menos as despesas do período." />
            </div>
          </div>

          <div className="relative border-y border-clinic-border py-5">
            <AnimatedCurrencyValue value={metrics.lucroLiquido} className="block text-[28px] font-black leading-none text-clinic-text sm:text-[32px] xl:text-[36px]" />
            <p className="mt-2 text-sm text-clinic-text-muted">Leitura premium do resultado financeiro do período.</p>
          </div>

          <div className="relative mt-5 space-y-3 rounded-2xl border border-clinic-border bg-clinic-bg/70 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-clinic-text-muted">
                <ArrowUpRight size={16} className="text-status-green-text" />
                <span>Receitas Recebidas</span>
              </div>
              <AnimatedCurrencyValue value={metrics.recebidoNoPeriodo} className="font-black text-status-green-text" />
            </div>
            <div className="flex items-center justify-center text-clinic-text-faint">
              <Minus size={16} />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-clinic-text-muted">
                <ArrowDownRight size={16} className="text-status-red-text" />
                <span>Despesas do Período</span>
              </div>
              <AnimatedCurrencyValue value={metrics.despesasNoPeriodo} className="font-black text-status-red-text" />
            </div>
            <div className="border-t border-clinic-border pt-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 font-black text-clinic-text">
                  <Wallet size={16} className="text-clinic-primary" />
                  <span>Lucro Líquido</span>
                </div>
                <AnimatedCurrencyValue value={metrics.lucroLiquido} className="font-black text-clinic-text" />
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="flex flex-col gap-4 rounded-[20px] border border-clinic-border bg-clinic-surface p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex bg-clinic-bg p-1 rounded-xl w-full md:w-auto">
          <button 
            onClick={() => setViewMode('Receitas')}
            className={cn("flex-1 md:flex-none px-6 py-2.5 rounded-lg text-sm font-bold tracking-[0.06em] transition-all", viewMode === 'Receitas' ? 'bg-white shadow-sm text-clinic-text' : 'text-clinic-text-muted hover:bg-white/70 hover:text-clinic-text')}
          >
            Receitas
          </button>
          <button 
            onClick={() => setViewMode('Despesas')}
            className={cn("flex-1 md:flex-none px-6 py-2.5 rounded-lg text-sm font-bold tracking-[0.06em] transition-all", viewMode === 'Despesas' ? 'bg-white shadow-sm text-clinic-text' : 'text-clinic-text-muted hover:bg-white/70 hover:text-clinic-text')}
          >
            Despesas
          </button>
          </div>
          <div className="text-sm text-clinic-text-muted">
            {viewMode === 'Receitas' ? 'Visão detalhada de recebimentos por atendente e por transação.' : 'Visão detalhada das saídas registradas no período.'}
          </div>
        </div>

        {viewMode === 'Receitas' ? (
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
              <input 
                type="text" placeholder="Buscar atendente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm"
              />
            </div>
            <button onClick={() => openPaymentModal()} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-clinic-primary text-white font-bold rounded-xl shadow-md hover:bg-clinic-primary-hover transition-all tracking-[0.06em] text-sm">
              <Plus size={16} /> Nova Receita
            </button>
          </div>
        ) : (
          <button onClick={() => setIsExpenseModalOpen(true)} className="w-full md:w-auto flex items-center gap-2 px-6 py-2.5 bg-status-red-text text-white font-bold rounded-xl shadow-md hover:bg-red-700 transition-all tracking-[0.06em] text-sm justify-center">
            <Plus size={16} /> Nova Despesa
          </button>
        )}
      </div>

      {viewMode === 'Receitas' && (
        <div className="flex flex-col gap-6">
          <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm">
            <div className="px-4 sm:px-6 py-4 border-b border-clinic-border flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <DollarSign size={20} />
                  <h2 className="text-xl font-bold">Situação por Atendente ({periodFilter})</h2>
                </div>
                <p className="max-w-4xl rounded-xl border border-clinic-border bg-clinic-bg/60 px-3 py-2 text-[13px] leading-relaxed text-clinic-text-muted">
                  A situação financeira considera pendências reais do pacote atual ou parcelas abertas. A ausência de pagamento no período não gera pendência automaticamente. Pacotes anteriores quitados permanecem apenas como histórico. O status usa o valor bruto do pacote ({formatCurrency(PACKAGE_GROSS_VALUE)}); métricas de saldo descontam o repasse de {Math.round(PARTNER_SHARE_RATE * 100)}% da sócia.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {(['Todos', 'TOLERÂNCIA VENCIDA', 'EM TOLERÂNCIA', 'ATRASADO', 'EM ABERTO', 'PARCIAL', 'QUITADO', 'Com pagamento no período', 'Sem pagamento no período'] as StatusFilter[]).map(filter => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[11px] font-black tracking-[0.05em] transition-colors',
                      statusFilter === filter ? 'border-clinic-primary bg-clinic-primary text-white shadow-sm' : 'border-clinic-border bg-white text-clinic-text-muted hover:bg-clinic-bg'
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden">
              <div className="hidden xl:grid grid-cols-[minmax(220px,1.6fr)_0.8fr_0.9fr_0.7fr_0.9fr_0.9fr_0.9fr_0.9fr_0.6fr] gap-3 px-6 py-3 bg-clinic-bg/40 border-b border-clinic-border text-[11px] font-black uppercase tracking-[0.08em] text-clinic-text-faint">
                <span>Atendente</span>
                <span>Tipo</span>
                <span>Pacote atual</span>
                <span>Sessões</span>
                <span className="text-right">Pago período</span>
                <span className="text-right">Pendente</span>
                <span>Último pagamento</span>
                <span>Status</span>
                <span className="text-right">Ações</span>
              </div>
              <div className="divide-y divide-clinic-border">
                {patientList.map(item => {
                  const isExpanded = expandedPatientId === item.patient.id;
                  const typeLabel = item.patient.paymentModal.split(': ')[0];
                  const lastPaymentLabel = item.lastPayment ? `${safeFormatDate(item.lastPayment.date, 'dd/MM/yyyy')} · ${formatCurrency(item.lastPayment.amount)}` : 'Sem pagamento';

                  return (
                    <div key={item.patient.id} className={cn('transition-colors', item.status === 'ATRASADO' ? 'bg-status-red-bg/50' : 'bg-white hover:bg-clinic-bg/30')}>
                      <button
                        type="button"
                        onClick={() => setExpandedPatientId(isExpanded ? null : item.patient.id)}
                        className="grid w-full grid-cols-1 gap-3 px-4 py-3 text-left transition-colors sm:px-6 xl:grid-cols-[minmax(220px,1.6fr)_0.8fr_0.9fr_0.7fr_0.9fr_0.9fr_0.9fr_0.9fr_0.6fr] xl:items-center xl:gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-black text-clinic-text">{item.patient.name}</span>
                            {item.hasNewPackageWithoutPayment && <AlertTriangle size={15} className="shrink-0 text-status-orange-text" />}
                          </div>
                          <span className="text-[11px] font-semibold text-clinic-text-faint">Resp.: {item.patient.guardianName}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 xl:block">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Tipo</span>
                          <span className="rounded-full border border-clinic-border bg-clinic-bg px-2.5 py-1 text-[11px] font-bold text-clinic-text-muted">{typeLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm font-bold text-clinic-text xl:block">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pacote</span>
                          <span>{item.hasCurrentPackage ? `Pacote ${item.packageNumber}` : 'Sem pendência'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm xl:block">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Sessões</span>
                          <span className="font-black text-clinic-text">{item.hasCurrentPackage ? `${item.completedSessionsInCurrentPackage}/${SESSIONS_PER_PACKAGE}` : '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm xl:block xl:text-right">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pago período</span>
                          <span className="font-black text-status-green-text">{formatCurrency(item.valorJaPago)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm xl:block xl:text-right">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pendente</span>
                          <span className={cn('font-black', item.pendingGross > 0 ? 'text-status-orange-text' : 'text-clinic-text-muted')}>{formatCurrency(item.pendingGross)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm text-clinic-text-muted xl:block">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Último pag.</span>
                          <span className="font-semibold">{lastPaymentLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 xl:block">
                          <span className="xl:hidden text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Status</span>
                          <FinancialStatusBadge status={item.status} />
                        </div>
                        <div className="flex items-center justify-end gap-2 text-clinic-primary">
                          <span className="text-[11px] font-black uppercase tracking-wider">Detalhes</span>
                          <ChevronDown size={16} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mx-4 mb-4 rounded-2xl border border-clinic-border bg-clinic-bg/45 p-4 sm:mx-6">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-xl bg-white p-3 border border-clinic-border">
                              <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pacote atual</p>
                              <p className="mt-1 text-sm font-black text-clinic-text">{item.hasCurrentPackage ? `Pacote ${item.packageNumber}` : 'Sem pacote financeiro ativo'}</p>
                              <p className="text-xs text-clinic-text-muted">{item.hasCurrentPackage ? `${item.completedSessionsInCurrentPackage} sessão(ões) realizadas/reposição, ${item.remainingSessionsInCurrentPackage} restante(s)` : 'Agenda futura não gera dívida automaticamente.'}</p>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-clinic-border">
                              <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Valores do pacote</p>
                              <p className="mt-1 text-sm font-black text-clinic-text">{formatCurrency(item.grossExpected)} bruto</p>
                              <p className="text-xs text-clinic-text-muted">Repasse previsto: {formatCurrency(item.partnerShareExpected)} · Líquido: {formatCurrency(item.netExpected)}</p>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-clinic-border">
                              <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pago no pacote atual</p>
                              <p className="mt-1 text-sm font-black text-status-green-text">{formatCurrency(item.paidGross)}</p>
                              <p className="text-xs text-clinic-text-muted">Líquido após repasse: {formatCurrency(item.paidNet)}</p>
                            </div>
                            <div className="rounded-xl bg-white p-3 border border-clinic-border">
                              <p className="text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pendente atual</p>
                              <p className="mt-1 text-sm font-black text-status-orange-text">{formatCurrency(item.pendingGross)}</p>
                              <p className="text-xs text-clinic-text-muted">Líquido a receber: {formatCurrency(item.pendingNet)}</p>
                            </div>
                          </div>
                          {item.hasNewPackageWithoutPayment && (
                            <p className="mt-3 rounded-xl border border-status-orange-text/20 bg-status-orange-bg px-3 py-2 text-xs font-bold text-status-orange-text">
                              Há atendimento em pacote sem pagamento confirmado. Registre o pagamento ou faça uma liberação temporária explícita para manter a continuidade sem misturar tolerância com receita recebida.
                            </p>
                          )}
                          {!item.hasNewPackageWithoutPayment
                            && item.hasCurrentPackage
                            && item.pendingGross > 0
                            && item.paidGross <= 0
                            && item.completedSessionsInCurrentPackage > 0 && (
                              <p className="mt-3 rounded-xl border border-status-orange-text/20 bg-status-orange-bg px-3 py-2 text-xs font-bold text-status-orange-text">
                                Este pacote já possui atendimento realizado, mas ainda não recebeu pagamento. Registre o pagamento ou libere temporariamente o próprio pacote.
                              </p>
                            )}
                          {item.packageTolerance?.record && !['closed', 'paid'].includes(item.packageTolerance.status) && (
                            <div className={cn(
                              'mt-3 rounded-xl border px-3 py-3 text-xs',
                              item.packageTolerance.status === 'active'
                                ? 'border-status-blue-text/20 bg-status-blue-bg text-status-blue-text'
                                : 'border-status-red-text/20 bg-status-red-bg text-status-red-text',
                            )}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-black uppercase tracking-wide">
                                  {item.packageTolerance.status === 'active' ? 'Pacote em tolerância' : 'Tolerância vencida'}
                                </p>
                                <span className="font-black">
                                  {item.packageTolerance.sessionsUsed}/{item.packageTolerance.record.maxSessions} sessão(ões) liberadas usadas
                                </span>
                              </div>
                              <p className="mt-1 font-semibold">
                                Pagamento prometido para {safeFormatDate(item.packageTolerance.record.promisedPaymentDate, 'dd/MM/yyyy')} • prazo final {safeFormatDate(item.packageTolerance.record.expiresAt, 'dd/MM/yyyy')}.
                              </p>
                              <p className="mt-1">O valor permanece integralmente pendente até o registro do pagamento real.</p>
                            </div>
                          )}
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-clinic-border bg-white px-3 py-3">
                            <div>
                              <p className="text-sm font-black text-clinic-text">Ações financeiras do pacote atual</p>
                              <p className="text-xs text-clinic-text-muted">O registro será vinculado ao Pacote {item.hasNewPackageWithoutPayment && item.pendingGross <= 0 ? item.packageNumber + 1 : item.packageNumber} e atualizará os saldos e avisos automaticamente.</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {getPackageToleranceOffer(item).canOffer && (
                                <button
                                  type="button"
                                  onClick={() => openToleranceModal(item)}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-status-blue-text/25 bg-status-blue-bg px-4 py-2.5 text-sm font-black text-status-blue-text transition-colors hover:bg-status-blue-bg/70"
                                >
                                  <ShieldCheck size={17} />
                                  {item.packageTolerance?.record && !['closed', 'paid'].includes(item.packageTolerance.status)
                                    ? 'Gerenciar tolerância'
                                    : 'Liberar temporariamente'}
                                </button>
                              )}
                              {item.pendingGross > 0 || item.hasNewPackageWithoutPayment || item.packageTolerance?.record ? (
                                <button
                                  type="button"
                                  onClick={() => openPaymentModal(item)}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-sm font-black text-white shadow-md transition-colors hover:bg-clinic-primary-hover"
                                >
                                  <HandCoins size={17} /> Registrar pagamento
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-2 rounded-full border border-status-green-text/20 bg-status-green-bg px-3 py-2 text-xs font-black text-status-green-text">
                                  <CheckCircle2 size={15} /> Pacote atual quitado
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div>
                              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pagamentos do pacote atual</p>
                              <div className="space-y-2">
                                {item.currentPackagePayments.length > 0 ? item.currentPackagePayments.map(payment => (
                                  <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl border border-clinic-border bg-white px-3 py-2 text-sm">
                                    <span className="font-bold text-clinic-text">{safeFormatDate(payment.date, 'dd/MM/yyyy')} · {payment.installment} · {payment.method}</span>
                                    <span className="font-black text-status-green-text">{formatCurrency(payment.amount)}</span>
                                  </div>
                                )) : <p className="rounded-xl border border-dashed border-clinic-border bg-white px-3 py-3 text-sm italic text-clinic-text-muted">Nenhum pagamento vinculado ao pacote atual.</p>}
                              </div>
                            </div>
                            <div>
                              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-clinic-text-faint">Pacote anterior</p>
                              <div className="rounded-xl border border-clinic-border bg-white px-3 py-3 text-sm text-clinic-text-muted">
                                {item.previousPackageNumber ? (
                                  <>
                                    <p className="font-bold text-clinic-text">Pacote {item.previousPackageNumber}</p>
                                    <p>{item.previousPackagePayments.length} pagamento(s) registrado(s), total {formatCurrency(item.previousPackagePayments.reduce((sum, payment) => sum + payment.amount, 0))}.</p>
                                  </>
                                ) : 'Não há pacote anterior para este atendente.'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {patientList.length === 0 && (
                  <div className="px-6 py-10 text-center">
                    <p className="font-bold text-clinic-text">Nenhum atendente encontrado para os filtros atuais.</p>
                    <p className="mt-1 text-sm text-clinic-text-muted">Ajuste a busca ou os filtros para visualizar a situação financeira.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
             <div className="px-4 sm:px-6 py-4 border-b border-clinic-border flex flex-col gap-2 bg-clinic-bg/10 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <History size={20} className="text-clinic-text-faint" />
                <div>
                  <h2 className="text-xl font-bold">Histórico de Transações</h2>
                  <p className="text-sm text-clinic-text-muted">Receitas reais registradas no período, com atendente, responsável, pacote, forma e valor.</p>
                </div>
              </div>
              <button onClick={() => openPaymentModal()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-clinic-primary transition-colors hover:bg-clinic-bg">
                <Plus size={14} /> Registrar nova receita
              </button>
            </div>
            <div className="responsive-table">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-clinic-bg/50 text-[13px] font-bold tracking-[0.06em] text-clinic-text-faint border-b border-clinic-border">
                    <th className="px-6 py-4">Data</th>
                    <th className="px-6 py-4">Atendente</th>
                    <th className="px-6 py-4">Responsável</th>
                    <th className="px-6 py-4">Pacote</th>
                    <th className="px-6 py-4">Parcela</th>
                    <th className="px-6 py-4">Forma</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-clinic-border">
                  {(Object.entries(groupedTransactions) as [string, { total: number, count: number, items: Payment[] }][]).map(([monthYear, group]) => (
                    <React.Fragment key={monthYear}>
                      <tr className="bg-clinic-bg/20 border-y border-clinic-border" data-group="true">
                        <td colSpan={8} className="px-6 py-3">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-clinic-text text-sm tracking-[0.04em]">{monthYear}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[13px] font-semibold text-clinic-text-faint bg-white px-2.5 py-1.5 rounded shadow-sm">{group.count} transaç{group.count > 1 ? 'ões' : 'ão'}</span>
                              <span className="font-black text-status-green-text ml-2">{formatCurrency(group.total)}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {group.items.map(p => (
                        <tr key={p.id} className="hover:bg-clinic-bg/30 transition-colors group">
                          <td data-label="Data" className="px-6 py-4 text-sm whitespace-nowrap">{safeFormatDate(p.date, 'dd/MM/yyyy')}</td>
                          <td data-label="Atendente" className="px-6 py-4 text-sm font-bold text-clinic-text">{state.patients.find(pt => pt.id === p.patientId)?.name || 'Desconhecido'}</td>
                          <td data-label="Responsável" className="px-6 py-4 text-sm text-clinic-text-muted">{state.patients.find(pt => pt.id === p.patientId)?.guardianName || '-'}</td>
                          <td data-label="Pacote" className="px-6 py-4"><span className="px-2.5 py-1.5 bg-clinic-bg rounded text-[13px] font-semibold text-clinic-text-muted">{p.packageNumber ? `Pacote ${p.packageNumber}` : 'Histórico'}</span></td>
                          <td data-label="Parcela" className="px-6 py-4 text-sm">{p.installment}</td>
                          <td data-label="Forma" className="px-6 py-4"><span className="px-2.5 py-1.5 bg-clinic-bg rounded text-[13px] font-semibold text-clinic-text-muted">{p.method}</span></td>
                          <td data-label="Status" className="px-6 py-4"><span className={cn('px-2.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider', isPaymentActive(p) ? 'bg-status-green-bg text-status-green-text' : 'bg-status-red-bg text-status-red-text')}>{isPaymentActive(p) ? 'Recebido' : 'Cancelado'}</span></td>
                          <td data-label="Valor" className={cn('px-6 py-4 text-right text-sm font-bold flex items-center justify-end gap-3', isPaymentActive(p) ? 'text-status-green-text' : 'text-clinic-text-muted line-through')}>
                            {formatCurrency(p.amount)}
                            {isPaymentActive(p) && <button onClick={() => setPaymentToVoid(p.id)} title="Cancelar pagamento" className="p-1.5 text-status-red-text bg-status-red-bg rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {Object.keys(groupedTransactions).length === 0 && (
                <div className="px-6 py-12 text-center">
                  <p className="font-black text-clinic-text">Nenhuma transação encontrada para o período selecionado.</p>
                  <p className="mx-auto mt-2 max-w-lg text-sm text-clinic-text-muted">Quando uma receita for registrada, ela aparecerá aqui com data, atendente, responsável, forma de pagamento, parcela, pacote e valor.</p>
                  <button onClick={() => openPaymentModal()} className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-sm font-black text-white shadow-md transition-colors hover:bg-clinic-primary-hover">
                    <Plus size={16} /> Registrar nova receita
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'Despesas' && (
        <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
           <div className="px-6 py-4 border-b border-clinic-border flex items-center gap-2 bg-clinic-bg/10">
            <History size={20} className="text-clinic-text-faint" />
            <h2 className="text-xl font-bold">Histórico de Despesas</h2>
          </div>
          <div className="responsive-table">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-clinic-bg/50 text-[13px] font-bold tracking-[0.06em] text-clinic-text-faint border-b border-clinic-border">
                  <th className="px-6 py-4">Data</th>
                  <th className="px-6 py-4">Descrição</th>
                  <th className="px-6 py-4">Categoria</th>
                  <th className="px-6 py-4 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clinic-border">
                {(Object.entries(groupedExpenses) as [string, { total: number, count: number, items: Expense[] }][]).map(([monthYear, group]) => (
                  <React.Fragment key={monthYear}>
                    <tr className="bg-clinic-bg/20 border-y border-clinic-border" data-group="true">
                      <td colSpan={4} className="px-6 py-3">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-clinic-text text-sm tracking-[0.04em]">{monthYear}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[13px] font-semibold text-clinic-text-faint bg-white px-2.5 py-1.5 rounded shadow-sm">{group.count} transaç{group.count > 1 ? 'ões' : 'ão'}</span>
                            <span className="font-black text-status-red-text ml-2">- {formatCurrency(group.total)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {group.items.map(e => (
                      <tr key={e.id} className="hover:bg-clinic-bg/30 transition-colors group">
                        <td data-label="Data" className="px-6 py-4 text-sm whitespace-nowrap">{safeFormatDate(e.date, 'dd/MM/yyyy')}</td>
                        <td data-label="Descrição" className="px-6 py-4 text-sm font-bold text-clinic-text">
                          <div className="flex items-center gap-2">
                            {e.description}
                            {e.auto_gerado && (
                              <span title="Gerado automaticamente pelo sistema" className="inline-flex items-center gap-1 px-2.5 py-1 bg-clinic-bg border border-clinic-border rounded text-[13px] text-clinic-text-faint font-semibold">
                                <Link size={10} /> Auto
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Categoria" className="px-6 py-4"><span className="px-2.5 py-1.5 bg-clinic-bg rounded text-[13px] font-semibold text-clinic-text-muted">{e.category}</span></td>
                        <td data-label="Valor" className={cn('px-6 py-4 text-right text-sm font-bold flex items-center justify-end gap-3', isExpenseActive(e) ? 'text-status-red-text' : 'text-clinic-text-muted line-through')}>
                          - {formatCurrency(e.amount)}
                          {!e.auto_gerado && isExpenseActive(e) && (
                            <button onClick={() => setExpenseToDelete(e.id)} className="p-1.5 text-status-red-text bg-status-red-bg rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                          )}
                          {!isExpenseActive(e) && <span className="rounded-full bg-status-red-bg px-2 py-1 text-[10px] uppercase text-status-red-text no-underline">Cancelado</span>}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {Object.keys(groupedExpenses).length === 0 && <p className="py-10 text-center text-clinic-text-muted italic text-sm">Nenhuma despesa registada neste período.</p>}
          </div>
        </div>
      )}

      <Modal
        isOpen={!!toleranceSummary}
        onClose={closeToleranceModal}
        title="Liberar pacote temporariamente"
        width="max-w-2xl"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-status-blue-text/20 bg-status-blue-bg px-4 py-3 text-sm text-status-blue-text">
            <p className="flex items-center gap-2 font-black"><ShieldCheck size={18} /> Pacote {tolerancePackageNumber} — pagamento pendente</p>
            <p className="mt-1">A tolerância autoriza continuidade temporária, mas não registra receita, não quita o pacote e não gera repasse.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
              Motivo
              <select
                value={toleranceReasonCode}
                onChange={event => setToleranceReasonCode(event.target.value as PackageToleranceReasonCode)}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
              >
                {PACKAGE_TOLERANCE_REASON_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
              Limite de sessões
              <input
                type="number"
                min={1}
                max={10}
                value={toleranceMaxSessions}
                onChange={event => setToleranceMaxSessions(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
              />
            </label>
            <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
              Data prometida para pagamento
              <input
                type="date"
                min={format(new Date(), 'yyyy-MM-dd')}
                max={toleranceExpiresAt || undefined}
                value={tolerancePromisedDate}
                onChange={event => setTolerancePromisedDate(event.target.value)}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
              />
            </label>
            <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
              Prazo final da tolerância
              <input
                type="date"
                min={format(new Date(), 'yyyy-MM-dd')}
                value={toleranceExpiresAt}
                onChange={event => setToleranceExpiresAt(event.target.value)}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
              />
            </label>
          </div>

          {toleranceReasonCode === 'other' && (
            <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
              Motivo específico
              <input
                value={toleranceReasonText}
                onChange={event => setToleranceReasonText(event.target.value)}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
                placeholder="Descreva o motivo"
              />
            </label>
          )}

          <label className="space-y-1 text-sm font-bold text-clinic-text-muted">
            Observação administrativa
            <textarea
              value={toleranceNotes}
              onChange={event => setToleranceNotes(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-clinic-text outline-none focus:ring-2 focus:ring-clinic-primary"
              placeholder="Ex.: responsável confirmou o pagamento para sexta-feira"
            />
          </label>

          <div className="rounded-xl border border-status-orange-text/20 bg-status-orange-bg px-4 py-3 text-xs font-semibold text-status-orange-text">
            O limite padrão é de 5 dias corridos ou 2 sessões, valendo o que ocorrer primeiro. Sessões já realizadas e o histórico não serão apagados se o prazo vencer.
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div>
              {toleranceSummary?.packageTolerance?.record && !['closed', 'paid'].includes(toleranceSummary.packageTolerance.status) && (
                <button
                  type="button"
                  onClick={handleEndTolerance}
                  disabled={isSavingTolerance}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-status-red-text/25 bg-status-red-bg px-4 py-2.5 text-sm font-black text-status-red-text disabled:opacity-50"
                >
                  <Ban size={16} /> Encerrar tolerância
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeToleranceModal} disabled={isSavingTolerance} className="rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-sm font-black text-clinic-text-muted disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleSaveTolerance} disabled={isSavingTolerance} className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-sm font-black text-white shadow-md disabled:opacity-50">
                <TimerReset size={16} /> {isSavingTolerance ? 'Salvando...' : 'Salvar tolerância'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!paymentToVoid} onClose={() => { setPaymentToVoid(null); setPaymentVoidReason(''); }} title="Cancelar pagamento" width="max-w-md">
        <div className="space-y-6">
          <p className="text-clinic-text">O lançamento original e o repasse serão preservados no histórico, marcados como cancelados.</p>
          <div className="space-y-2">
            <label className="text-sm font-bold text-clinic-text-faint">Justificativa obrigatória</label>
            <textarea value={paymentVoidReason} onChange={event => setPaymentVoidReason(event.target.value)} rows={3} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 outline-none focus:ring-2 focus:ring-clinic-primary" placeholder="Informe o motivo do cancelamento" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => { setPaymentToVoid(null); setPaymentVoidReason(''); }} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all tracking-[0.04em] text-sm">Voltar</button>
            <button
              onClick={handleVoidPayment}
              disabled={!paymentVoidReason.trim() || isSavingPayment}
              className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all tracking-[0.04em] text-sm"
            >
              {isSavingPayment ? 'Cancelando...' : 'Confirmar cancelamento'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isPaymentModalOpen} onClose={closePaymentModal} title={paymentContext ? "Registrar pagamento" : "Nova Receita"}>
        <div className="space-y-5">
           <div className="flex flex-col gap-1">
            <label className="text-sm font-bold text-clinic-text-faint">Atendente</label>
            <select
              value={patientId}
              disabled={!!paymentContext}
              onChange={(e) => setPatientId(e.target.value)}
              className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">Selecione o atendente...</option>
              {state.patients.filter(p => p.status === 'Ativo').sort((a,b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {patientId && (
              <p className="rounded-xl border border-clinic-border bg-clinic-bg/70 px-3 py-2 text-xs font-semibold text-clinic-text-muted">
                Esta receita será vinculada ao pacote financeiro atual: <span className="font-black text-clinic-text">Pacote {paymentContext?.packageNumber || patientFinancials.find(summary => summary.patient.id === patientId)?.packageNumber || 1}</span>.
                {paymentContext && <> Saldo pendente antes deste registro: <span className="font-black text-status-orange-text">{formatCurrency(paymentContext.pendingGross)}</span>.</>}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Valor (R$)</label>
              <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Data</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Parcela</label>
              <select value={installment} onChange={e => setInstallment(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
                <option value="Pagamento integral">Pagamento integral</option><option value="1ª parcela">1ª parcela</option><option value="2ª parcela">2ª parcela</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Forma</label>
              <select value={method} onChange={e => setMethod(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
                <option value="Pix">Pix</option><option value="Dinheiro">Dinheiro</option><option value="Transferência">Transferência</option><option value="Outro">Outro</option>
              </select>
            </div>
          </div>
          {amount > 0 && (
            <div className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border text-sm text-clinic-text-muted">
              Repasse automático para sócia: <span className="font-bold text-clinic-text">{formatCurrency(amount * 0.2)}</span>
            </div>
          )}
          <button onClick={handleSavePayment} disabled={!patientId || amount <= 0 || isSavingPayment} className="w-full py-4 bg-clinic-primary text-white font-bold rounded-xl shadow-xl hover:bg-clinic-primary-hover transition-all tracking-[0.06em] text-sm disabled:opacity-50">{isSavingPayment ? 'Registrando...' : 'Confirmar Recebimento'}</button>
        </div>
      </Modal>

      <Modal isOpen={!!expenseToDelete} onClose={() => setExpenseToDelete(null)} title="Confirmar Exclusão" width="max-w-md">
        <div className="space-y-6">
          <p className="text-clinic-text">Deseja realmente excluir esta despesa?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setExpenseToDelete(null)} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all tracking-[0.04em] text-sm">Cancelar</button>
            <button onClick={() => { if (expenseToDelete) { onUpdate({ expenses: (state.expenses || []).filter(e => e.id !== expenseToDelete) }); showToast('Despesa excluída'); setExpenseToDelete(null); } }} className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all tracking-[0.04em] text-sm">Excluir</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} title="Nova Despesa">
        <div className="space-y-5">
           <div className="flex flex-col gap-1">
            <label className="text-sm font-bold text-clinic-text-faint">Descrição</label>
            <input type="text" placeholder="Ex: Conta de Luz, Aluguel..." value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Valor (R$)</label>
              <input type="number" value={expenseAmount} onChange={e => setExpenseAmount(Number(e.target.value))} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-clinic-text-faint">Data</label>
              <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-bold text-clinic-text-faint">Categoria</label>
            <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value as any)} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none">
              <option value="Aluguel">Aluguel</option><option value="Energia">Energia</option><option value="Internet">Internet</option><option value="Materiais">Materiais</option><option value="Impostos">Impostos</option><option value="Repasse Sócia">Repasse Sócia</option><option value="Outro">Outro</option>
            </select>
          </div>
          <button onClick={handleSaveExpense} disabled={!expenseDesc || expenseAmount <= 0} className="w-full py-4 bg-status-red-text text-white font-bold rounded-xl shadow-xl hover:bg-red-700 transition-all tracking-[0.06em] text-sm disabled:opacity-50">Confirmar Despesa</button>
        </div>
      </Modal>

    </div>
  );
}
